import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fireRedProgress} from '../src/suite/game-progress.js';
import {PostgameAgenda,postgameChecklist} from '../src/suite/postgame-agenda.js';
import {createPostgameController} from '../src/suite/postgame.js';
import {StaticMission,STATIC_ENCOUNTERS} from '../src/suite/static-mission.js';
import * as staticMission from '../src/suite/static-mission.js';
import {startCommandReady} from '../src/suite/console-power.js';
import {SaveVault} from '../src/suite/save-vault.js';
import * as profiles from '../src/suite/save-profiles.js';
const availability=await import('../src/suite/static-availability.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});

// Goal requests (G1): the engine reports which one-time static encounters the
// current save can still offer, a user target can outrank the fixed postgame
// checklist, and save profiles keep their identity and New Game state.
const flags=extra=>({2092:true,2112:true,2116:true,2121:false,147:false,582:true,632:true,606:true,626:false,627:false,748:false,749:false,750:true,
 700:false,701:false,702:false,703:false,84:false,128:false,573:true,611:true,730:false,...extra});
const observation=(extra={})=>{
 const o={captureId:'goal',frame:100,phase:'stable',phaseReasons:[],sram:{sha256:'saved'},emulator:{mode:'overworld',inputReady:true,inBattle:false},
  playerMemory:{map:{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F'},position:{x:7,y:4},ui:{},storyState:{flagIds:flags(extra),variableIds:{}},gameStats:{savedGame:10},saveAttemptStatus:1,
   trainer:{partyValidity:'valid',party:[],usablePartyCount:0,money:100000,bag:{},pokedex:{ownedSpecies:[16]},storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0),unknownSlots:0}}}};
 for(const part of [o.sram,o.emulator,o.playerMemory])Object.assign(part,{captureId:o.captureId,frame:o.frame});
 return o;
};
const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
const find=(o,id)=>availability.staticAvailability(o).find(t=>t.id===id);

test('static availability reports each engine static, its used flag and the engine’s own story gates',()=>{
 assert.equal(typeof availability.staticAvailability,'function');
 const ids=availability.STATIC_TARGETS.map(t=>t.id);
 for(const e of STATIC_ENCOUNTERS)assert.ok(ids.includes(e.name.toLowerCase()),e.name);
 assert.ok(ids.includes('snorlax'));
 const post=observation();
 assert.equal(find(post,'mewtwo').available,true);assert.equal(find(post,'mewtwo').status,'available');assert.deepEqual(find(post,'mewtwo').missing,[]);
 assert.equal(find(post,'mewtwo').method,'static');assert.equal(find(post,'mewtwo').map,'MAP_CERULEAN_CAVE_B1F');
 // Pre-League save: every automated static waits for the Hall of Fame.
 const pre=observation({2092:false,2112:false,2116:false});
 for(const id of ['mewtwo','articuno','zapdos','moltres','snorlax']){
  const a=find(pre,id);assert.equal(a.available,false,id);assert.equal(a.status,'needs-prerequisites',id);
  assert.ok(a.missing.includes('Hall of Fame'),id+': '+a.missing);
 }
 // Mewtwo is outside the agenda's before-link set; the birds are not.
 const league=observation({2112:false,2116:false});
 assert.deepEqual(find(league,'mewtwo').missing,['National Pokédex','Celio’s link (Ruby and Sapphire quest)']);
 assert.equal(find(league,'articuno').available,true);assert.equal(find(league,'zapdos').available,true);
 assert.deepEqual(find(league,'mewtwo').requirements.map(r=>r.key),['leagueComplete','nationalDex','canLinkNationally']);
 assert.deepEqual(find(league,'articuno').requirements.map(r=>r.key),['leagueComplete']);
 // A used encounter is reported as used, not as waiting for prerequisites.
 const used=observation({700:true});used.playerMemory.trainer.pokedex.ownedSpecies=[16,150];
 assert.equal(find(used,'mewtwo').used,true);assert.equal(find(used,'mewtwo').available,false);assert.equal(find(used,'mewtwo').status,'used');assert.equal(find(used,'mewtwo').owned,true);
 // Snorlax: two route flags, plus the Poké Flute its mission requires.
 assert.equal(find(observation({84:true}),'snorlax').available,true);
 assert.equal(find(observation({84:true,128:true}),'snorlax').status,'used');
 assert.ok(find(observation({573:false}),'snorlax').missing.includes('Poké Flute'));
 // Unreadable flags are unknown, never available.
 const moving=observation();moving.phase='transition';
 assert.equal(find(moving,'mewtwo').available,null);assert.equal(find(moving,'mewtwo').status,'unknown');
});

