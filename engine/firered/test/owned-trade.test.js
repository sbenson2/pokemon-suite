import test from 'node:test';
import assert from 'node:assert/strict';
import * as preparation from '../src/suite/trade-preparation.js';
const field=()=>({phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{ui:{},trainer:{partyValidity:'valid',storage:{validity:'valid'}}}});
test('owned trade readiness allows a paused hunt or no hunt without inventing capture evidence',()=>{
 assert.doesNotThrow(()=>preparation.assertOwnedTradeReady({observation:field(),mission:{protected:false,status:'paused'},wireless:{remotePlayers:0}}));
 assert.doesNotThrow(()=>preparation.assertOwnedTradeReady({observation:field(),wireless:{remotePlayers:0}}));
 const battle={...field(),emulator:{mode:'battle',inBattle:true},playerMemory:{...field().playerMemory,encounter:{kind:'wild',validity:'valid',pokemon:{shiny:false}}}};
 assert.doesNotThrow(()=>preparation.assertOwnedTradeReady({observation:battle,wireless:{remotePlayers:0}}));
 battle.playerMemory.encounter.pokemon.shiny=true;
 assert.throws(()=>preparation.assertOwnedTradeReady({observation:battle,wireless:{remotePlayers:0}}));
});
test('owned trade readiness preserves capture, link, menu and campaign ownership boundaries',()=>{
 const base={observation:field(),wireless:{remotePlayers:0}};
 for(const extra of [
  {mission:{protected:true,status:'running'}},{capture:{nativeSaveVerified:false}},
  {campaign:{status:'paused'}},{running:true},{localBusy:true},
  {wireless:{remotePlayers:1}},{nativeTrade:{phase:'saving',exchangeStarted:true}},
  {observation:{...field(),emulator:{mode:'battle',inBattle:true}}},
  {observation:{...field(),playerMemory:{...field().playerMemory,ui:{storage:{stage:'main'}}}}},
 ]) assert.throws(()=>preparation.assertOwnedTradeReady({...base,...extra}));
 assert.doesNotThrow(()=>preparation.assertOwnedTradeReady({...base,campaign:{status:'complete'},mission:{protected:true,status:'complete'},capture:{nativeSaveVerified:true}}));
});
