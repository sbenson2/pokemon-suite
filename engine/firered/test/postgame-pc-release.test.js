import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgameController} from '../src/suite/postgame.js';
import {postgameChecklist} from '../src/suite/postgame-agenda.js';
import {encounterFingerprint as fingerprint} from '../src/player/encounter-tracker.js';
import {RELEASE_LABEL} from '../src/suite/pc-release.js';

// The live stall (Sept 27): 396 of 426 spaces used, 30 free = the shiny reserve,
// and the PC holds the Egg sticker's own level-5 Rattata hatchlings.
const center='MAP_FOUR_ISLAND_POKEMON_CENTER_1F',OT=1706568373;
const world={data:{maps:[{id:center,objectEvents:[{script:'FourIsland_PokemonCenter_1F_EventScript_Nurse'}]},
 {id:'MAP_FOUR_ISLAND_HOUSE2',objectEvents:[{script:'FourIsland_House2_EventScript_StickerMan'}]}],wildEncounters:[]}};
const story={data:{scripts:[],symbols:{items:{}}}};
const species=Array.from({length:412},(_,id)=>({id,name:`SPECIES_${id}`,growthRate:'GROWTH_MEDIUM_FAST',eggGroups:['EGG_GROUP_FIELD'],genderRatio:{call:'PERCENT_FEMALE',args:[50]}}));
species[132]={...species[132],eggGroups:['EGG_GROUP_DITTO'],genderRatio:'MON_GENDERLESS'};
const mechanics={data:{moves:[{id:33,pp:35,power:40,type:'TYPE_NORMAL',effect:'EFFECT_HIT'}],species}};
let next=5000;
const ivs={hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6};
const mon=(extra={})=>({validity:'valid',species:19,personality:next++,otId:OT,shiny:false,isEgg:false,heldItem:0,experience:125,friendship:120,metLevel:0,
 evs:{hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0},pokerus:0,moves:[33,39,0,0],pp:[35,30,0,0],ivs,...extra});
const member=slot=>mon({slot,species:[149,55,22,53,68,44][slot],experience:1e6,friendship:255,metLevel:21,moves:[33],level:100,hp:300,maxHp:300,status1:0});

function save({hatchlings=30,free=30,partySize=6,tweak=null}={}){
 const parents=[mon({box:0,slot:0,experience:352031,friendship:255,metLevel:3}),mon({box:0,slot:1,species:232,experience:1e6,metLevel:25})];
 const born=Array.from({length:hatchlings},(_,i)=>mon({box:1+Math.floor(i/30),slot:i%30}));
 const party=Array.from({length:partySize},(_,i)=>member(i));
 const used=426-free,storedCount=used-partySize,fillers=[];
 for(let i=0,index=0;fillers.length<storedCount-parents.length-born.length;index++){
  const box=Math.floor(index/30),slot=index%30;
  if(box===0&&slot<2||box>=1&&box<1+Math.ceil(hatchlings/30)&&(box-1)*30+slot<hatchlings)continue;
  fillers.push(mon({box,slot,species:100+(i++%50),experience:8000,metLevel:20,friendship:70}));
 }
 const stored=[...parents,...born,...fillers];
 const boxCounts=Array(14).fill(0);for(const p of stored)boxCounts[p.box]++;
 const receipts=born.map(p=>({requestId:`postgame-egg-sticker-hatch-${p.personality}-1`,method:'breeding',pokemon:structuredClone(p),fingerprint:fingerprint(p),
  nativeSaveVerified:true,parentsReturned:parents.map(fingerprint),requestedSpecies:19,matched:true}));
 const o={captureId:'pc-release',frame:100,phase:'stable',sram:{sha256:'saved',captureId:'pc-release',frame:100},emulator:{captureId:'pc-release',frame:100,mode:'overworld',inBattle:false,inputReady:true},
  playerMemory:{captureId:'pc-release',frame:100,map:{id:center},position:{x:5,y:5},ui:{},storyState:{flagIds:{2092:true,2112:true,2116:true},variableIds:{0x404a:3}},
   gameStats:{savedGame:10,eggsHatched:273},saveAttemptStatus:1,
   trainer:{otId:OT,partyValidity:'valid',party,usablePartyCount:partySize,money:999999,bag:{items:[],pokeBalls:[]},
    storage:{validity:'valid',currentBox:1,pokemon:stored,boxCounts},pokedex:{ownedSpecies:[...new Set([...party,...stored].map(p=>p.species))]}}}};
 tweak?.({o,born,parents});
 return {o,born,parents,receipts};
}
function controllerFor({o,receipts},{now=1000,edit=null}={}){
 const controller=createPostgameController({world,story,mechanics,clock:()=>now});controller.beginAdventure();
 const state=controller.state();state.preparation={kind:'postgame',phase:'complete'};state.agenda.acquisitions=receipts;
 // Only the Egg sticker remains, exactly as on the live save.
 for(const entry of postgameChecklist(o,state.agenda.workflows))if(entry.id!=='egg-sticker'&&entry.status!=='complete')state.agenda.failures[entry.id]={attempts:1,retryAt:now+86400000};
 state.agenda.workflows??={};
 edit?.(state);
 return createPostgameController({world,story,mechanics,clock:()=>now,state});
}

