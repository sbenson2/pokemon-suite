import test from 'node:test';
import assert from 'node:assert/strict';
import {assertHuntHandoff} from '../src/suite/mission.js';
const o=()=>({phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{trainer:{partyValidity:'valid',party:[]}}});
test('new hunt cannot discard a protected battle, unsaved capture, or active trade',()=>{
 assert.throws(()=>assertHuntHandoff({...o(),emulator:{mode:'battle',inBattle:true}},{protected:true},{remotePlayers:0}),/battle|stable/i);
 assert.throws(()=>assertHuntHandoff(o(),{protected:true},{remotePlayers:0}),/protected/i);
 assert.throws(()=>assertHuntHandoff(o(),{protected:false},{remotePlayers:1}),/link/i);
});
test('a verified saved exchange may be retained as history while a new hunt continues the same game',()=>{
 const state={protected:true,nativeTrade:{completion:{nativeSaveVerified:true}}};
 assert.doesNotThrow(()=>assertHuntHandoff(o(),state,{remotePlayers:0},'saved-exit-incomplete'));
 assert.throws(()=>assertHuntHandoff(o(),state,{remotePlayers:0},'ready'),/protected/i);
});
