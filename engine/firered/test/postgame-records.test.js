import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgameAgenda,postgameChecklist,resolvePostgameObjective} from '../src/suite/postgame-agenda.js';
import {canYieldPostgame} from '../src/suite/postgame.js';
import {postgameProgress} from '../src/suite/postgame-progress.js';
import {selectOwnedBreeding} from '../src/suite/native-breeding.js';

const mon=(species,personality)=>({species,personality,otId:10,validity:'valid',shiny:false,isEgg:false,heldItem:0,moves:[19],hp:100,maxHp:100,level:80});
const mechanics={data:{species:[{id:132,eggGroups:['EGG_GROUP_DITTO'],genderRatio:'MON_GENDERLESS'},{id:16,eggGroups:['EGG_GROUP_FLYING'],genderRatio:{call:'PERCENT_FEMALE',args:[50]}}]}};
const world={data:{maps:[{id:'MAP_FOUR_ISLAND_HOUSE2',objectEvents:[{script:'FourIsland_House2_EventScript_StickerMan'}]}]}};
const observation=()=>({frame:100,phase:'stable',emulator:{mode:'overworld',inBattle:false,inputReady:true},sram:{sha256:'before'},playerMemory:{map:{id:'MAP_FOUR_ISLAND_HOUSE2'},ui:{},storyState:{flagIds:{2092:true,2112:true,2116:true},variableIds:{0x4049:1,0x404a:1}},gameStats:{savedGame:10,leagueEntries:2,eggsHatched:1},trainer:{partyValidity:'valid',party:[mon(149,3)],storage:{validity:'valid',pokemon:[mon(132,1),mon(16,2)],boxCounts:[2,...Array(13).fill(0)]},pokedex:{ownedSpecies:[132,16,149]},bag:{},money:500000}}});

test('Hall and Egg records have executable agenda entries backed by native counters',()=>{
 const o=observation(),entries=postgameChecklist(o);
 for(const id of ['hall-sticker','egg-sticker']){const e=entries.find(e=>e.id===id);assert.ok(e,id);assert.equal(e.executable,true);assert.equal(e.status,'pending');}
 o.playerMemory.storyState.variableIds[0x4049]=4;
 assert.equal(postgameChecklist(o).find(e=>e.id==='hall-sticker').status,'complete');
});

test('record breeding can repeat an owned offspring without spending protected parents or reserve space',()=>{
 const trainer=observation().playerMemory.trainer;
 assert.equal(selectOwnedBreeding({trainer,mechanics}),null,'Dex acquisition must still choose missing species');
 const repeat=selectOwnedBreeding({trainer,mechanics,allowOwned:true});assert.equal(repeat?.speciesId,16);
 trainer.storage.pokemon[0].shiny=true;assert.equal(selectOwnedBreeding({trainer,mechanics,allowOwned:true}),null);
 trainer.storage.pokemon[0].shiny=false;trainer.storage.boxCounts=[...Array(13).fill(30),5];trainer.party=Array.from({length:6},(_,i)=>mon(149,10+i));
 assert.equal(selectOwnedBreeding({trainer,mechanics,allowOwned:true}),null);
});

test('Egg record schedules an owned-species hatch and reports full-storage dependency',()=>{
 const o=observation();let d=resolvePostgameObjective('egg-sticker',o,world,{}, {mechanics});
 assert.equal(d?.target.kind,'postgame-acquire');assert.equal(d.acquisition.kind,'breeding');assert.equal(d.acquisition.speciesId,16);
 o.playerMemory.trainer.storage.boxCounts=Array(14).fill(30);d=resolvePostgameObjective('egg-sticker',o,world,{}, {mechanics});
 assert.equal(d.target.kind,'stop-for-review');assert.match(d.target.reason,/spaces|storage/i);
 assert.equal(postgameChecklist(o).find(e=>e.id==='egg-sticker').storageBlocked,true,'full storage waits without consuming route retries');
 o.playerMemory.gameStats.eggsHatched=100;
 assert.equal(postgameChecklist(o).find(e=>e.id==='egg-sticker').storageBlocked,false,'claiming an earned sticker needs no additional slot');
});

