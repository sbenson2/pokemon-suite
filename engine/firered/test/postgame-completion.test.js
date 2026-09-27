import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/suite/postgame-completion.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('final completion requires every checkpoint and a fully acknowledged native save across restart',()=>{
 const o={phase:'stable',frame:500,emulator:{mode:'overworld',inBattle:false},sram:{sha256:'before'},playerMemory:{map:{id:'MAP_PALLET_TOWN'},storyState:{flagIds:{2092:true}},gameStats:{savedGame:10},saveAttemptStatus:1,ui:{}}};
 const incomplete={complete:false,completed:59,total:60},complete={complete:true,completed:60,total:60};
 assert.equal(typeof module.finishPostgame,'function');
 let state={};assert.equal(module.finishPostgame(o,state,incomplete),null);
 assert.equal(module.finishPostgame(o,state,complete).kind,'policy');
 state=structuredClone(state);o.playerMemory.gameStats.savedGame++;o.sram.sha256='after';o.playerMemory.ui.saveDialog={stage:'success'};
 assert.equal(module.finishPostgame(o,state,complete).kind,'policy');
 o.playerMemory.ui={};const result=module.finishPostgame(o,state,complete);
 assert.equal(result.kind,'complete');assert.equal(result.receipt.nativeSaveVerified,true);
 assert.equal(result.receipt.savedSramSha256,'after');
 assert.equal(module.finishPostgame(o,state,incomplete),null,'an older restored save must recheck all objectives');
});