test('a storage-blocked postgame releases a batch of Egg-sticker hatchlings instead of waiting',()=>{
 const live=save();
 const controller=controllerFor(live);
 const decision=controller.decide(live.o),state=controller.state();
 assert.equal(decision.kind,'postgame-acquisition-started',JSON.stringify({decision,objective:state.objective,reason:state.reason}));
 assert.equal(state.acquisition.kind,'pc-release');
 assert.equal(state.acquisition.plan.length,10,'one batch of at most ten');
 assert.deepEqual(state.acquisition.plan.map(e=>e.fingerprint),live.born.slice(0,10).map(fingerprint),'the open box first');
 assert.equal(state.agenda.active,'pc-release');
 assert.equal(state.agenda.workflows.pcRelease.refilling,true);
 assert.ok(!state.acquisition.plan.some(e=>live.parents.some(p=>fingerprint(p)===e.fingerprint)),'never a breeding parent');
});

test('every retained reservation, the team plan and Box 3 slot 1 are excluded from the plan',()=>{
 const live=save({tweak:({o,born})=>{
  // A hatchling in Box 3 slot 1 (the Mail supply's alias slot).
  const alias=born[29],occupant=o.playerMemory.trainer.storage.pokemon.find(p=>p.box===2&&p.slot===0);
  Object.assign(occupant,{box:alias.box,slot:alias.slot});Object.assign(alias,{box:2,slot:0});
 }});
 const [trainee,evolving,objectiveHeld]=live.born;
 const controller=controllerFor(live,{edit:state=>{
  state.agenda.workflows.leagueExpShare={trainee:{personality:trainee.personality,otId:trainee.otId,species:19}};
  state.deferredEvolutions=[{state:{requestId:'dex-x',currentFingerprint:fingerprint(evolving),steps:[]},retryAt:1e15,reason:'x'}];
  state.pendingObjective={id:'withdraw',target:{kind:'party-roster',map:center,requiredFingerprints:[fingerprint(objectiveHeld)]}};
 }});
 controller.decide(live.o);
 const plan=controller.state().acquisition?.plan??[];
 assert.equal(plan.length,10);
 for(const p of [trainee,evolving,objectiveHeld,live.born[29]])assert.ok(!plan.some(e=>e.fingerprint===fingerprint(p)),`protected ${p.box}:${p.slot}`);
 // A bred species in the team plan is never released.
 const team=controllerFor(save(),{edit:state=>{state.fieldTeamPlan={...(state.fieldTeamPlan??{}),permanentFamilies:[[19,20]],starterFamily:[1,2,3]};}});
 const d=team.decide(save().o);
 assert.notEqual(team.state().acquisition?.kind,'pc-release');
 assert.equal(d.kind,'resample');
 assert.match(team.state().reason,/no Egg-sticker hatchling can be released safely/);
});

test('without releasable hatchlings the storage stop names the reason',()=>{
 const live=save({tweak:({born})=>{for(const p of born)p.shiny=true;}});
 const controller=controllerFor(live);
 controller.decide(live.o);
 assert.equal(controller.state().status,'dependency');
 assert.equal(controller.state().acquisition,null);
 assert.match(controller.state().reason,/Free PC space while preserving the shiny reserve: no Egg-sticker hatchling can be released safely/);
});

