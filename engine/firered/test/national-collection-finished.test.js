import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgameController} from '../src/suite/postgame.js';
import {PostgameAgenda,resolvePostgameObjective,postgameChecklist,collectionContext} from '../src/suite/postgame-agenda.js';

// Live September 28 (build 123): with nothing executable, the National Dex
// entry deferred itself 34 times ("Available routes are cooling down after
// failed attempts"), and a traded-in Pokémon waited out a one-hour retry. When
// the save has done all it can alone, say so, stay idle, and look again the
// moment the collection changes.
const PRIZES=[63,35,147,123,137];
const mon=(species,personality,more={})=>({species,personality,otId:456,validity:'valid',shiny:false,isEgg:false,level:20,experience:8000,heldItem:0,friendship:70,hp:40,maxHp:40,status1:0,
 moves:[33,19],pp:[35,15],ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},...more});
const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[16,4,5,...PRIZES].map(id=>({id,name:'SPECIES_'+id,growthRate:'GROWTH_MEDIUM_FAST'}))}}};
function observation(){
 const o={captureId:'finished',frame:100,phase:'stable',phaseReasons:[],sram:{sha256:'saved'},emulator:{mode:'overworld',inputReady:true,inBattle:false},
  playerMemory:{map:{id:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F'},position:{x:9,y:4},ui:{},storyState:{flagIds:{2092:true,2112:true,2116:true},variableIds:{}},
   gameStats:{savedGame:10},saveAttemptStatus:1,trainer:{partyValidity:'valid',party:[mon(16,1,{slot:0})],usablePartyCount:1,money:100000,bag:{pokeBalls:[{itemId:4,quantity:99}]},
    pokedex:{ownedSpecies:[16,17,18,...PRIZES]},storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0),unknownSlots:0}}}};
 for(const part of [o.sram,o.emulator,o.playerMemory])Object.assign(part,{captureId:o.captureId,frame:o.frame});
 return o;
}
const traded=o=>{o.playerMemory.trainer.party.push(mon(4,77,{slot:1,otId:999,level:15,experience:3375}));o.playerMemory.trainer.pokedex.ownedSpecies.push(4);return o;};

test('with nothing to do alone, the National Dex resolves to an honest finished state, not a retry',()=>{
 const o=observation(),state={};
 const r=resolvePostgameObjective('national-collection',o,args.world,state,{mechanics:args.mechanics});
 assert.equal(r.target.kind,'collection-exhausted');
 assert.match(r.target.reason,/finished what it can do (on its own|alone)/);
 assert.match(r.target.reason,/\d+ of 189 catchable in FireRed/);assert.match(r.target.reason,/another FireRed save/);assert.match(r.target.reason,/other games or events/);
 const s=r.target.summary;assert.equal(s.owned+s.local+s.dependency+s.external,386);
});

test('a deferred catch is a cooldown, not a finished collection',()=>{
 const world={data:{maps:[{id:'MAP_ROUTE1'}],wildEncounters:[{map:'MAP_ROUTE1',base_label:'sRoute1_FireRed',land_mons:{encounter_rate:20,mons:Array(12).fill({species:'SPECIES_19',min_level:2,max_level:3})}}]}};
 const mechanics={data:{species:[...args.mechanics.data.species,{id:19,name:'SPECIES_19'}]}};
 const r=resolvePostgameObjective('national-collection',observation(),world,{dex:{failed:{19:{retryAt:Date.now()+600000}}}},{mechanics});
 assert.equal(r.target.kind,'stop-for-review');assert.match(r.target.reason,/retr/i);
});

test('the exhausted entry stays idle for the same collection and wakes on any collection change',()=>{
 const o=observation(),agenda=new PostgameAgenda({schema:'pokemon-suite/postgame-agenda/v1',enabled:true,active:null,entries:[],workflows:{},
  failures:{'national-collection':{reason:'old',attempts:34,retryAt:Date.now()+3600000,context:'x',contextVersion:3,requiresStateChange:true}}});
 assert.equal(typeof collectionContext,'function');
 const r=resolvePostgameObjective('national-collection',o,args.world,agenda.state.workflows,{mechanics:args.mechanics});
 agenda.exhaust('national-collection',o,r.target,1000);
 assert.equal(agenda.state.failures['national-collection'],undefined,'finishing is not a failure');
 assert.equal(agenda.select(o,2000),null);
 const entry=postgameChecklist(o,agenda.state.workflows).find(e=>e.id==='national-collection');
 assert.equal(entry.status,'pending');assert.equal(entry.executable,false);assert.equal(entry.exhausted,true);assert.equal(entry.retry,undefined);
 assert.match(entry.reason,/catchable in FireRed/);
 assert.equal(agenda.select(traded(observation()),2001)?.id,'national-collection','a traded-in Pokémon re-evaluates at once');
});