test('Hall record repeats a verified rematch without replacing its original receipt',()=>{
 const o=observation(),receipt={nativeSaveVerified:true,leagueEntries:2,savedGame:9};
 o.playerMemory.map.id='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';
 let state={league:{receipt}};
 const d=resolvePostgameObjective('hall-sticker',o,world,state,{mechanics});
 assert.ok(d);assert.equal(d.importantBattle,true);assert.equal(d.battleCategory,'elite-four');
 assert.deepEqual(state.league.receipt,receipt);assert.equal(state.records['hall-sticker'].cycle.baseline.leagueEntries,2);
 state=structuredClone(state);o.playerMemory.gameStats.leagueEntries=3;o.playerMemory.gameStats.savedGame=11;o.sram.sha256='repeat';o.emulator={mode:'hall-of-fame',callback2:'CB2_HofIdle'};
 const agenda=new PostgameAgenda({enabled:true,workflows:state});agenda.observe(o);
 assert.equal(agenda.state.workflows.records['hall-sticker'].cycle.receipt,undefined);
 o.emulator={mode:'overworld',inBattle:false};agenda.observe(o);
 assert.equal(agenda.state.workflows.records['hall-sticker'].cycle.receipt.nativeSaveVerified,true);
 assert.deepEqual(agenda.state.workflows.league.receipt,receipt);
 resolvePostgameObjective('hall-sticker',o,world,agenda.state.workflows,{mechanics});
 assert.equal(agenda.state.workflows.records['hall-sticker'].lastRun.leagueEntries,3);
 assert.equal(agenda.state.workflows.records['hall-sticker'].cycle.baseline.leagueEntries,3);
});

test('sticker menu choice follows native brag categories and maximum thresholds',()=>{
 for(const [id,counter,variable,threshold] of [['hall-sticker','leagueEntries',0x4049,200],['egg-sticker','eggsHatched',0x404a,300]]){
  const o=observation();o.playerMemory.gameStats[counter]=threshold;o.playerMemory.storyState.variableIds[variable]=3;
  const d=resolvePostgameObjective(id,o,world,{}, {mechanics});
  assert.equal(d?.target.kind,'object');assert.equal(d.target.map,'MAP_FOUR_ISLAND_HOUSE2');assert.equal(d.target.index,0);
  assert.equal(d.choiceByRows[3],id==='hall-sticker'?0:1);assert.equal(d.choiceByRows[4],id==='hall-sticker'?0:1);
 }
 const o=observation();o.playerMemory.gameStats.leagueEntries=0;o.playerMemory.gameStats.eggsHatched=300;
 const d=resolvePostgameObjective('egg-sticker',o,world,{}, {mechanics});assert.equal(d.choiceByRows[2],0);assert.equal(d.choiceByRows[3],0);
});

test('a newly claimed sticker owns a later exact native save through restart',()=>{
 const o=observation(),m=o.playerMemory;let state={};m.gameStats.eggsHatched=300;m.storyState.variableIds[0x404a]=3;
 resolvePostgameObjective('egg-sticker',o,world,state,{mechanics});
 // A save before the NPC writes the sticker does not certify the claim.
 m.gameStats.savedGame++;o.sram.sha256='unrelated';m.saveAttemptStatus=1;
 m.storyState.variableIds[0x404a]=4;m.ui.fieldDialog={ready:true};
 let d=resolvePostgameObjective('egg-sticker',o,world,state,{mechanics});assert.equal(d.target.kind,'map');
 assert.equal(postgameChecklist(o,state).find(e=>e.id==='egg-sticker').status,'pending');
 assert.equal(postgameProgress(o,{workflows:state}).chapters.flatMap(c=>c.entries).find(e=>e.id==='egg-sticker').status,'pending');
 state=structuredClone(state);m.ui={};d=resolvePostgameObjective('egg-sticker',o,world,state,{mechanics});assert.equal(d.target.kind,'save-game');assert.equal(d.target.saveVerified,false);
 assert.equal(canYieldPostgame({agenda:{workflows:state}},o),false);
 state=structuredClone(state);m.gameStats.savedGame++;o.sram.sha256='claim-saved';
 assert.equal(resolvePostgameObjective('egg-sticker',o,world,state,{mechanics}),null);
 assert.equal(state.records['egg-sticker'].receipts.at(-1).nativeSaveVerified,true);
 assert.equal(postgameChecklist(o,state).find(e=>e.id==='egg-sticker').status,'complete');
 assert.equal(canYieldPostgame({agenda:{workflows:state}},o),true);
});
