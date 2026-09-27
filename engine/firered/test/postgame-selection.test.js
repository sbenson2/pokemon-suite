import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgameController} from '../src/suite/postgame.js';
import {PostgameAgenda} from '../src/suite/postgame-agenda.js';
import {selectOwnedDexEvolution} from '../src/suite/fire-red-evolution.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';
import {botHealth} from '../src/suite/recovery.js';
const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
const mon=species=>({species,validity:'valid',shiny:false,isEgg:false,personality:species,otId:456,level:20,heldItem:0,friendship:70,hp:40,maxHp:40,status1:0,moves:[33],pp:[35],ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}});
const observation=()=>{
 const o={captureId:'selection',frame:100,phase:'stable',phaseReasons:[],sram:{sha256:'saved'},emulator:{mode:'overworld',inputReady:true,inBattle:false},playerMemory:{map:{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F'},position:{x:7,y:4},ui:{},storyState:{flagIds:{2092:true,2112:false,2116:false},variableIds:{}},gameStats:{savedGame:10},saveAttemptStatus:1,trainer:{partyValidity:'valid',party:[],usablePartyCount:0,money:100000,bag:{},pokedex:{ownedSpecies:[16]},storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0),unknownSlots:0}}}};
 for(const part of [o.sram,o.emulator,o.playerMemory])Object.assign(part,{captureId:o.captureId,frame:o.frame});
 return o;
};

test('National Dex prerequisites can fall back to later Kanto levels without selecting National-Dex-only evolutions',()=>{
 const o=observation(),p=mon(16);o.playerMemory.trainer.storage.pokemon=[p,mon(42)];
 const trainer=o.playerMemory.trainer;
 assert.equal(selectOwnedDexEvolution({trainer,scope:'preparation'}),null,'keep the fast-path preference');
 assert.equal(selectOwnedDexEvolution({trainer,scope:'kanto'})?.rule.speciesId,17);
 assert.equal(selectOwnedDexEvolution({trainer,scope:'kanto',protectedFingerprints:[encounterFingerprint(p)]}),null,'Crobat still needs National Dex');
 p.shiny=true;assert.equal(selectOwnedDexEvolution({trainer,scope:'kanto'}),null,'do not spend a shiny on ordinary registration');
});

test('the controller reserves a fallback evolution immediately and retains it across restart',()=>{
 const o=observation();o.playerMemory.trainer.storage.pokemon=[mon(16)];
 let c=createPostgameController(args);c.beginAdventure();const d=c.decide(o);
 assert.equal(d.kind,'postgame-evolution-started');assert.equal(c.state().dexEvolution?.request.speciesId,17);
 const state=JSON.parse(JSON.stringify(c.state()));c=createPostgameController({...args,state});
 assert.equal(c.state().dexEvolution.originalPokemon.personality,16);
 assert.equal(c.state().dexEvolution.requestId,state.dexEvolution.requestId);
});

test('Kanto gifts remain eligible before Celio without opening inaccessible island goals',()=>{
 const o=observation(),f=o.playerMemory.storyState.flagIds;
 Object.assign(f,{582:false,632:false,606:false,2121:false,147:false,700:false,701:false,702:false,703:false});
 let agenda=new PostgameAgenda();agenda.start();
 assert.equal(agenda.select(o,1000)?.id,'lapras');
 agenda.defer('lapras','Retry the verified gift route',1000);
 agenda=new PostgameAgenda(JSON.parse(JSON.stringify(agenda.state)));
 assert.equal(agenda.select(o,1001)?.id,'dojo-gift');
 assert.equal(agenda.select(o,301001)?.id,'lapras');
 f[2092]=false;assert.equal(agenda.select(o,302000),null,'campaign remains the owner until Hall of Fame');
});

test('exhausted selectors keep a named dependency goal and automatically reconsider changed evidence',()=>{
 const o=observation();o.playerMemory.trainer.storage.boxCounts=Array(14).fill(30);let now=1000,c=createPostgameController({...args,clock:()=>now});c.beginAdventure();
 c.decide(o);let state=c.state();
 assert.equal(state.objective?.target.kind,'await-postgame-dependency');
 assert.equal(state.objective.goal,'national-dex');assert.equal(state.objective.progress.current,1);assert.equal(state.objective.progress.required,60);
 assert.equal(state.status,'dependency');assert.ok(state.reason);
 c=createPostgameController({...args,state:JSON.parse(JSON.stringify(state)),clock:()=>now});
 now+=1000;o.playerMemory.trainer.storage.boxCounts=Array(14).fill(0);o.playerMemory.trainer.storage.pokemon=[mon(16)];
 assert.equal(c.decide(o).kind,'postgame-evolution-started','newly verified local work takes over without a manual Start');
 assert.equal(c.state().dexEvolution.request.speciesId,17);
 assert.equal(c.state().status,'running','resolving the dependency clears the waiting status');
 assert.equal(c.state().reason,null);
});

test('a dependency goal reports its reason even while the emulator keeps the game visible',()=>{
 const h=botHealth({enabled:true,running:true,postgame:{status:'dependency',reason:'The box reserve is full.'}});
 assert.equal(h.status,'waiting');assert.equal(h.reason,'The box reserve is full.');
 assert.equal(botHealth({enabled:false,running:true,postgame:{status:'dependency'}}).status,'stopped');
});

test('an unsupported first candidate yields to the next available source in the same decision',()=>{
 const o=observation();Object.assign(o.playerMemory.storyState.flagIds,{606:false,611:false});
 const c=createPostgameController(args);c.beginAdventure();
 const d=c.decide(o);
 assert.equal(d.kind,'postgame-hunt');assert.equal(d.request.speciesId,133);
 assert.equal(c.state().agenda.active,'eevee');assert.ok(c.state().agenda.failures['old-amber']?.retryAt);
 assert.equal(d.request.shiny,'required','the fallback preserves one-time shiny opportunities');
});

test('a deferred source keeps its cooldown and resumes automatically when the deadline arrives',()=>{
 const o=observation();Object.assign(o.playerMemory.storyState.flagIds,{606:false});
 o.playerMemory.trainer.pokedex.ownedSpecies=[16,63,35,147,123,137];
 let now=1000,c=createPostgameController({...args,clock:()=>now});c.beginAdventure();
 c.decide(o);const state=c.state();assert.equal(state.objective.target.kind,'await-postgame-dependency');
 assert.equal(state.objective.retryAt,301000);assert.equal(state.agenda.failures['old-amber'].attempts,1);
 c=createPostgameController({...args,state:JSON.parse(JSON.stringify(state)),clock:()=>now});now=300999;c.decide(o);
 assert.equal(c.state().agenda.failures['old-amber'].attempts,1);
 now=301001;c.decide(o);assert.equal(c.state().agenda.failures['old-amber'].attempts,2,'the original unavailable route is retried instead of silently exhausting the checklist');
});
