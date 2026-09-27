import assert from 'node:assert/strict';
import test from 'node:test';
import {createCentralPlayer,mapRecommendation} from '../src/player/delegator.js';
import {actionPreconditionMatches} from '../src/emulator/action-precondition.js';

// Hand-derived from FRLG HandleInputChooseMove: empty trailing slots cannot
// receive the cursor. Zero PP does not remove a learned move from this graph.
const nativeMoves={
  1:[{}],
  2:[{right:1},{left:0}],
  3:[{right:1,down:2},{left:0},{up:0}],
  4:[{right:1,down:2},{left:0,down:3},{up:0,right:3},{up:1,left:2}],
};
function observed({count=4,cursor=0,frame=100,turn=2,startMenu=false}={}){
  const captureId=`menu-${frame}`;
  const pokemon={species:46,slot:0,personality:123,otId:456,level:9,hp:25,maxHp:25,
    moves:[10,78,15,33].map((m,i)=>i<count?m:0),pp:[35,29,30,35].map((p,i)=>i<count?p:0)};
  return {captureId,frame,phase:'stable',phaseReasons:[],sram:{captureId,frame,sha256:'sram'},
    emulator:{captureId,frame,mode:startMenu?'start-menu':'battle',inBattle:!startMenu,inputReady:true},
    playerMemory:{captureId,frame,sha256:'memory',map:{id:'MAP_FUCHSIA_CITY'},position:{x:39,y:26},
      encounter:startMenu?{validity:'none'}:{kind:'trainer',validity:'valid'},trainer:{party:[pokemon],usablePartyCount:1},
      battle:startMenu?null:{turn,playerPartySlot:0,player:pokemon,opponent:{species:118,hp:31,maxHp:31,status1:64}},
      ui:startMenu?{startMenu:{cursor,count:3,order:['POKEDEX','POKEMON','BAG']}}:{battle:{stage:'move',battler:0,cursor,selectedMoveId:pokemon.moves[cursor]}}}};
}
for(const count of [1,2,3,4])for(let from=0;from<count;from++)for(let to=0;to<count;to++){
  test(`${count}-move native menu reaches slot ${to} from ${from} without entering an empty slot`,()=>{
    let cursor=from,confirmed=false;
    for(let step=0;step<5;step++){
      const o=observed({count,cursor});
      const action=mapRecommendation({kind:'choose-battle-move',targetMoveSlot:to,targetMoveId:o.playerMemory.battle.player.moves[to]},o);
      const button=action.buttons[0];
      if(button==='a'){assert.equal(cursor,to);confirmed=true;break;}
      const next=nativeMoves[count][cursor][button];
      assert.notEqual(next,undefined,`${button} from ${cursor} is not a native cursor transition`);
      cursor=next;
    }
    assert.ok(confirmed,'reach and confirm the requested move');
  });
}
test('an exhausted learned move remains a traversable cursor slot',()=>{
  const o=observed({count:3,cursor:1});o.playerMemory.battle.player.pp[0]=0;
  assert.deepEqual(mapRecommendation({kind:'choose-battle-move',targetMoveSlot:2,targetMoveId:15},o).buttons,['left']);
});
test('a missing move slot cannot be confirmed',()=>{
  const o=observed({count:3,cursor:1});
  assert.deepEqual(mapRecommendation({kind:'choose-battle-move',targetMoveSlot:3,targetMoveId:0},o).buttons,[]);
});

for(const count of [1,2,3,4])test(`double battle menu uses the second active Pokemon's ${count} moves`,()=>{
  let cursor=0,confirmed=false;
  for(let step=0;step<5;step++){
    const o=observed({count:1,cursor:0});
    const partner={battler:2,species:119,moves:[64,39,57,30].map((m,i)=>i<count?m:0),pp:[35,30,13,1]};
    o.playerMemory.battleTypeFlags=13;
    o.playerMemory.battle.battlers=[{...o.playerMemory.battle.player,battler:0},{},partner,{}];
    o.playerMemory.ui.battle={stage:'move',battler:2,cursor,selectedMoveId:partner.moves[cursor]};
    const action=mapRecommendation({kind:'choose-battle-move',targetMoveSlot:count-1,targetMoveId:partner.moves[count-1]},o);
    const button=action.buttons[0];
    if(button==='a'){assert.equal(cursor,count-1);confirmed=true;break;}
    const next=nativeMoves[count][cursor][button];
    assert.notEqual(next,undefined,'use the second battler menu, not the first battler moves');cursor=next;
  }
  assert.ok(confirmed);
});

