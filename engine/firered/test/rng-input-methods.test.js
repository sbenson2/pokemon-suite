import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../src/rng/input-methods.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const field=()=>({phase:'stable',emulator:{mode:'overworld',inBattle:false,inputReady:true},playerMemory:{map:{id:'MAP_SAFARI_ZONE_NORTH'},position:{x:2,y:3},trainer:{party:[{slot:0,moves:[33]},{slot:1,moves:[230]}],bag:{keyItems:[{itemId:366,quantity:1}]}},ui:{}}});
const world={maps:[{id:'MAP_SAFARI_ZONE_NORTH',layout:{cells:[{x:2,y:3,encounterType:1}]}}]};
test('Sweet Scent navigation stops on the actual field move before the timed confirmation',()=>{
 assert.equal(typeof mod.rngMenuIntent,'function');
 const o=field();assert.equal(mod.rngMenuIntent(o,{goal:'sweet-scent',world}).recommendation.kind,'open-start-menu');
 o.playerMemory.ui.party={stage:'choose-pokemon',cursor:0};assert.equal(mod.rngMenuIntent(o,{goal:'sweet-scent',world}).recommendation.targetPartySlot,1);
 o.playerMemory.ui.party={stage:'selection-menu',selectedPartySlot:1,actions:['summary','sweet-scent','cancel'],actionCursor:0};
 assert.equal(mod.rngMenuIntent(o,{goal:'sweet-scent',world}).recommendation.targetIndex,1);
 o.playerMemory.ui.party.actionCursor=1;assert.equal(mod.rngMenuIntent(o,{goal:'sweet-scent',world}).kind,'ready');
 o.emulator.inBattle=true;assert.equal(mod.rngMenuIntent(o,{goal:'sweet-scent',world}).kind,'battle');
});
test('RNG setup delegates trainer and trapped ordinary battles to the central battle policy',()=>{
 const o=field();o.emulator.inBattle=true;
 for(const flags of [12,4,undefined]){
  o.playerMemory.battleTypeFlags=flags;
  for(const stage of ['action','message','party-select']){
   o.playerMemory.ui.battle={stage};
   assert.equal(mod.rngMenuIntent(o,{goal:'sweet-scent',world}).kind,'battle');
  }
 }
 o.playerMemory.battleTypeFlags=132;
 assert.equal(mod.rngMenuIntent(o,{goal:'sweet-scent',world}).kind,'encounter');
});
test('Teachy TV navigation observes the real key item and distinguishes startup from active acceleration',()=>{
 assert.equal(typeof mod.rngMenuIntent,'function');const o=field();
 o.playerMemory.ui.bag={stage:'list',pocket:0,index:0};assert.equal(mod.rngMenuIntent(o,{goal:'teachy-tv',world}).recommendation.targetPocket,1);
 o.playerMemory.ui.bag={stage:'list',pocket:1,index:0};assert.equal(mod.rngMenuIntent(o,{goal:'teachy-tv',world}).recommendation.targetIndex,0);
 o.emulator.callback2='TeachyTvMainCallback';assert.equal(mod.rngMenuIntent(o,{goal:'teachy-tv',world}).kind,'wait');
 o.emulator.callback2='TeachyTvCallback';assert.equal(mod.rngMenuIntent(o,{goal:'teachy-tv',world}).kind,'ready');
 assert.equal(mod.rngMenuIntent(o,{goal:'sweet-scent',world}).recommendation.kind,'close-menu');
});
test('seed selection only accepts repeated hardware timings and ranks short useful target paths',()=>{
 assert.equal(typeof mod.qualifyTitleSeeds,'function');
 const identity={rom:'r',core:'c',sram:'s'};
 const trials=[{titleFrames:2200,button:'a',seed:123,frame:2320,mode:'continue',identity},
  {titleFrames:2200,button:'a',seed:123,frame:2320,mode:'continue',identity},
  {titleFrames:2201,button:'a',seed:124,frame:2321,mode:'continue',identity},
  {titleFrames:2201,button:'a',seed:125,frame:2321,mode:'continue',identity}];
 const profiles=mod.qualifyTitleSeeds(trials);assert.equal(profiles.length,1);assert.equal(profiles[0].seed,123);
 assert.equal(mod.qualifyTitleSeeds([trials[0],{...trials[1],identity:{...identity,core:'different'}}]).length,0);
});
test('title timing refuses a reset without a verified native save and emits a reproducible held input',async()=>{
 assert.equal(typeof mod.runTitleTiming,'function');
 const session={frame:99,reset(){this.frame=0;},step(buttons){this.frame++;}};
 const observer={capture:()=>({phase:'stable',emulator:{callback2:session.frame>=2280?'CB2_MainMenu':'CB2_TitleScreenRun',mode:'boot',inBattle:false},playerMemory:{rng:{validity:'valid',mainState:123},ui:{newGame:null}}})};
 await assert.rejects(mod.runTitleTiming({session,observer,titleFrames:2200,nativeSaveVerified:false}),/native save/);
 assert.equal(session.frame,99);
 const result=await mod.runTitleTiming({session,observer,titleFrames:2200,nativeSaveVerified:true,yieldTask:async()=>{}});
 assert.equal(result.mode,'continue');assert.equal(result.seed,123);
 assert.deepEqual(result.trace,[{frames:2200,buttons:[]},{frames:120,buttons:['a']},{frames:90,buttons:[]}]);
 assert.equal(result.frame,2410);
});
test('title resets clear observer history so a backwards frame counter is not mistaken for a transition',async()=>{
 let lastFrame=10000;const session={frame:10000,reset(){this.frame=0;},step(){this.frame++;}};
 const observer={resetHistory(){lastFrame=-1;},capture(){const phase=thisFrame()<lastFrame?'transition':'stable';lastFrame=thisFrame();return {phase,emulator:{callback2:'CB2_MainMenu',inBattle:false},playerMemory:{rng:{validity:'valid',mainState:1},ui:{}}};}};
 function thisFrame(){return session.frame;}
 assert.equal((await mod.runTitleTiming({session,observer,titleFrames:2200,nativeSaveVerified:true,yieldTask:async()=>{}})).mode,'continue');
});
test('title reset qualification preserves every owned Pokémon, including unsaved captures in PC',()=>{
 const p={validity:'valid',species:16,personality:1,otId:2,ivs:{}};
 const o=mons=>({playerMemory:{trainer:{partyValidity:'valid',party:[],storage:{validity:'valid',pokemon:mons}}}});
 assert.equal(mod.nativeSavePreservesPokemon(o([p]),o([p])),true);
 assert.equal(mod.nativeSavePreservesPokemon(o([p]),o([])),false);
 assert.equal(mod.nativeSavePreservesPokemon(o([p]),{}),false);
});