test('release batches continue until the reserve plus the buffer is free, then the Egg loop resumes',()=>{
 // Mid-refill: 35 free (a capture budget of 5) after an earlier batch.
 let live=save({free:35});
 let controller=controllerFor(live,{edit:state=>{state.agenda.workflows.pcRelease={refilling:true};}});
 controller.decide(live.o);
 assert.equal(controller.state().acquisition?.kind,'pc-release');
 assert.equal(controller.state().acquisition.plan.length,10,'min(batch, 50 - 35 = 15)');
 live=save({free:45});
 controller=controllerFor(live,{edit:state=>{state.agenda.workflows.pcRelease={refilling:true};}});
 controller.decide(live.o);
 assert.equal(controller.state().acquisition.plan.length,5,'the last batch stops at the buffer');
 // At the buffer the refill ends; the Egg sticker breeds again.
 live=save({free:50});
 controller=controllerFor(live,{edit:state=>{state.agenda.workflows.pcRelease={refilling:true};}});
 controller.decide(live.o);
 assert.equal(controller.state().agenda.workflows.pcRelease.refilling,false);
 assert.equal(controller.state().acquisition?.kind,'breeding','the Egg sticker resumes with free space');
 assert.equal(controller.state().agenda.active,'egg-sticker');
 // Space above the reserve but below the buffer, not refilling: no new visit yet.
 live=save({free:40});
 controller=controllerFor(live);
 controller.decide(live.o);
 assert.equal(controller.state().acquisition?.kind,'breeding');
});

test('a saved release is acknowledged as a release receipt, not an acquisition',()=>{
 const live=save();
 const receipt={requestId:'postgame-pc-release-1',method:'pc-release',released:live.born.slice(0,2).map(p=>({fingerprint:fingerprint(p)})),refused:[],nativeSaveVerified:true,savedSramSha256:'b'.repeat(64)};
 const controller=controllerFor(live,{edit:state=>{
  state.agenda.active='pc-release';
  state.acquisition={schema:'pokemon-suite/native-acquisition/v1',kind:'pc-release',requestId:'postgame-pc-release-1',plan:[{fingerprint:fingerprint(live.born[0]),box:1,slot:0}],released:[],refused:[],phase:'complete',receipt};
 }});
 const decision=controller.decide(live.o);
 assert.equal(decision.kind,'acquisition-saved');
 controller.acknowledgeAcquisition();
 const state=controller.state();
 assert.equal(state.acquisition,null);
 assert.equal(state.agenda.acquisitions.length,live.receipts.length,'Egg-sticker provenance is unchanged');
 assert.deepEqual(state.agenda.workflows.pcRelease.receipts,[receipt]);
 assert.equal(state.agenda.workflows.pcRelease.released,2);
 assert.equal(state.agenda.active,null);
});

test('a release refused before any input defers only the release and yields the game',()=>{
 const live=save();
 const shiny=live.born[3];shiny.shiny=true;
 const controller=controllerFor(live,{edit:state=>{
  state.agenda.active='pc-release';
  state.acquisition={schema:'pokemon-suite/native-acquisition/v1',kind:'pc-release',requestId:'postgame-pc-release-2',
   plan:[{fingerprint:fingerprint(shiny),box:shiny.box,slot:shiny.slot,species:19,personality:shiny.personality,otId:OT,experience:125,friendship:120,metLevel:0}],released:[],refused:[],phase:'releasing'};
 }});
 const decision=controller.decide(live.o),state=controller.state();
 assert.equal(decision.kind,'resample');
 assert.equal(state.acquisition,null);
 assert.match(state.agenda.failures['pc-release'].reason,/shiny/);
 assert.equal(state.status==='waiting',false,'a clean refusal is not a stop');
 // The deferred release is not retried before its retry time.
 const again=controller.decide(live.o);
 assert.notEqual(controller.state().acquisition?.kind,'pc-release',JSON.stringify(again));
});

test('the release objective carries the Activity label',()=>{
 const live=save();
 const controller=controllerFor(live);
 controller.decide(live.o);
 const task=controller.state();
 assert.equal(task.acquisition.kind,'pc-release');
 const second=controller.decide(live.o);
 assert.equal(controller.state().objective?.label,RELEASE_LABEL,JSON.stringify(second));
 assert.equal(controller.state().objective.target.kind,'party-roster');
 assert.equal(controller.state().objective.target.release.fingerprint,task.acquisition.plan[0].fingerprint);
});

test('while a release runs the checklist presents it as the active goal without counting it',async()=>{
 const {postgamePresentation}=await import('../src/suite/postgame-agenda.js');
 const live=save();
 const controller=controllerFor(live);
 controller.decide(live.o);
 const presented=postgamePresentation(live.o,controller.state().agenda);
 const entry=presented.entries.find(e=>e.id===presented.active);
 assert.deepEqual(entry,{id:'pc-release',label:'Free PC space by releasing Egg-sticker hatchlings',status:'pending',executable:true,conditional:true,
  reason:'Releases only non-shiny, unreserved hatchlings from the Egg sticker’s own breeding, then saves.'});
 const idle=postgamePresentation(live.o,{...controller.state().agenda,active:null});
 assert.ok(!idle.entries.some(e=>e.id==='pc-release'),'shown only while it owns the game');
});
