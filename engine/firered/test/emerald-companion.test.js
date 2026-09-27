import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmeraldCompanion} from '../src/suite/emerald-companion.js';
import {createNativeSave} from '../../shared/games/emerald/player/native-save.mjs';
const runtime=()=>({stepButtons:()=>['a'],lastObservation:{battle:null},lastDecision:{recommendation:{kind:'battle-use-move'}},story:{status:()=>({activeObjective:{id:'mauville-wattson'}})}});
test('companion work supplies ordinary inputs to the same owner and persists its parent request',()=>{
 const r=runtime(),c=createEmeraldCompanion({runtime:r,requestId:'umbreon'});
 assert.deepEqual(c.next().action,{buttons:['a'],holdFrames:1,releaseFrames:0});
 assert.equal(c.state().objective.id,'mauville-wattson');
 assert.throws(()=>createEmeraldCompanion({runtime:r,requestId:'other',state:c.state()}),/another/);
});
test('a native shiny observation preempts the next attack and leaves the encounter preserved',()=>{
 const r=runtime();r.lastObservation.battle={isTrainer:false,enemyParty:[{validity:'valid',shiny:true,personality:123}]};
 const c=createEmeraldCompanion({runtime:r,requestId:'umbreon'});assert.equal(c.next().kind,'stop');
 assert.equal(c.state().protectedPokemon.personality,123);assert.equal(c.next().kind,'wait');
});
test('the end of an authored chapter never claims that Emerald can trade',()=>{
 const r=runtime();r.lastDecision.recommendation.kind='campaign-complete';
 const c=createEmeraldCompanion({runtime:r,requestId:'umbreon'});assert.equal(c.next().kind,'stop');
 assert.equal(c.state().phase,'waiting');assert.match(c.state().reason,/remaining native campaign/);
});

test('a completed companion requires its current native League and National Dex save before waiting for transfer',()=>{
 const o={frame:100,fieldReady:true,flag:()=>true,emulator:{paletteFadeActive:false},party:[{validity:'valid',species:279,personality:123,otId:456,ivs:{hp:31},moves:[]}],menus:{startMenu:null,menuCursor:0},nativeSave:{active:false,callback:null,counter:4,gameStat:3,differentFile:false}};
 const r=runtime();Object.assign(r,{lastObservation:o,observe:()=>o,createNativeSave,controller:{cancel(){}},session:{saveSram:()=>Buffer.from([1,2,3])}});r.lastDecision.recommendation.kind='campaign-complete';
 const c=createEmeraldCompanion({runtime:r,requestId:'umbreon'});assert.deepEqual(c.next().action.buttons,['start']);assert.equal(c.state().phase,'preparing');
 o.frame=112;o.fieldReady=false;o.menus.startMenu={actions:[0,1,2,3,4,5,6,7],cursor:5};c.next();
 o.frame=124;o.menus.startMenu=null;Object.assign(o.nativeSave,{active:true,callback:'SaveReturnSuccessCallback',counter:5,gameStat:4});c.next();
 o.frame=136;o.nativeSave.active=false;o.fieldReady=true;c.next();o.frame++;
 assert.equal(c.next().kind,'stop');assert.equal(c.state().phase,'ready-for-transfer');assert.match(c.state().reason,/National Dex.*saved/);
});

test('repeated route failures pause the companion instead of wandering indefinitely',()=>{
 const r=runtime(),c=createEmeraldCompanion({runtime:r,requestId:'umbreon'});
 r.lastDecision={sequence:1,recommendation:{kind:'no-route'}};
 for(let i=0;i<100;i++)assert.equal(c.next().kind,'input'); // one decision observed across many frames
 for(let sequence=2;sequence<30;sequence++){r.lastDecision={sequence,recommendation:{kind:'no-approach'}};assert.equal(c.next().kind,'input');}
 r.lastDecision={sequence:30,recommendation:{kind:'no-route'}};assert.equal(c.next().kind,'stop');assert.equal(c.state().phase,'waiting');
 c.resume();r.lastDecision={sequence:31,recommendation:{kind:'transit'}};assert.equal(c.next().kind,'input');
});

