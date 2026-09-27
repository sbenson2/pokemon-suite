import test from 'node:test';
import assert from 'node:assert/strict';
import {selectFameChecker,fameRosterRestorationComplete} from '../src/suite/postgame-collection-extras.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';
import {postgameChecklist,resolvePostgameObjective} from '../src/suite/postgame-agenda.js';
import {postgameProgress} from '../src/suite/postgame-progress.js';
import {canYieldPostgame,createPostgameController} from '../src/suite/postgame.js';

const pokemon=(species,personality,moves)=>({validity:'valid',species,personality,otId:47,moves,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}});
const original=[pokemon(67,1,[67]),pokemon(149,2,[57]),pokemon(53,3,[163]),pokemon(3,4,[75]),pokemon(55,5,[70]),pokemon(22,6,[19])];
const cutUser=pokemon(46,7,[15]);
const world={maps:[
 {id:'MAP_CELADON_CITY',backgroundEvents:Array.from({length:8},(_,i)=>i===7?{script:'CeladonCity_EventScript_GymSign',x:16,y:31}:null)},
 {id:'MAP_CELADON_CITY_CONDOMINIUMS_1F',objectEvents:[null,null,null,{script:'CeladonCity_Condominiums_1F_EventScript_TeaWoman'}]},
 {id:'MAP_FIVE_ISLAND_WATER_LABYRINTH',objectEvents:[{script:'FiveIsland_WaterLabyrinth_EventScript_EggGentleman'}]}
]};

test('the retained Celadon sign route swaps in Cut and restores the original six across restarts',()=>{
 const records=Array.from({length:16},(_,person)=>({person,entries:63}));
 records[5].entries=62; // Erika's Gym sign fact is missing.
 records[1].entries=47; // Leave another Fame fact for the handoff.
 const o={phase:'stable',sram:{sha256:'before'},emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:'MAP_CELADON_CITY'},ui:{},
  gameStats:{savedGame:10},saveAttemptStatus:1,storyState:{flagIds:{2081:true}},
  trainer:{partyValidity:'valid',party:structuredClone(original),storage:{validity:'valid',pokemon:[structuredClone(cutUser)]}},
  postgameEvidence:{fameChecker:records}}};
 const state={active:'MAP_CELADON_CITY:background:7'};
 const prep=selectFameChecker(o,world,state,100);
 assert.equal(prep.target.kind,'party-roster');
 assert.equal(prep.target.map,'MAP_CELADON_CITY_POKEMON_CENTER_1F');
 assert.deepEqual(prep.target.requiredFingerprints,[encounterFingerprint(cutUser)]);
 assert.deepEqual(prep.target.requiredMoveIds,[15]);
 assert.deepEqual(state.cutRoster.original,original.map(encounterFingerprint));

 const resumed=structuredClone(state);
 o.playerMemory.trainer.party=[...original.slice(0,5),cutUser];
 o.playerMemory.trainer.storage.pokemon=[original[5]];
 const sign=selectFameChecker(o,world,resumed,101);
 assert.equal(sign.target.kind,'background');
 assert.equal(sign.target.index,7);

 records[5].entries=63;
 const restore=selectFameChecker(o,world,structuredClone(resumed),102);
 assert.equal(restore.target.kind,'party-roster');
 assert.deepEqual(restore.target.requiredFingerprints,original.map(encounterFingerprint));

 o.playerMemory.trainer.party=structuredClone(original);
 o.playerMemory.trainer.storage.pokemon=[cutUser];
 const save=selectFameChecker(o,world,resumed,103);
 assert.equal(save.target.kind,'save-game');
 o.playerMemory.gameStats.savedGame=11;o.sram.sha256='after';
 const next=selectFameChecker(o,world,resumed,104);
 assert.equal(next.target.kind,'object');
 assert.equal(next.target.map,'MAP_CELADON_CITY_CONDOMINIUMS_1F');
 assert.equal(resumed.cutRoster,undefined);
});

