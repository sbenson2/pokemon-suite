import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgameController} from '../src/suite/postgame.js';

const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
test('evolution preparation survives restart and watches National Dex and One Island access',()=>{
 const p=createPostgameController(args);
 assert.equal(typeof p.prepareAcquisition,'function');
 p.prepareAcquisition({requestId:'umbreon',kind:'national-dex'});
 const s=p.state();assert.deepEqual(s.preparation,{requestId:'umbreon',kind:'national-dex'});
 const restored=createPostgameController({...args,state:s});
 assert.deepEqual(restored.state().preparation,s.preparation);
 for(const flag of [2092,2112,2203])assert.ok(restored.storyWatch().flags.includes(flag));
 assert.throws(()=>p.prepareAcquisition({requestId:'umbreon',kind:'rewrite-save'}),/preparation/);
});

test('continuing the same evolution keeps dungeon progress and verified save receipts',()=>{
 const pokemon={validity:'valid',species:133,personality:123,otId:456,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}};
 const request={requestId:'umbreon',sourceId:'eevee',pokemon,steps:[{kind:'trade',fromGame:'firered',toGame:'emerald',speciesId:133}],request:{speciesId:197,shiny:'required'}};
 let p=createPostgameController(args);p.beginEvolution(request);
 const state=p.state();state.preparation.linkQuest={map:'MAP_MT_EMBER_RUBY_PATH_B3F',completedBoulders:[0]};state.preparation.nativeLinkSave={nativeSaveVerified:true,savedSramSha256:'native'};
 p=createPostgameController({...args,state});p.beginEvolution(request);
 assert.deepEqual(p.state().preparation,state.preparation);
 assert.equal(p.state().evolution.originalPokemon.personality,123);
});

test('a completed evolution does not restart National Dex or link preparation after acknowledgement or restart',()=>{
 const p=createPostgameController(args);
 p.prepareAcquisition({requestId:'quagsire',kind:'national-dex'});
 p.acknowledgeEvolution();
 const o={captureId:'evolution-saved',frame:100,phase:'stable',phaseReasons:[],
  emulator:{mode:'overworld',inBattle:false,inputReady:true},sram:{sha256:'saved-evolution'},
  playerMemory:{map:{id:'MAP_ROUTE1'},position:{x:1,y:1},ui:{},encounter:null,
   storyState:{flagIds:{2092:true,2112:true,2116:true}},gameStats:{savedGame:268},saveAttemptStatus:1,
   trainer:{partyValidity:'valid',party:[],usablePartyCount:0,bag:{},pokedex:{ownedSpecies:Array.from({length:60},(_,i)=>i+1)},
    storage:{validity:'valid',pokemon:[]}}}};
 for(const part of [o.emulator,o.sram,o.playerMemory])Object.assign(part,{frame:o.frame,captureId:o.captureId});
 for(const controller of [p,createPostgameController({...args,state:p.state()})]){
  controller.decide(o);
  assert.equal(controller.state().objective,null);
  assert.equal(controller.state().preparation.phase,'complete');
  assert.equal(controller.state().preparation.nationalDexSave,undefined);
 }
});