function controller(startMenu=false,state=null){
  const recommendation=startMenu?{kind:'choose-start-menu-item',targetIndex:1,objective:'retained-goal'}:
    {kind:'choose-battle-move',targetMoveId:78,targetMoveSlot:1,objective:'retained-goal'};
  const advisor={id:'quest',advise:o=>({advisor:'quest',observationId:o.captureId,recommendation,
    confidence:1,constraints:[],vetoes:[],evidenceRefs:[]})};
  return createCentralPlayer({advisors:[advisor],initialState:state});
}
// The menu has been open for longer than FireRed's input settle window, so
// each later ignored press is evidence against its edge.
function settled(startMenu=false){const player=controller(startMenu);player.decide(observed({frame:80,startMenu}));return player;}
for(const startMenu of [false,true])test(`verified alternate routing recovers a rejected ${startMenu?'start-menu':'battle-menu'} edge across restarts`,()=>{
  let player=controller(startMenu),cursor=0,confirmed=false,sawRecovery=false;
  const failedButton=startMenu?'down':'right',trace=[];
  for(let step=0;step<20;step++){
    const o=observed({cursor,frame:100+step*4,startMenu}),decision=player.decide(o),button=decision.action.buttons[0];
    assert.notEqual(decision.kind,'blocked');
    assert.equal(decision.winner?.recommendation.objective,'retained-goal');
    if(decision.reason==='menu-route-recovery')sawRecovery=true;
    trace.push([cursor,button]);
    if(button==='a'){assert.equal(cursor,1);confirmed=true;break;}
    if(!(cursor===0&&button===failedButton)){
      cursor=startMenu?button==='up'?(cursor+2)%3:button==='down'?(cursor+1)%3:cursor:
        nativeMoves[4][cursor][button]??cursor;
    }
    player.observeExecution({observation:o,decision,execution:{startFrame:o.frame,endFrame:o.frame+2}});
    player=controller(startMenu,JSON.parse(JSON.stringify(player.state())));
  }
  assert.ok(confirmed,JSON.stringify(trace));assert.ok(sawRecovery);
  assert.ok(player.state().menuRouteRecovery.history.some(e=>e.outcome==='cursor-confirmed'));
});
test('a stale rejected input is not learned as a failed native cursor edge',()=>{
  let player=controller();
  for(let i=0;i<10;i++){
    const o=observed({frame:100+i*4}),decision=player.decide(o);
    assert.deepEqual(decision.action.buttons,['right']);
    player.observeExecution({observation:o,decision,execution:{interrupted:'stale-observation',startFrame:o.frame,endFrame:o.frame}});
    player=controller(false,JSON.parse(JSON.stringify(player.state())));
  }
  assert.deepEqual(player.decide(observed({frame:150})).action.buttons,['right']);
});
test('animation observations neither spend nor erase pending menu evidence',()=>{
  let player=settled();
  for(let i=0;i<4;i++){
    const o=observed({frame:100+i*10}),decision=player.decide(o);
    player.observeExecution({observation:o,decision,execution:{startFrame:o.frame,endFrame:o.frame+2}});
    const transition=observed({frame:o.frame+2});transition.phase='transition';transition.phaseReasons=['palette-fade'];transition.emulator.inputReady=false;
    player.decide(transition);
    player=controller(false,JSON.parse(JSON.stringify(player.state())));
  }
  assert.deepEqual(player.decide(observed({frame:150})).action.buttons,['down']);
});
test('a new battle turn may retry an edge that failed on the previous turn',()=>{
  const player=controller();
  for(let i=0;i<5;i++){
    const o=observed({frame:100+i*4}),decision=player.decide(o);
    player.observeExecution({observation:o,decision,execution:{startFrame:o.frame,endFrame:o.frame+2}});
  }
  assert.deepEqual(player.decide(observed({frame:150,turn:3})).action.buttons,['right']);
});
test('closing and reopening a menu retains rejected edges without granting another budget',()=>{
  let player=settled();
  for(let i=0;i<3;i++){
    const o=observed({frame:100+i*4}),decision=player.decide(o);
    player.observeExecution({observation:o,decision,execution:{startFrame:o.frame,endFrame:o.frame+2}});
  }
  assert.deepEqual(player.decide(observed({frame:120})).action.buttons,['down']);
  const closed=observed({frame:124});closed.playerMemory.ui.battle.stage='action';
  player.decide(closed);
  player=controller(false,JSON.parse(JSON.stringify(player.state())));
  assert.deepEqual(player.decide(observed({frame:128})).action.buttons,['down']);
});
test('receipts without executed frames cannot cause an alternate route',()=>{
  const player=controller();
  for(let i=0;i<8;i++){
    const o=observed({frame:100+i*4}),decision=player.decide(o);
    player.observeExecution({observation:o,decision,execution:{startFrame:o.frame,endFrame:o.frame}});
  }
  assert.deepEqual(player.decide(observed({frame:150})).action.buttons,['right']);
});
test('recovery routes carry the same fresh native action contract as ordinary inputs',()=>{
  const player=settled();
  for(let i=0;i<3;i++){
    const o=observed({frame:100+i*4}),decision=player.decide(o);
    player.observeExecution({observation:o,decision,execution:{startFrame:o.frame,endFrame:o.frame+2}});
  }
  const decision=player.decide(observed({frame:120}));
  assert.equal(decision.reason,'menu-route-recovery');
  assert.deepEqual(decision.action.buttons,['down']);
  assert.ok(decision.action.precondition,'the sole input writer must verify the recovery action too');
  assert.equal(actionPreconditionMatches(decision.action.precondition,observed({frame:121}),decision.action),true);
  assert.equal(actionPreconditionMatches(decision.action.precondition,observed({frame:121,cursor:1}),decision.action),false);
});
test('exhausting every safe route still stops without choosing a different move or losing the goal',()=>{
  let player=controller(),last;
  for(let i=0;i<240;i++){
    const o=observed({frame:100+i*4});last=player.decide(o);
    assert.ok(!last.action.buttons.includes('a'),'an unverified target is never confirmed');
    if(last.kind==='blocked')break;
    player.observeExecution({observation:o,decision:last,execution:{startFrame:o.frame,endFrame:o.frame+2}});
    player=controller(false,JSON.parse(JSON.stringify(player.state())));
  }
  assert.equal(last.kind,'blocked');assert.equal(last.reason,'repeated-menu-transaction');
});
// FireRed ignores directional input for roughly the first 12 frames after a
// battle action or move menu reopens (measured on an Elite Four rematch turn).
// Presses in that window are not evidence against a cursor edge; presses after
// it still are, so a genuinely rejected edge is recovered or stopped as before.
test('presses before a reopened battle menu accepts input are not learned as rejected edges',()=>{
  let player=controller();
  for(const frame of [100,102,104,106,108,110]){
    const o=observed({frame}),decision=player.decide(o);
    assert.deepEqual(decision.action.buttons,['right']);
    player.observeExecution({observation:o,decision,execution:{startFrame:o.frame,endFrame:o.frame+2}});
    player=controller(false,JSON.parse(JSON.stringify(player.state())));
  }
  assert.deepEqual(player.decide(observed({frame:120})).action.buttons,['right'],'early ignored presses are retried, not rejected');
  for(const frame of [120,124,128]){
    const o=observed({frame}),decision=player.decide(o);
    player.observeExecution({observation:o,decision,execution:{startFrame:o.frame,endFrame:o.frame+2}});
  }
  const later=player.decide(observed({frame:140}));
  assert.equal(later.reason,'menu-route-recovery','settled ignored presses still reject the edge');
  assert.deepEqual(later.action.buttons,['down']);
});
