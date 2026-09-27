import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {directTrainingPlan} from '../engine/firered/src/player/battle-model.js';

export function replayDirectTraining({session,saved,inputs}) {
  const original=saved.metadata.campaign;
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state,clock:()=>0});
  let controller=open(original.state),trained=null,restarted=false,last='';
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-direct-training',storyWatch:controller.storyWatch()});
  const before=observer.capture();
  for(let i=0;i<12000;i++) {
    const after=observer.capture(),m=after.playerMemory;
    if(trained&&!restarted&&m.ui.battle?.stage==='move'){
      controller=open(JSON.parse(JSON.stringify(controller.state())));restarted=true;
    }
    const decision=controller.decide(after),state=controller.state(),r=decision.winner?.recommendation;
    assert.notEqual(decision.kind,'blocked',decision.reason);
    const training=state.player?.campaignPlanner?.commitments?.training;
    const active=m.battle?.player,member=m.trainer.party.find(p=>p.slot===m.battle?.playerPartySlot&&p.species===active?.species);
    if(training&&member&&training.trainingPartySlot===member.slot&&m.ui.battle?.stage==='action'&&
        directTrainingPlan({mechanics:inputs.battle,member:{...member,...active},opponent:m.battle.opponent,weather:m.battle.weather})) {
      assert.equal(r?.targetCommand,'fight','a capable native trainee keeps its own battle');
      trained??={personality:member.personality,otId:member.otId,experience:member.experience};
    }
    if(process.env.SUITE_REPLAY_TRACE==='1'){
      const next=JSON.stringify([m.map.id,m.ui.battle?.stage,r?.kind,r?.objective,r?.targetPartySlot,training?.trainingSpecies,Boolean(trained)]);
      if(next!==last){console.log('# direct-training '+after.frame+' '+next);last=next;}
    }
    if(trained&&restarted&&!after.emulator.inBattle&&after.phase==='stable'&&after.emulator.mode==='overworld'){
      const member=m.trainer.party.find(p=>p.personality===trained.personality&&p.otId===trained.otId);
      assert.ok(member.experience>trained.experience,'the retained trainee earns native experience');
      const measurements=state.player?.campaignPlanner?.trainingMeasurements;
      assert.ok(Object.values(measurements?.samples??{}).some(s=>s.experience>0&&s.frames>0),
        'native trainee XP and complete-cycle frames are retained across restart');
      assert.equal(state.objective.id,'badge-earth');
      assert.deepEqual(controller.record,original.record);
      assert.equal(after.sram.sha256,before.sram.sha256);
      assert.deepEqual(m.trainer.party.map(p=>[p.personality,p.otId]).sort(),before.playerMemory.trainer.party.map(p=>[p.personality,p.otId]).sort());
      return {before,after};
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('Direct training did not finish a native battle with XP and a campaign handoff.');
}