test('gameProgress exposes static availability for the host and goal supervisor',()=>{
 const post=fireRedProgress(observation());
 assert.ok(Array.isArray(post.statics),'gameProgress.statics');
 assert.deepEqual(post.statics.find(s=>s.speciesId===150),find(observation(),'mewtwo'));
 const pre=fireRedProgress(observation({2092:false}));
 assert.ok(pre.statics.find(s=>s.speciesId===144).missing.includes('Hall of Fame'));
});

test('the host static projection matches the engine’s static mission table and gates',()=>{
 const projection=JSON.parse(readFileSync(new URL('../../../pokemon_suite/firered_static_encounters.json',import.meta.url)));
 assert.equal(projection.schema,'pokemon-suite/static-encounters/v1');
 const engine=availability.STATIC_TARGETS.filter(t=>t.method==='static');
 assert.deepEqual(projection.encounters.map(e=>e.speciesId),engine.map(t=>t.speciesId));
 for(const e of projection.encounters){
  const t=engine.find(t=>t.speciesId===e.speciesId),source=STATIC_ENCOUNTERS.find(s=>s.speciesId===e.speciesId);
  assert.deepEqual([e.id,e.name,e.map,e.flag,e.level,e.method],[t.id,source.name,source.map,source.flag,source.level,'static']);
  assert.deepEqual(e.requires.map(r=>[r.key,r.flag,r.label,r.need]),t.requires.map(r=>[r.key,r.flag,r.label,r.need]));
  assert.deepEqual(e.balls,[...staticMission.STATIC_REQUIRED_BALLS]);
 }
 // Gate labels are the checklist's own entry labels.
 const entries=Object.fromEntries(postgameChecklist(observation()).map(x=>[x.id,x.label]));
 assert.deepEqual(availability.STATIC_TARGETS.find(t=>t.id==='mewtwo').requires.map(r=>r.label),[entries.league,entries['national-dex'],entries['sevii-link']]);
});

test('a legendary hunt refuses a save that the engine knows is missing its story gate',()=>{
 const e=STATIC_ENCOUNTERS.find(e=>e.speciesId===150),world={data:{maps:[{id:e.map,objectEvents:[{script:e.script}]}]}};
 const request={game:'firered',speciesId:150,quantity:1,locationId:'any',shiny:'required',natures:[],gender:'any',abilityId:null,ball:{id:'any',requirement:'preferred'},minIvs:{},moves:[],heldItemId:null,finalLevel:null,encounterLevel:{min:1,max:100},limits:{minBalls:10,maxSpend:999999,maxMinutes:120,maxEncounters:1000}};
 const o=observation({2116:false});o.playerMemory.trainer.party=[{}];
 assert.throws(()=>new StaticMission({id:'mewtwo',request,world}).initialize(o),/needs.*Celio/);
 o.playerMemory.storyState.flagIds[2116]=true;
 assert.doesNotThrow(()=>new StaticMission({id:'mewtwo',request,world}).initialize(o));
});