test('a restarted Fame target uses the controller clock after its retained cooldown',()=>{
 const records=Array.from({length:16},(_,person)=>({person,entries:63}));
 records[5].entries=62;records[1].entries=47;
 const o={playerMemory:{map:{id:'MAP_CELADON_CITY'},trainer:{party:[...original.slice(0,5),cutUser]},
  postgameEvidence:{fameChecker:records}}};
 const retryAt=Date.now()+600000,targetKey='MAP_CELADON_CITY:background:7';
 const state={fame:{active:targetKey,failed:{[targetKey]:{retryAt}}}};
 const resumed=resolvePostgameObjective('fame-checker',o,world,state,{now:retryAt+1});
 assert.equal(resumed.target.kind,'background');
 assert.equal(resumed.target.index,7);
});

test('Daisy fact routes to the Tea Woman script instead of an empty map-arrival script',()=>{
 const records=Array.from({length:16},(_,person)=>({person,entries:63}));records[1].entries=47;
 const events=[];events[3]={script:'CeladonCity_Condominiums_1F_EventScript_TeaWoman'};
 const condo={maps:[{id:'MAP_CELADON_CITY_CONDOMINIUMS_1F',objectEvents:events}]};
 const o={playerMemory:{map:{id:'MAP_CELADON_CITY_CONDOMINIUMS_1F'},postgameEvidence:{fameChecker:records}}};
 const selected=selectFameChecker(o,condo,{});
 assert.equal(selected.target.kind,'object');
 assert.equal(selected.target.index,3);
});

test('the 96th fact keeps Fame ownership until the borrowed Cut member is returned',()=>{
 const records=Array.from({length:16},(_,person)=>({person,entries:63}));
 const o={phase:'stable',sram:{sha256:'before'},emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:'MAP_CELADON_CITY'},ui:{},
  gameStats:{savedGame:10},saveAttemptStatus:1,storyState:{flagIds:{2081:true,2092:true,2116:true}},
  trainer:{partyValidity:'valid',party:[...original.slice(0,5),cutUser],storage:{validity:'valid',pokemon:[original[5]],boxCounts:[1,...Array(13).fill(0)]}},
  postgameEvidence:{fameChecker:records}}};
 const workflows={fame:{active:'MAP_CELADON_CITY:background:7',cutRoster:{targetKey:'MAP_CELADON_CITY:background:7',
  original:original.map(encounterFingerprint),carrier:encounterFingerprint(cutUser)}}};
 assert.equal(postgameChecklist(o,workflows).find(e=>e.id==='fame-checker').status,'pending');
 assert.equal(postgameProgress(o,{workflows}).chapters.flatMap(c=>c.entries).find(e=>e.id==='fame-checker').status,'pending');
 assert.equal(resolvePostgameObjective('fame-checker',o,world,workflows).target.kind,'party-roster');
 o.playerMemory.trainer.party=structuredClone(original);o.playerMemory.trainer.storage.pokemon=[cutUser];
 assert.equal(postgameChecklist(o,workflows).find(e=>e.id==='fame-checker').status,'pending','the restore save still owns the last fact');
 assert.equal(resolvePostgameObjective('fame-checker',o,world,workflows).target.kind,'save-game');
 assert.equal(workflows.fame.cutRoster.save.linkSave.counter,10);
 assert.equal(canYieldPostgame({agenda:{workflows}},o),false);
 const resumed=structuredClone(workflows);o.playerMemory.gameStats.savedGame=11;o.sram.sha256='after';
 o.playerMemory.ui={saveDialog:{stage:'success'}};
 assert.equal(resolvePostgameObjective('fame-checker',o,world,resumed).target.saveVerified,true);
 assert.equal(resolvePostgameObjective('fame-checker',o,world,resumed).target.saveVerified,true,'a success menu cannot schedule a duplicate save');
 assert.equal(canYieldPostgame({agenda:{workflows:resumed}},o),false);
 o.playerMemory.ui={};assert.equal(resolvePostgameObjective('fame-checker',o,world,resumed),null);
 assert.equal(resumed.fame.cutRoster,undefined);
 assert.equal(postgameChecklist(o,resumed).find(e=>e.id==='fame-checker').status,'complete');
 assert.equal(postgameProgress(o,{workflows:resumed}).chapters.flatMap(c=>c.entries).find(e=>e.id==='fame-checker').status,'complete');
});