test('a companion milestone is saved natively and a resumed save owns inputs until verified',()=>{
 const o={frame:100,fieldReady:true,flag:()=>false,emulator:{paletteFadeActive:false},party:[{validity:'valid',species:183,personality:123,otId:456,ivs:{hp:31},moves:[]}],menus:{startMenu:null,menuCursor:0},nativeSave:{active:false,callback:null,counter:4,gameStat:3,differentFile:false}};
 const r=runtime();r.lastObservation=o;r.observe=()=>o;r.createNativeSave=createNativeSave;r.controller={cancel(){}};r.session={saveSram:()=>Buffer.from([1,2,3])};
 let c=createEmeraldCompanion({runtime:r,requestId:'umbreon'});
 assert.deepEqual(c.next().action.buttons,['start']);assert.ok(c.state().nativeSaveTask);
 c=createEmeraldCompanion({runtime:r,requestId:'umbreon',state:c.state()});
 o.frame=112;o.fieldReady=false;o.menus.startMenu={actions:[0,1,2,3,4,5,6,7],cursor:5};
 assert.deepEqual(c.next().action.buttons,['a']);
 o.frame=124;o.menus.startMenu=null;Object.assign(o.nativeSave,{active:true,callback:'SaveReturnSuccessCallback',counter:5,gameStat:4});c.next();
 o.frame=136;o.nativeSave.active=false;o.fieldReady=true;c.next();
 assert.equal(c.state().nativeSaveReceipt.counter,5);assert.match(c.state().nativeSaveReceipt.sha256,/^[a-f0-9]{64}$/);assert.equal(c.state().nativeSaveTask,null);
 o.frame++;assert.deepEqual(c.next().action.buttons,['a']);
 o.party.push({...o.party[0],personality:789});o.frame++;assert.deepEqual(c.next().action.buttons,['start']);
});

test('League recovery requires another native save before continuing with the healed team',()=>{
 const p={validity:'valid',species:279,personality:123,otId:456,ivs:{hp:31},hp:50,maxHp:100,status:0,types:[12],moves:[{id:348,power:70,type:12,pp:3}]};
 const o={frame:100,fieldReady:true,flag:()=>false,player:{map:{id:'MAP_EVER_GRANDE_CITY_SIDNEYS_ROOM'}},emulator:{paletteFadeActive:false},party:[p],menus:{startMenu:null,menuCursor:0},nativeSave:{active:false,callback:null,counter:4,gameStat:3,differentFile:false}};
 const r=runtime();Object.assign(r,{lastObservation:o,observe:()=>o,createNativeSave,controller:{cancel(){}},session:{saveSram:()=>Buffer.from([1])}});
 const first=createEmeraldCompanion({runtime:r,requestId:'umbreon'});first.next();
 const state=first.state();Object.assign(state,{savedMilestone:state.savingMilestone,savingMilestone:null,nativeSaveTask:null});
 const c=createEmeraldCompanion({runtime:r,requestId:'umbreon',state});p.hp=100;p.moves[0].pp=13;
 assert.deepEqual(c.next().action.buttons,['start']);
});

test('the Hall of Fame entry yields to its native scene instead of opening the start-menu save',()=>{
 const o={frame:100,fieldReady:true,flag:()=>false,player:{map:{id:'MAP_EVER_GRANDE_CITY_HALL_OF_FAME'}},emulator:{paletteFadeActive:false},party:[{validity:'valid',species:279,personality:123,otId:456,ivs:{hp:31},moves:[]}],menus:{startMenu:null,menuCursor:0},nativeSave:{active:false,counter:4,gameStat:3}};
 const r=runtime();Object.assign(r,{lastObservation:o,observe:()=>o,createNativeSave,controller:{cancel(){}},session:{saveSram:()=>Buffer.from([1])}});
 const c=createEmeraldCompanion({runtime:r,requestId:'umbreon'});assert.deepEqual(c.next().action.buttons,['a']);assert.equal(c.state().nativeSaveTask,undefined);
});

test('a completed companion refreshes its receipt after another native trade save',()=>{
 const o={frame:100,fieldReady:true,flag:()=>true,emulator:{paletteFadeActive:false},party:[{validity:'valid',species:279,personality:123,otId:456,ivs:{hp:31},moves:[]}],menus:{startMenu:null,menuCursor:0},nativeSave:{active:false,counter:4,gameStat:3}};
 const r=runtime();Object.assign(r,{lastObservation:o,observe:()=>o,createNativeSave,controller:{cancel(){}},session:{saveSram:()=>Buffer.from([1,2,3])}});r.lastDecision.recommendation.kind='campaign-complete';
 const initial=createEmeraldCompanion({runtime:r,requestId:'umbreon'});initial.next();
 const state=initial.state();Object.assign(state,{savedMilestone:state.savingMilestone,savingMilestone:null,nativeSaveTask:null,nativeSaveReceipt:{counter:3,gameStat:2,sha256:'old-native-save'}});
 const resumed=createEmeraldCompanion({runtime:r,requestId:'umbreon',state});
 assert.deepEqual(resumed.next().action.buttons,['start']);assert.equal(resumed.state().phase,'preparing');
});