test('a priority static target is selected before earlier checklist entries and survives restart',()=>{
 const o=observation();
 let plan=new PostgameAgenda();plan.start();
 assert.equal(plan.select(o,1000)?.id,'tanoby','control: the fixed checklist starts with Tanoby');
 assert.equal(typeof plan.setPriorityTarget,'function');
 plan.setPriorityTarget({speciesId:150,shiny:'required',requestId:'request-150'},1000);
 assert.equal(plan.state.priorityTarget.id,'mewtwo');assert.equal(plan.state.priorityTarget.requestId,'request-150');
 const selected=plan.select(o,1001);
 assert.equal(selected?.id,'mewtwo');assert.equal(selected.priority,true);assert.equal(plan.state.active,'mewtwo');
 // The durable agenda file is this state; a restarted owner keeps the target.
 plan=new PostgameAgenda(JSON.parse(JSON.stringify(plan.state)));
 assert.equal(plan.select(o,1002)?.id,'mewtwo');
 assert.equal(plan.priorityRequest({shiny:'required',speciesId:150,limits:{maxEncounters:1000}}).shiny,'required');
 // A failed attempt yields to the checklist, then the target comes first again.
 plan.defer('mewtwo','Route could not be verified',1002);
 assert.equal(plan.select(o,1003)?.id,'tanoby');
 assert.equal(plan.select(o,301003)?.id,'mewtwo');
 // Using the encounter retires the target with a receipt.
 const done=observation({700:true});done.playerMemory.trainer.pokedex.ownedSpecies=[16,150];
 assert.equal(plan.select(done,301004)?.id,'tanoby');
 assert.equal(plan.state.priorityTarget,null);assert.equal(plan.state.priorityHistory.at(-1).id,'mewtwo');assert.equal(plan.state.priorityHistory.at(-1).outcome,'used');
});

test('a priority target keeps the prerequisites it needs and skips the ones it does not',()=>{
 const o=observation({2112:false,2116:false});
 const plan=new PostgameAgenda();plan.start();
 plan.setPriorityTarget({speciesId:150,shiny:'any'},1000);
 assert.equal(plan.select(o,1000,{priorityOnly:true}),null,'Mewtwo waits for Celio’s link');
 assert.equal(plan.select(o,1000)?.id,'articuno','the checklist continues meanwhile');
 plan.setPriorityTarget({speciesId:146,shiny:'any'},1001);
 assert.equal(plan.select(o,1001)?.id,'moltres');
 assert.equal(plan.select(o,1001,{priorityOnly:true})?.id,'moltres','Moltres does not need the link quest');
 assert.equal(plan.priorityRequest({shiny:'required',speciesId:146}).shiny,'any');
 plan.setPriorityTarget(null,1002);assert.equal(plan.state.priorityTarget,null);
 assert.equal(plan.state.priorityHistory.at(-1).outcome,'cleared');
 assert.throws(()=>plan.setPriorityTarget({speciesId:1},1003),/static/);
 assert.throws(()=>plan.setPriorityTarget({speciesId:150,shiny:'sometimes'},1003),/shiny/i);
 assert.throws(()=>plan.setPriorityTarget({speciesId:150,requestId:'../x'},1003),/request/i);
 const request={schema:'pokemon-suite/farming-request/v1',game:'firered',speciesId:150,quantity:1,locationId:'any',shiny:'any',natures:[],gender:'any',abilityId:null,ball:{id:'master-ball',requirement:'required'},minIvs:{},minDvs:{},encounterLevel:{min:1,max:100},finalLevel:null,moves:[],heldItemId:null,limits:{maxEncounters:10,maxMinutes:30,minBalls:10,maxSpend:1000},afterCompletion:'stop-save'};
 assert.throws(()=>plan.setPriorityTarget({speciesId:150,shiny:'any',request},1003),/Ball/);
 plan.setPriorityTarget({speciesId:150,shiny:'any',request:{...request,ball:{id:'ultra-ball',requirement:'required'}}},1004);
 assert.equal(plan.priorityRequest({shiny:'required'}).ball.id,'ultra-ball');
});