test('a restarted controller keeps the Fame roster save through its success menu',()=>{
 const records=Array.from({length:16},(_,person)=>({person,entries:63}));
 const fingerprints=original.map(encounterFingerprint),workflows={fame:{active:'MAP_CELADON_CITY:background:7',
  cutRoster:{targetKey:'MAP_CELADON_CITY:background:7',original:fingerprints,carrier:encounterFingerprint(cutUser),
   save:{linkSave:{counter:10,sha256:'before'}}}}};
 const o={captureId:'fame-save',frame:100,phase:'stable',sram:{captureId:'fame-save',frame:100,sha256:'after'},
  emulator:{captureId:'fame-save',frame:100,mode:'overworld',inBattle:false,inputReady:true},
  playerMemory:{captureId:'fame-save',frame:100,map:{id:'MAP_CELADON_CITY'},position:{x:10,y:10},
   ui:{saveDialog:{stage:'success'}},gameStats:{savedGame:11},saveAttemptStatus:1,
   storyState:{flagIds:{2081:true,2092:true,2116:true},variableIds:{}},postgameEvidence:{fameChecker:records},
   trainer:{partyValidity:'valid',party:structuredClone(original),usablePartyCount:6,money:50000,bag:{items:[],pokeBalls:[]},
    storage:{validity:'valid',pokemon:[cutUser],boxCounts:[1,...Array(13).fill(0)]},pokedex:{ownedSpecies:[46,67,149,53,3,55,22]}}}};
 const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
 const state={schema:'pokemon-suite/postgame/v1',agenda:{enabled:true,active:'fame-checker',entries:[],failures:{},workflows},
  objective:{id:'stale-fame-save',target:{kind:'save-game',map:'MAP_CELADON_CITY',saveVerified:false}}};
 const controller=createPostgameController({...args,state});controller.decide(o);
 assert.equal(controller.state().objective.id,'postgame-fame-restore-save');
 assert.equal(controller.state().objective.target.saveVerified,true);
 assert.equal(canYieldPostgame(controller.state(),o),false);
 o.playerMemory.ui={};controller.decide(o);
 assert.equal(controller.state().agenda.workflows.fame.cutRoster,undefined);
});

test('Daisy Egg Gentleman borrows only the original-OT Togetic and returns the six before saving',()=>{
 const records=Array.from({length:16},(_,person)=>({person,entries:63}));records[1].entries=59;
 const source='MAP_FIVE_ISLAND_WATER_LABYRINTH:object:0',playerOtId=1706568373;
 const togetic=pokemon(176,8,[45]);togetic.otId=playerOtId;
 const outsider=pokemon(176,9,[45]);
 const o={phase:'stable',sram:{sha256:'before'},emulator:{mode:'overworld',inBattle:false},playerMemory:{
  map:{id:'MAP_FIVE_ISLAND_WATER_LABYRINTH'},ui:{},gameStats:{savedGame:10},saveAttemptStatus:1,
  storyState:{flagIds:{730:true}},postgameEvidence:{fameChecker:records},
  trainer:{otId:playerOtId,party:structuredClone(original),storage:{validity:'valid',pokemon:[outsider,togetic]}}}};
 const state={active:source};let d=selectFameChecker(o,world,state,100);
 assert.equal(d.id,'postgame-fame-togetic-party');
 assert.deepEqual(d.target.requiredFingerprints,[encounterFingerprint(togetic)]);
 assert.equal(state.temporaryRoster.kind,'original-togetic');
 const resumed=structuredClone(state);
 o.playerMemory.trainer.party=[...original.slice(0,5),togetic];o.playerMemory.trainer.storage.pokemon=[outsider,original[5]];
 d=selectFameChecker(o,world,resumed,101);assert.equal(d.target.kind,'object');assert.equal(d.target.map,'MAP_FIVE_ISLAND_WATER_LABYRINTH');
 records[1].entries=63;assert.equal(selectFameChecker(o,world,resumed,102).id,'postgame-fame-restore-roster');
 o.playerMemory.trainer.party=structuredClone(original);o.playerMemory.trainer.storage.pokemon=[outsider,togetic];
 d=selectFameChecker(o,world,resumed,103);assert.equal(d.target.kind,'save-game');
 assert.equal(fameRosterRestorationComplete({fame:resumed}),false);
 o.playerMemory.gameStats.savedGame=11;o.sram.sha256='after';
 selectFameChecker(o,world,resumed,104);
 assert.equal(resumed.temporaryRoster,undefined);
 assert.equal(fameRosterRestorationComplete({fame:resumed}),true);
});