test('a cooling National Dex deferral is re-evaluated at once when a trade changes the collection',()=>{
 const o=observation(),agenda=new PostgameAgenda({schema:'pokemon-suite/postgame-agenda/v1',enabled:true,active:null,entries:[],workflows:{},failures:{}});
 agenda.defer('national-collection','A catch route failed.',1000,o);
 assert.equal(agenda.select(o,2000),null,'the same collection waits for the retry');
 assert.equal(agenda.select(traded(observation()),2000)?.id,'national-collection');
 const other=new PostgameAgenda({schema:'pokemon-suite/postgame-agenda/v1',enabled:true,active:null,entries:[],workflows:{},failures:{}});
 const moved=observation();other.defer('national-collection','A catch route failed.',1000,o);moved.playerMemory.position={x:1,y:1};moved.playerMemory.trainer.money=5;
 assert.equal(other.select(moved,2000),null,'walking or spending is not a collection change');
});

test('the owner reports the finished save plainly, keeps idle, and starts new work after a trade',()=>{
 let c=createPostgameController({...args,state:{schema:'pokemon-suite/postgame/v1',status:'running',preparation:{kind:'postgame',phase:'complete'},
  agenda:{schema:'pokemon-suite/postgame-agenda/v1',enabled:true,active:null,entries:[],workflows:{},failures:{'national-collection':{reason:'No navigation or objective progress was observed. The route will retry.',attempts:33,retryAt:Date.now()-1,context:'x',contextVersion:3,requiresStateChange:true}}}}});
 const o=observation();
 let d=c.decide(o);
 assert.equal(d.kind,'resample');assert.equal(d.action.buttons.length,0,'no input while finished');
 let s=c.state();
 assert.equal(s.status,'dependency');assert.match(s.reason,/finished what it can do/);
 assert.equal(s.objective.retryAt,null,'no retry countdown');
 assert.equal(s.agenda.failures['national-collection'],undefined);
 assert.ok(s.objective.dependencies.some(x=>x.id==='national-collection'&&x.exhausted===true));
 for(let i=0;i<5;i++)assert.equal(c.decide(observation()).kind,'resample');
 assert.equal(c.state().agenda.failures['national-collection'],undefined,'idling never becomes a retry loop');
 c=createPostgameController({...args,state:JSON.parse(JSON.stringify(c.state()))});
 d=c.decide(traded(observation()));
 assert.equal(d.kind,'postgame-evolution-started','the traded Charmander evolves right away');
 assert.equal(c.state().dexEvolution.request.speciesId,5);
});

// build 126: the finished reason names the live extra-save rows (which save,
// and what it waits for) instead of a generic "planned".
test('the finished reason lists the live extra-save rows when the plan has them',()=>{
 const o=observation(),state={extraSaves:{presentation:[
  {needId:'starter-charmander',label:'Charmander line',status:'ready',save:'FIRE'},
  {needId:'hitmon',label:'Hitmonlee, Hitmonchan, Tyrogue and Hitmontop',status:'needs-helper-task',save:'FIRE'},
  {needId:'fossil-dome',label:'Kabuto line',status:'needs-helper-save',save:'Helper save 1'},
  {needId:'roamer-raikou',label:'Raikou',status:'planned-long',save:'Engine 50'}]}};
 const r=resolvePostgameObjective('national-collection',o,args.world,state,{mechanics:args.mechanics});
 assert.match(r.target.reason,/another FireRed save/);
 assert.match(r.target.reason,/Charmander line from FIRE \(ready\)/);
 assert.match(r.target.reason,/Kabuto line from Helper save 1 \(start its helper save\)/);
 assert.match(r.target.reason,/Raikou from Engine 50 \(long helper task\)/);
 assert.doesNotMatch(r.target.reason,/both are planned/);
});