test('the postgame owner starts a priority static hunt before the checklist and before unneeded prerequisites',()=>{
 let c=createPostgameController(args);c.beginAdventure(null,{priorityTarget:{speciesId:150,shiny:'any',requestId:'request-mewtwo'}});
 const d=c.decide(observation());
 assert.equal(d.kind,'postgame-hunt',JSON.stringify(d));
 assert.equal(d.objectiveId,'mewtwo');assert.equal(d.route.method,'static');
 assert.equal(d.request.speciesId,150);assert.equal(d.request.shiny,'any');
 assert.deepEqual(d.priority,{id:'mewtwo',huntId:'request-mewtwo'});
 assert.equal(c.state().agenda.priorityTarget.id,'mewtwo','the durable agenda carries the target');
 // A bird does not need the National Dex upgrade or Celio's link.
 c=createPostgameController(args);c.beginAdventure(null,{priorityTarget:{speciesId:145,shiny:'required'}});
 const bird=c.decide(observation({2112:false,2116:false}));
 assert.equal(bird.kind,'postgame-hunt',JSON.stringify(bird));assert.equal(bird.objectiveId,'zapdos');assert.equal(bird.request.shiny,'required');
 // Restart keeps the target; an invalid target is rejected before any change.
 c=createPostgameController({...args,state:JSON.parse(JSON.stringify(c.state()))});
 assert.equal(c.state().agenda.priorityTarget.id,'zapdos');
 assert.throws(()=>c.beginAdventure(null,{priorityTarget:{speciesId:151}}),/static/);
 assert.equal(c.state().agenda.priorityTarget.id,'zapdos');
});

test('a save label survives a hunt that rewrites the active selection',()=>{
 const selection=profiles.createGameProfileSelection('play-1','Nova run',false);
 const hunt=profiles.createHuntSelection('postgame-mewtwo-1',false,selection);
 assert.equal(hunt.label,'Nova run');assert.notEqual(hunt.manual,true);assert.equal(hunt.id,'postgame-mewtwo-1');
 assert.equal(profiles.createHuntSelection('next',true,hunt).label,'Nova run','a second hunt keeps it too');
 assert.equal(profiles.createHuntSelection('plain',false).label,undefined);
 const root=mkdtempSync(join(tmpdir(),'suite-label-'));try{
  const vault=new SaveVault(join(root,'saves'),{game:'firered',romSha1:'rom',coreSha256:'core'});
  vault.write(Buffer.from('frame'),Buffer.from('party'),{frame:1});
  // session-worker: backupGameProfile(directory,vault,{label:oldActive?.label||'Previous FireRed save',...})
  const record=profiles.backupGameProfile(root,vault,{label:hunt.label||'Previous FireRed save',active:hunt});
  assert.equal(record.label,'Nova run');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a manual new save starts the bot at New Game instead of Continue; campaigns and restores keep their state',async()=>{
 assert.equal(typeof profiles.profileStartsNewGame,'function');
 assert.equal(profiles.profileStartsNewGame({type:'new-save',previous:false}),true);
 assert.equal(profiles.profileStartsNewGame({type:'new-save',campaignId:'run-1',previous:false}),false,'start-campaign keeps its behavior');
 assert.equal(profiles.profileStartsNewGame({type:'restore-save',restoredMetadata:{newProfile:false},previous:true}),false);
 assert.equal(profiles.profileStartsNewGame({type:'restore-save',restoredMetadata:{newProfile:true},previous:false}),true);
 const events=[];
 await startCommandReady({newProfile:profiles.profileStartsNewGame({type:'new-save',previous:false})},{
  stop:()=>events.push('stop'),checkpoint:()=>events.push('checkpoint'),
  continueSave:()=>{throw Error('This game has no verified Continue save. Choose an existing save profile before starting the bot.');},
  prepareNewGame:()=>events.push('new-game'),ready:()=>events.push('ready')});
 assert.deepEqual(events,['stop','checkpoint','new-game','ready']);
});