// Celadon Gym's yard has one entrance, through a Cut tree. Every gym object
// (Tamia, Lisa, Erika) and Brock's Pewter Museum journal need a borrowed Cut
// user exactly like the Gym sign. Live: Tamia failed with "No executable route".
const gymObjects=Array.from({length:7},(_,i)=>({3:{script:'CeladonCity_Gym_EventScript_Tamia'},5:{script:'CeladonCity_Gym_EventScript_Lisa'},6:{script:'CeladonCity_Gym_EventScript_Erika'}})[i]??null);
const cutWorld={maps:[...world.maps,{id:'MAP_CELADON_CITY_GYM',objectEvents:gymObjects},
 {id:'MAP_PEWTER_CITY_MUSEUM_1F',backgroundEvents:Array.from({length:4},(_,i)=>i>=2?{script:'PewterCity_Museum_1F_EventScript_PokemonJournalBrock'}:null)}]};
const cutObservation=(records,{party=structuredClone(original),stored=[structuredClone(cutUser)],map='MAP_CELADON_CITY_POKEMON_CENTER_1F'}={})=>({phase:'stable',sram:{sha256:'before'},
 emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:map},ui:{},gameStats:{savedGame:10},saveAttemptStatus:1,
  storyState:{flagIds:{2081:true}},trainer:{partyValidity:'valid',party,storage:{validity:'valid',pokemon:stored}},postgameEvidence:{fameChecker:records}}});

for(const [label,person,bit,targetKey,kind,index] of [
 ['Tamia (Celadon Gym object 3)',5,3,'MAP_CELADON_CITY_GYM:object:3','object',3],
 ['Lisa (Celadon Gym object 5)',5,2,'MAP_CELADON_CITY_GYM:object:5','object',5],
 ['Brock\'s Pewter Museum journal',2,5,'MAP_PEWTER_CITY_MUSEUM_1F:background:2','background',2],
]){
 test('a Cut-gated Fame source borrows the stored Cut user first: '+label,()=>{
  const records=Array.from({length:16},(_,person)=>({person,entries:63}));records[person].entries=63&~(1<<bit);
  const o=cutObservation(records),state={};
  const prep=selectFameChecker(o,cutWorld,state,100);
  assert.equal(prep.target.kind,'party-roster');
  assert.deepEqual(prep.target.requiredFingerprints,[encounterFingerprint(cutUser)]);
  assert.deepEqual(prep.target.requiredMoveIds,[15]);
  assert.equal(state.cutRoster.targetKey,targetKey);
  assert.deepEqual(state.cutRoster.original,original.map(encounterFingerprint));
  // With the carrier in the party the source itself is the objective.
  o.playerMemory.trainer.party=[...original.slice(0,5),cutUser];o.playerMemory.trainer.storage.pokemon=[original[5]];
  const source=selectFameChecker(o,cutWorld,state,101);
  assert.equal(source.target.kind,kind);assert.equal(source.target.index,index);
  // Collecting the fact restores the original six before the save.
  records[person].entries=63;
  const restore=selectFameChecker(o,cutWorld,state,102);
  assert.equal(restore.target.kind,'party-roster');
  assert.deepEqual(restore.target.requiredFingerprints,original.map(encounterFingerprint));
 });
}

test('a Cut-gated Fame source goes straight to its target when the party already knows Cut',()=>{
 const records=Array.from({length:16},(_,person)=>({person,entries:63}));records[5].entries=63&~8;
 const state={},o=cutObservation(records,{party:[...original.slice(0,5),cutUser],stored:[original[5]]});
 const d=selectFameChecker(o,cutWorld,state,100);
 assert.equal(d.target.kind,'object');assert.equal(d.target.map,'MAP_CELADON_CITY_GYM');assert.equal(d.target.index,3);
 assert.equal(state.cutRoster,undefined);
});

test('a Cut-gated Fame source without a stored Cut user stops for review',()=>{
 const records=Array.from({length:16},(_,person)=>({person,entries:63}));records[2].entries=63&~(1<<5);
 const d=selectFameChecker(cutObservation(records,{stored:[]}),cutWorld,{},100);
 assert.equal(d.target.kind,'stop-for-review');
 assert.match(d.target.reason,/Cut/);assert.doesNotMatch(d.target.reason,/Gym sign/,'the review names no single source');
});
