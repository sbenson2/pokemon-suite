import assert from 'node:assert/strict';
import test from 'node:test';

const mechanics={species:{1:{id:1,name:'SPECIES_TEST',types:['TYPE_NORMAL'],baseHP:40,baseDefense:40,baseSpDefense:40}},
 moves:{1:{id:1,name:'MOVE_POUND',power:40,accuracy:100,type:'TYPE_NORMAL',effect:'EFFECT_HIT'},
 138:{id:138,name:'MOVE_DREAM_EATER',power:100,accuracy:100,type:'TYPE_PSYCHIC',effect:'EFFECT_DREAM_EATER'}},typeChart:[]};
const member=(slot=0,extra={})=>({slot,species:1,personality:slot+10,otId:20,level:30,hp:100,maxHp:100,status1:0,
 experience:1000,heldItem:0,moves:[1,138],pp:[30,10],stats:{attack:80,spAttack:80,defense:60,spDefense:60,speed:60},...extra});
function observe(frame,{battle=true,turn=0,slot=0,pp=30,lastMove=0,x=1,steps=100,experience=1000,items=5,count=10,opponentHp=80}={}){
 const party=[member(0,{experience}),member(1)];
 const player={...party[slot],battler:0,pp:[pp,10],moveState:{lastMove}};
 const opponent={...member(0),battler:1,hp:opponentHp};
 return {frame,phase:'stable',emulator:{mode:battle?'battle':'overworld',inBattle:battle},playerMemory:{map:{id:'MAP_A'},position:{x,y:1},
  gameStats:{steps,battles:count},battleOutcome:battle?0:1,battleTypeFlags:8,ui:{},
  trainer:{partyValidity:'valid',party,bag:{items:[{itemId:13,quantity:items}]}},
  battle:battle?{turn,playerPartySlot:slot,player,opponent,battlers:[player,opponent],battlerPartyIndexes:[slot,0]}:null}};
}
const campaign=(ms,extra={})=>({objective:{id:'badge'},task:{kind:'training',member:'[20,10]',targetLevel:31},supervision:{elapsedMs:ms},...extra});
const decision=(kind,extra={})=>({kind:'act',winner:{advisor:'battle',recommendation:{kind,...extra},constraints:['positive-pp'],evidenceRefs:['cartridge:observed']}});
async function open(state=null){
 const m=await import('../src/suite/campaign-diagnostics.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
 assert.equal(typeof m.createCampaignDiagnostics,'function');return m.createCampaignDiagnostics({run:{id:'run-test'},mechanics,state});
}
test('move diagnostics retain conditional failures, alternatives and intent without inventing execution',async()=>{
 const d=await open(),o=observe(10),c=campaign(0),a=decision('choose-battle-move',{targetMoveId:138,targetMoveSlot:1});
 const before=structuredClone({o,c,a});d.observe(o,c);d.decide(o,a,c);d.decide(o,a,c);
 const s=d.summary();assert.equal(s.totals.decisions,1);assert.equal(s.totals.confirmedMoveAttempts,0);
 const e=s.recent.find(e=>e.kind==='decision');assert.ok(e.reviewSignals.includes('target-not-asleep'));
 assert.equal(e.moves.find(m=>m.moveId===1).usable,true);assert.deepEqual(e.evidenceRefs,['cartridge:observed']);
 assert.deepEqual({o,c,a},before,'diagnostics may not modify decision or cartridge observation');
});
test('native PP and last-move evidence confirm one attempt across repeated samples and restart',async()=>{
 let d=await open();const o=observe(10);d.observe(o,campaign(0));d.decide(o,decision('choose-battle-move',{targetMoveId:1,targetMoveSlot:0}),campaign(0));
 d=await open(d.state());d.observe(observe(20,{pp:29,lastMove:1,turn:1}),campaign(100));d.observe(observe(20,{pp:29,lastMove:1,turn:1}),campaign(100));
 assert.equal(d.summary().totals.confirmedMoveAttempts,1);assert.equal(d.summary().moves['1'].attempts,1);
});
test('swaps and consumed items need native evidence, not a selection-menu request',async()=>{
 const d=await open();const o=observe(10);d.observe(o,campaign(0));
 d.decide(o,decision('choose-party-member',{targetPartySlot:1}),campaign(0));
 assert.equal(d.summary().totals.switches,0);d.observe(observe(20,{slot:1}),campaign(100));assert.equal(d.summary().totals.switches,1);
 d.decide(observe(20,{slot:1}),decision('choose-bag-item',{targetItemId:13}),campaign(100));
 assert.equal(d.summary().totals.itemsConsumed,0);d.observe(observe(30,{slot:1,items:4}),campaign(200));
 assert.equal(d.summary().items['13'].consumed,1);d.observe(observe(40,{slot:1,items:4}),campaign(300));assert.equal(d.summary().totals.itemsConsumed,1);
});
test('repeated field medicine selections each count once across a controller restart',async()=>{
 let d=await open();const c=campaign(0,{task:null}),choice=decision('choose-bag-item',{targetItemId:13,targetIndex:0});
 const first=observe(10,{battle:false,items:5});d.observe(first,c);d.decide(first,choice,c);d.decide(first,choice,c);
 const second=observe(20,{battle:false,items:4});d.observe(second,c);d=await open(d.state());
 d.decide(second,choice,c);d.decide(second,choice,c);d.observe(observe(30,{battle:false,items:3}),c);
 assert.equal(d.summary().totals.itemsConsumed,2);
 assert.equal(d.summary().recent.filter(e=>e.kind==='item-consumed').length,2);
});
test('training records useful XP and all cycle time by identity, including travel, with pauses excluded',async()=>{
 let d=await open();d.observe(observe(10,{battle:false}),campaign(1000));
 d.observe(observe(110,{battle:true}),campaign(2000));d=await open(d.state());
 d.observe(observe(610,{battle:false,experience:1100,steps:120}),campaign(3000));
 const s=d.summary();assert.equal(s.training.byMap.MAP_A.activeMs,2000);assert.equal(s.training.byMap.MAP_A.traineeXp,100);
 assert.equal(s.training.byMap.MAP_A.traineeXpPerMinute,3000);assert.equal(s.members['[20,10]'].xp,100);
 d.observe(observe(610,{battle:false,experience:1100,steps:120}),campaign(3000));assert.equal(d.summary().members['[20,10]'].xp,100);
});
test('route diagnostics separate completed paths, stalls and intentional training revisits',async()=>{
 const d=await open(),c=campaign(0,{task:null});
 const route={buttons:['right'],movementLease:{kind:'route-plan',origin:{map:'MAP_A',x:1,y:1},target:{map:'MAP_A',x:3,y:1},segments:[{target:{map:'MAP_A',x:3,y:1}}]}};
 const a={...decision('move-toward'),action:route},o=observe(10,{battle:false});d.observe(o,c);d.decide(o,a,c);
 d.execution({observation:o,decision:a,execution:{startFrame:10,endFrame:30,movementLease:'target-reached'}});
 d.observe(observe(30,{battle:false,x:3,steps:102}),campaign(100,{task:null}));
 d.execution({observation:observe(30,{battle:false,x:3}),decision:a,execution:{startFrame:30,endFrame:60,movementLease:'stalled'}});
 d.observe(observe(60,{battle:false,x:1,steps:104}),campaign(200,{task:null}));
 const s=d.summary();assert.equal(s.navigation.routesCompleted,1);assert.equal(s.navigation.stalls,1);assert.equal(s.navigation.plannedStepsCompleted,2);assert.equal(s.navigation.observedSteps,4);assert.equal(s.navigation.revisitedPositions,1);
 const training=campaign(300);d.observe(observe(70,{battle:false,x:2,steps:105}),training);d.observe(observe(80,{battle:false,x:1,steps:106}),campaign(400));
 assert.ok(d.summary().navigation.trainingSteps>0);
});
test('partial battles, outcome uncertainty and diagnostic storage limits remain explicit',async()=>{
 const d=await open();d.observe(observe(10),campaign(0));d.observe(observe(20,{battle:false}),campaign(100));
 assert.equal(d.summary().battles[0].partial,true);assert.equal(d.summary().battles[0].outcome,'won');
 for(let i=0;i<600;i++){const o=observe(30+i,{turn:i});d.observe(o,campaign(200+i));d.decide(o,decision('choose-battle-command',{targetCommand:'fight'}),campaign(200+i));}
 assert.ok(d.summary().recent.length<=64);assert.ok(d.pendingEvents().length<=512);assert.ok(d.summary().archive.droppedEvents>0);
 const events=d.pendingEvents();d.ackEvents(events.at(-1).sequence);assert.equal(d.pendingEvents().length,0);
});

test('double-battle actor selection does not masquerade as a party swap',async()=>{
 const d=await open();
 const o=observe(10);o.playerMemory.battleTypeFlags=9;
 o.playerMemory.battle.battlers.push({...member(1),battler:2});o.playerMemory.battle.battlerPartyIndexes=[0,0,1];
 o.playerMemory.ui.battle={battler:0};d.observe(o,campaign(0));
 const next=structuredClone(o);next.frame=20;next.playerMemory.ui.battle.battler=2;
 d.observe(next,campaign(100));assert.equal(d.summary().totals.switches,0);
});

test('consuming the final item is recorded when its row disappears from the bag',async()=>{
 const d=await open(),o=observe(10,{items:1});d.observe(o,campaign(0));d.decide(o,decision('choose-bag-item',{targetItemId:13}),campaign(0));
 const next=observe(20);next.playerMemory.trainer.bag.items=[];d.observe(next,campaign(100));
 assert.equal(d.summary().items['13'].consumed,1);
});

test('party-menu permutations and unused singles battlers are not switches, including a restored measurement',async()=>{
 let d=await open(),o=observe(10,{slot:1});
 o.playerMemory.battle.battlersCount=2;
 o.playerMemory.battle.battlers.push({...member(0),battler:2});
 o.playerMemory.battle.battlerPartyIndexes.push(0);
 d.observe(o,campaign(0));
 const menu=structuredClone(o);menu.frame=20;
 menu.playerMemory.trainer.party.reverse().forEach((p,i)=>p.slot=i);
 menu.playerMemory.battle.battlerPartyIndexes=[0,0,1];
 menu.playerMemory.battle.playerPartySlot=0;
 d.observe(menu,campaign(100));
 assert.equal(d.summary().totals.switches,0,'the same individual remains active while the menu rearranges party slots');
 d=await open(d.state());o.frame=30;d.observe(o,campaign(200));
 assert.equal(d.summary().totals.switches,0);
 d.observe(observe(40,{slot:0}),campaign(300));
 assert.equal(d.summary().totals.switches,1,'a different individual entering the field is a switch');
});

test('credits and quest-log map playback do not count as overworld navigation',async()=>{
 const d=await open(),o=observe(10,{battle:false});
 d.observe(o,campaign(0,{status:'finishing',task:null}));
 const credits=observe(70,{battle:false,x:10,steps:100});credits.playerMemory.map.id='MAP_B';
 d.observe(credits,campaign(1000,{status:'finishing',task:null}));
 const playback=observe(130,{battle:false,x:2});playback.playerMemory.questLog={playback:true};
 d.observe(playback,campaign(2000,{status:'running',task:null}));
 const field=observe(190,{battle:false,x:1});d.observe(field,campaign(3000,{status:'running',task:null}));
 const walk=observe(250,{battle:false,x:2,steps:101});d.observe(walk,campaign(4000,{status:'running',task:null}));
 const n=d.summary().navigation;
 assert.equal(n.mapChanges,0);assert.equal(n.revisitedPositions,0);assert.equal(n.observedSteps,1);
 assert.equal(n.overworldActiveMs,1000);
});
