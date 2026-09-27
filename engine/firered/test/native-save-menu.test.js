import test from 'node:test';
import assert from 'node:assert/strict';
import * as nativeSave from '../src/suite/native-cold-boot.js';
const {continueNativeSave,inspectNativeSaveContinuation}=nativeSave;
import {createPostgameController} from '../src/suite/postgame.js';
const setup={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
const atMenu=(cursor=0,saveStatus=1)=>({phase:'stable',emulator:{mode:'boot',callback2:'CB2_MainMenu',inputReady:true},playerMemory:{storyState:{flagIds:{2092:true}},saveFileStatus:saveStatus,ui:{mainMenu:{stage:'choose-save',cursor,options:['continue','new-game','mystery-gift'],selected:['continue','new-game','mystery-gift'][cursor],continueAvailable:true,saveStatus}}}});
test('the unknown frames immediately after reset must settle before declaring the saved game ready',()=>{
 const result=inspectNativeSaveContinuation({phase:'unknown',emulator:{mode:'unknown',callback2:null},playerMemory:{ui:{}}});
 assert.equal(result?.kind,'resample');assert.deepEqual(result?.action.buttons,[]);
});
test('live save continuation yields so the owner can keep answering status requests while booting',async()=>{
 assert.equal(typeof nativeSave.continueNativeSaveAsync,'function');
 let frames=0,statusServed=false;
 setImmediate(()=>{statusServed=true;});
 const o={phase:'unknown',emulator:{mode:'unknown'},playerMemory:{ui:{}}};
 const result=await nativeSave.continueNativeSaveAsync({step(){frames++;}},{capture:()=>frames<240?o:{phase:'stable',emulator:{mode:'overworld'},playerMemory:{}}});
 assert.equal(statusServed,true);assert.equal(result.emulator.mode,'overworld');
});
test('resuming the general bot at the title screen opens its native menu before planning a task',()=>{
 const p=createPostgameController(setup);
 const result=p.decide({phase:'stable',emulator:{mode:'boot',callback2:'CB2_TitleScreenRun',inputReady:true},playerMemory:{ui:{},storyState:null}});
 assert.deepEqual(result.action?.buttons,['a']);assert.equal(p.state().status,'running');
});
test('Continue is selected from the native menu even when New Game or Mystery Gift is highlighted',()=>{
 for(const initialCursor of [1,2]){
  let o=atMenu(initialCursor),openedNewGame=false;
  const session={step(buttons){
   if(o.emulator.mode==='overworld')return;
   if(buttons.includes('up'))o=atMenu(Math.max(0,o.playerMemory.ui.mainMenu.cursor-1));
   if(buttons.includes('a')){
    if(o.playerMemory.ui.mainMenu.cursor!==0){openedNewGame=true;o={...o,playerMemory:{ui:{newGame:{stage:'oak-dialog'}}}};}
    else o={phase:'stable',emulator:{mode:'overworld'},playerMemory:{ui:{},trainer:{otId:2161188857}}};
   }
  }};
  const result=continueNativeSave(session,{capture:()=>o});
  assert.equal(openedNewGame,false);assert.equal(result.playerMemory.trainer.otId,2161188857);
 }
});
test('postgame uses the same verified cursor instead of waiting for an overworld objective',()=>{
 const p=createPostgameController(setup);
 assert.deepEqual(p.decide(atMenu(1)).action?.buttons,['up']);
 assert.deepEqual(p.decide(atMenu(0)).action?.buttons,['a']);
});
test('missing, damaged, or unreadable native saves never confirm New Game',()=>{
 for(const saveStatus of [0,2,4,255,null]){
  const p=createPostgameController(setup),o=atMenu(0,saveStatus);
  const result=p.decide(o);
  assert.equal(result.kind,'blocked');assert.equal(result.action?.buttons.includes('a')??false,false);
 }
});
test('save-menu fade and unknown cursor wait without confirming an option',()=>{
 const p=createPostgameController(setup),o=atMenu(0);
 assert.deepEqual(p.decide({...o,phase:'transition'}).action?.buttons,[]);
 o.playerMemory.ui.mainMenu.cursor=null;o.playerMemory.ui.mainMenu.selected=null;
 assert.deepEqual(p.decide(o).action?.buttons,[]);
});
