import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgameController} from '../src/suite/postgame.js';

// The postgame owner starts, persists and gates the opt-in Mail supply.
const args={world:{data:{maps:[{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F',objectEvents:[]}],wildEncounters:[]}},story:{data:{scripts:[],symbols:{}}},mechanics:{data:{species:[],moves:[]}}};
function observation({candies=2,mail=null}={}){
 const o={captureId:'qmm',frame:100,phase:'stable',phaseReasons:[],emulator:{mode:'overworld',inBattle:false,inputReady:true},sram:{sha256:'save-10'},
  playerMemory:{map:{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F'},position:{x:7,y:4},ui:{},encounter:null,storyState:{flagIds:{2092:true,2112:true,2116:true},variableIds:{}},
   gameStats:{savedGame:10,wildBattles:0},saveAttemptStatus:1,
   mail:mail??{slots:Array.from({length:16},(_,slot)=>({slot,itemId:0,species:1})),party:[],allocatedPartySlots:0,orphanSlots:[],partyHoldsMail:false,box3Slot1:{empty:true,head:[]}},
   trainer:{partyValidity:'valid',party:[],usablePartyCount:0,money:10000,bag:{items:[{itemId:68,quantity:candies}]},pokedex:{ownedSpecies:[]},storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)}}}};
 for(const part of [o.emulator,o.sram,o.playerMemory])Object.assign(part,{frame:o.frame,captureId:o.captureId});
 return o;
}
test('a Rare Candy request becomes a Mail supply only when the owner enabled it',()=>{
 const on=createPostgameController({...args,qmmSupply:{enabled:true},clock:()=>0});
 on.beginPlayerTask({id:'candies',kind:'item',itemId:68,quantity:10});
 const decision=on.decide(observation());
 assert.equal(decision.kind,'resample');assert.match(decision.reason,/Rare Candy supply/);
 assert.equal(on.state().qmm.requestId,'player-candies');assert.equal(on.state().qmm.stockTarget,12,'baseline 2 plus the requested 10');
 const restored=createPostgameController({...args,state:JSON.parse(JSON.stringify(on.state())),qmmSupply:{enabled:true},clock:()=>0});
 assert.equal(restored.state().qmm.stockTarget,12,'the supply survives owner reconstruction');
 const off=createPostgameController({...args,clock:()=>0});
 off.beginPlayerTask({id:'candies',kind:'item',itemId:68,quantity:10});
 off.decide(observation());
 assert.equal(off.state().qmm,null,'off by default');
 assert.throws(()=>off.beginQmmSupply({requestId:'x'}),/Enable the Rare Candy supply/);
});
test('a stopped supply that holds nothing falls back and is not retried immediately',()=>{
 let now=0;
 const on=createPostgameController({...args,qmmSupply:{enabled:true},clock:()=>now});
 on.beginPlayerTask({id:'candies',kind:'item',itemId:68,quantity:10});
 on.decide(observation());
 // No Knock Off user, no trades left: prerequisites cannot be met.
 const o=observation();o.playerMemory.storyState.flagIds[0x24d]=true;
 const result=on.decide(o);
 assert.equal(result.kind,'resample');assert.match(result.reason,/unavailable/);
 assert.equal(on.state().qmm,null);assert.match(on.state().qmmLedger.unavailable.reason,/Knock Off/);
 now=1000;assert.equal(on.canYield(observation()),true);
});
test('a dirty supply keeps ownership: no handoff and no new task',()=>{
 const on=createPostgameController({...args,qmmSupply:{enabled:true},clock:()=>0});
 on.beginQmmSupply({requestId:'supply',stockTarget:30});
 const state=on.state();state.qmm.dirty=true;
 const owner=createPostgameController({...args,state,qmmSupply:{enabled:true},clock:()=>0});
 assert.equal(owner.canYield(observation()),false);
 assert.throws(()=>owner.beginPlayerTask({id:'walk',kind:'travel',map:'MAP_CELADON_CITY_POKEMON_CENTER_1F'}),/Finish the Rare Candy supply/);
});
test('Recycle training owns its wild XP encounters even when a Rare Candy request started the supply',()=>{
 // Without this permission the encounter guard flees every ordinary wild
 // battle, so Mr. Mime could never reach level 33 outside an evolution task.
 const moves=[{id:33,effect:'EFFECT_HIT',power:35,type:'TYPE_NORMAL',target:'MOVE_TARGET_SELECTED',accuracy:95,pp:35},{id:282,effect:'EFFECT_KNOCK_OFF',power:20,type:'TYPE_DARK',target:'MOVE_TARGET_SELECTED',accuracy:100,pp:20}];
 const training={...args,mechanics:{data:{species:[],moves}}};
 let pid=1;
 const mon=(species,slot,level,known)=>({validity:'valid',species,slot,level,hp:60,maxHp:60,moves:known,pp:known.map(()=>20),heldItem:0,personality:pid++,otId:7,isEgg:false,status1:0,
  stats:{attack:40,defense:40,speed:40,spAttack:40,spDefense:40},ivs:{hp:1,attack:1,defense:1,speed:1,spAttack:1,spDefense:1}});
 const view=(frame,battle)=>{
  pid=1;const party=[mon(122,0,20,[33]),mon(83,1,32,[31,282,14,33]),mon(149,2,90,[33])];
  const wild={validity:'valid',personality:555,otId:9,species:19,shiny:false,isEgg:false,level:5,hp:12,maxHp:12,nature:{id:0,name:'Hardy'},ivs:{hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0}};
  const o=observation();o.frame=frame;o.captureId=`train-${frame}`;
  Object.assign(o.emulator,{mode:battle?'battle':'overworld',inBattle:battle});
  Object.assign(o.playerMemory,{ui:battle?{battle:{stage:'action',cursor:0}}:{},battleTypeFlags:battle?4:0,battleOutcome:0,encounter:battle?{kind:'wild',validity:'valid',pokemon:wild}:null,
   battle:battle?{player:party[0],opponent:{...wild,stats:{attack:8},moves:[33],pp:[35],status1:0,status2:0,status3:0},turn:0}:null});
  Object.assign(o.playerMemory.storyState.flagIds,{0x24d:true,0x248:true});
  o.playerMemory.mail.party=party.map(p=>({slot:p.slot,heldItem:0,mailId:255,hasMail:false,linked:false}));
  Object.assign(o.playerMemory.trainer,{party,partyCount:3,usablePartyCount:3,bag:{items:[],pokeBalls:[{itemId:4,quantity:20}]},pokedex:{ownedSpecies:[19,83,122,149]}});
  for(const part of [o.emulator,o.sram,o.playerMemory])Object.assign(part,{frame,captureId:o.captureId});
  return o;
 };
 const owner=createPostgameController({...training,qmmSupply:{enabled:true},clock:()=>0});
 owner.beginQmmSupply({requestId:'train',stockTarget:5});
 owner.decide(view(1,false));
 assert.equal(owner.state().objective.id,'qmm-train-train-recycle');
 assert.equal(owner.state().objective.trainingFingerprint!==undefined,true);
 const decision=owner.decide(view(2,true));
 assert.notEqual(decision.reason,'protected-capture-workflow','the encounter guard does not force an escape');
 assert.notEqual(decision.winner?.recommendation?.objective,'leave-non-target-encounter');
});
test('the supervised planner worker accepts the supply command and reports its yield guard',async t=>{
 const {createPostgameClient}=await import('../src/suite/postgame-client.js');
 const client=createPostgameClient({...args,qmmSupply:{enabled:true}});t.after(()=>client.close());
 await client.beginQmmSupply({requestId:'worker-supply',stockTarget:9});
 assert.equal(client.state().qmm.requestId,'worker-supply','the worker thread allows beginQmmSupply');
 assert.equal(client.state().qmmEnabled,true);
 const o=observation();o.playerMemory.trainer.party=[{slot:0,species:122,heldItem:132}];o.playerMemory.mail.partyHoldsMail=true;
 assert.equal(client.canYield(o),false,'party Mail keeps the enabled supply in control');
 const off=createPostgameClient(args);t.after(()=>off.close());await off.ready();
 assert.equal(off.canYield(o),true,'with the setting off the player’s own Mail changes nothing');
});
test('turning the setting off drops a clean supply but a dirty one still finishes',()=>{
 const on=createPostgameController({...args,qmmSupply:{enabled:true},clock:()=>0});
 on.beginQmmSupply({requestId:'supply',stockTarget:30});
 const clean=JSON.parse(JSON.stringify(on.state()));
 assert.equal(createPostgameController({...args,state:clean,clock:()=>0}).state().qmm,null);
 const dirty=JSON.parse(JSON.stringify(on.state()));dirty.qmm.dirty=true;
 assert.equal(createPostgameController({...args,state:dirty,clock:()=>0}).state().qmm.requestId,'supply');
});
