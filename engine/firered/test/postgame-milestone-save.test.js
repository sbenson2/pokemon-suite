import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgameController} from '../src/suite/postgame.js';
import {saveFireRedQuestMilestone} from '../src/suite/fire-red-link-quest.js';

const args={world:{data:{maps:[{id:'MAP_ONE_ISLAND_POKEMON_CENTER_1F',objectEvents:[{script:'OneIsland_PokemonCenter_1F_EventScript_Celio'}]}],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
const milestone={flagId:2112,id:'evolution-save-national-dex',label:'National Dex'};
function observation(count=10,ui={}){
 const o={captureId:`save-${count}-${Object.keys(ui)}`,frame:100+count,phase:'stable',phaseReasons:[],
  emulator:{mode:'overworld',inBattle:false,inputReady:true},sram:{sha256:`save-${count}`},
  playerMemory:{map:{id:'MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB'},position:{x:6,y:4},ui,encounter:null,
   storyState:{flagIds:{2092:true,2112:true,2116:false},variableIds:{16502:0}},gameStats:{savedGame:count},saveAttemptStatus:1,
   trainer:{partyValidity:'valid',party:[],usablePartyCount:0,bag:{},pokedex:{ownedSpecies:Array.from({length:60},(_,i)=>i+1)},storage:{validity:'valid',pokemon:[]}}}};
 for(const part of [o.emulator,o.sram,o.playerMemory])Object.assign(part,{frame:o.frame,captureId:o.captureId});
 return o;
}
function controller(){
 const p=createPostgameController(args);p.prepareAcquisition({requestId:'suicune',kind:'national-dex'});
 const state=p.state();state.preparation.travelReady=true;
 state.objective={id:'evolution-unlock-national-dex',target:{kind:'object',map:'MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB',index:0}};
 return createPostgameController({...args,state});
}
test('a milestone owns its native save through the success dialog and hands off without an extra save',()=>{
 let p=controller();p.decide(observation());
 assert.equal(p.state().objective.id,'evolution-save-national-dex');
 assert.equal(p.state().save,null,'The generic objective checkpoint must not also own this save');
 p=createPostgameController({...args,state:p.state()});
 p.decide(observation(11,{saveDialog:{stage:'success'}}));
 assert.equal(p.state().objective.target.saveVerified,true,'The save owner refreshes evidence while its dialog is open');
 p.decide(observation(11));
 assert.equal(p.state().preparation.nationalDexSave.nativeLinkSave.nativeSaveVerified,true);
 assert.notEqual(p.state().objective.target.kind,'save-game','Hand off immediately after the owned save completes');
 assert.equal(p.state().save,null);
});
test('a failed milestone save stops without the generic checkpoint starting another save',()=>{
 let p=controller();const state=p.state();state.preparation.nationalDexSave={linkSave:{counter:10,sha256:'save-10'}};
 state.objective={id:'evolution-save-national-dex',target:{kind:'save-game',saveVerified:false}};
 p=createPostgameController({...args,state});
 const result=p.decide(observation(11,{saveDialog:{stage:'error'}}));
 assert.equal(result.kind,'blocked');assert.equal(p.state().save,null);
});
test('a resumed milestone with extra successful saves requires one fresh save before accepting its receipt',()=>{
 const state={linkSave:{counter:10,sha256:'save-10'}},o=observation(13);
 const next=saveFireRedQuestMilestone(o,state,milestone);
 assert.equal(next.kind,'policy');assert.equal(next.objective.target.saveVerified,false);
 assert.equal(state.nativeLinkSave,undefined);
 assert.equal(saveFireRedQuestMilestone(observation(14),state,milestone).kind,'ready');
});
test('failed, unfinished, or repeatedly displaced milestone saves are never accepted as repaired',()=>{
 for(const ui of [{saveDialog:{stage:'error'}},{saveDialog:{stage:'saving'}}]){
  const state={linkSave:{counter:10,sha256:'save-10'}};
  assert.equal(saveFireRedQuestMilestone(observation(13,ui),state,milestone).kind,'stop');
  assert.equal(state.nativeLinkSave,undefined);
 }
 const state={linkSave:{counter:10,sha256:'save-10'}};
 saveFireRedQuestMilestone(observation(13),state,milestone);
 assert.equal(saveFireRedQuestMilestone(observation(15),state,milestone).kind,'stop');
});

test('adventure prerequisite completion owns the link save through restart and then chooses island work',()=>{
 let p=createPostgameController(args);p.beginAdventure();let state=p.state();
 state.preparation.travelReady=true;state.preparation.nationalDexSave={nativeLinkSave:{nativeSaveVerified:true}};
 p=createPostgameController({...args,state});
 const o=observation();o.playerMemory.storyState.flagIds[2116]=true;o.playerMemory.storyState.flagIds[2121]=false;
 p.decide(o);assert.equal(p.state().objective.id,'sevii-save-link-unlock');
 p=createPostgameController({...args,state:p.state()});
 const saved=observation(11,{saveDialog:{stage:'success'}});saved.playerMemory.storyState.flagIds[2116]=true;
 p.decide(saved);assert.equal(p.state().objective.target.saveVerified,true);
 saved.playerMemory.ui={};p.decide(saved);
 assert.equal(p.state().preparation.phase,'complete');
 assert.equal(p.state().preparation.nativeLinkSave.nativeSaveVerified,true);
 const agendaOnly=createPostgameController({...args,state:{schema:'pokemon-suite/postgame/v1',agenda:p.state().agenda}});
 assert.equal(agendaOnly.state().preparation.phase,'complete','hunt handoff retains the verified prerequisite receipt');
});
