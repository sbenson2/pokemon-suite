import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {moveCatalog} from '../engine/firered/src/player/move-knowledge.js';

export function replayMoveUnderstanding({session,saved,inputs}) {
  const mechanics=inputs.battle.data??inputs.battle;
  for(const move of moveCatalog.moves)assert.deepEqual(move,mechanics.moves[move.id],`native move ${move.id} must match the local catalog`);
  const original=saved.metadata.campaign;
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state,clock:()=>0});
  let controller=open(original.state),restarted=false,selected=false;
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-move-understanding',storyWatch:controller.storyWatch()});
  const before=observer.capture(),start=before.playerMemory.battle;
  assert.equal(start.player.species,93);
  assert.equal(start.opponent.species,72);
  assert.equal(start.opponent.status1,0);
  assert.equal(start.player.moveState.lastMove,138);
  for(let i=0;i<1800;i++) {
    const after=observer.capture(),m=after.playerMemory;
    if(m.ui.battle?.stage==='move'&&!restarted){controller=open(JSON.parse(JSON.stringify(controller.state())));restarted=true;}
    const decision=controller.decide(after),r=decision.winner?.recommendation;
    assert.notEqual(decision.kind,'blocked',decision.reason);
    if(m.ui.battle?.stage==='move'&&r?.kind==='choose-battle-move') {
      assert.notEqual(r.targetMoveId,138,'Dream Eater cannot damage this awake Tentacool');
      assert.ok([101,247,325].includes(r.targetMoveId));selected=true;
    }
    if(selected&&!after.emulator.inBattle&&after.phase==='stable'&&after.emulator.mode==='overworld') {
      assert.ok(restarted);
      assert.equal(after.sram.sha256,before.sram.sha256);
      assert.equal(controller.state().objective.id,'badge-earth');
      assert.deepEqual(controller.record,original.record);
      assert.deepEqual(m.trainer.party.map(p=>[p.personality,p.otId,p.species]),before.playerMemory.trainer.party.map(p=>[p.personality,p.otId,p.species]));
      return {before,after};
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('The battle did not finish and return to the retained badge objective.');
}
