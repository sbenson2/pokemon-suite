import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {obedienceRisk,permanentTrainingParty} from '../engine/firered/src/player/training-policy.js';

export function replayTrainingBatch(options) {return replayBalancedProgression({...options,finishBatch:true});}

export function replayBalancedProgression({session,saved,inputs,finishBatch=false}) {
  const original=saved.metadata.campaign;
  assert.equal(original.state.objective.id,'train-surf-carrier');
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state});
  let controller=open(original.state),restarted=false,switched=false,selectedBadge=false;
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-balanced-progression',storyWatch:controller.storyWatch()});
  const before=observer.capture();let after=before,last='',batchBaseline=null;
  const party=o=>o.playerMemory.trainer.party;
  const identity=p=>JSON.stringify([p.otId,p.personality]);
  const initial=new Map(party(before).map(p=>[identity(p),p]));
  if(process.env.SUITE_REPLAY_TRACE==='1')console.log('# initial '+JSON.stringify(party(before).map(p=>({species:p.species,level:p.level,slot:p.slot,xp:p.experience,hp:p.hp,otId:p.otId}))));
  for(let i=0;i<6000;i++) {
    after=observer.capture();const decision=controller.decide(after),state=controller.state(),r=decision.winner?.recommendation;
    assert.notEqual(decision.kind,'blocked',decision.reason);
    const trace=JSON.stringify([after.emulator.mode,after.playerMemory.map.id,after.playerMemory.ui.party?.stage,state.objective?.id,r?.kind,r?.targetPartySlot,r?.objective]);
    if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# balanced '+after.frame+' '+trace);last=trace;}
    if(state.objective?.id==='badge-soul')selectedBadge=true;
    if(r?.targetPartySlot!=null&&after.emulator.mode==='battle') {
      const target=party(after).find(p=>p.slot===r.targetPartySlot);
      assert.ok(target&&!obedienceRisk(target,after),'use an obedient party member for the ordinary battle');
      switched=true;
    }
    if(switched&&!restarted&&after.playerMemory.ui.party) {
      controller=open(JSON.parse(JSON.stringify(state)));restarted=true;
    }
    const free=after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&!Object.values(after.playerMemory.ui).some(Boolean);
    if(finishBatch&&free&&!batchBaseline)batchBaseline=new Map(party(after).map(p=>[identity(p),p.experience]));
    const batch=state.player?.campaignPlanner?.commitments?.training;
    if(finishBatch&&free&&batch?.id==='finish-vs-seeker-response-batch') {
      assert.ok(permanentTrainingParty(party(after),original.state.fieldTeamPlan??original.record.teamPlan)
        .some(p=>p.species===batch.trainingSpecies),'a pending trainer response must not train the Fly helper');
    }
    const batchComplete=!after.playerMemory.vsSeeker?.rematchEntries?.slice(1).some(n=>n>0);
    const gains=party(after).filter(p=>p.experience>initial.get(identity(p))?.experience);
    if(free&&restarted&&selectedBadge&&gains.length>=2&&(!finishBatch||batchComplete)) {
      if(finishBatch) {
        // The preserved entry can already have the old foreign lead credited
        // for its opponent. Do not erase that native XP; prevent further use
        // when handling the remaining already-activated trainer responses.
        for(const p of party(after).filter(p=>obedienceRisk(p,after)))
          assert.equal(p.experience,batchBaseline.get(identity(p)),'remaining trainer XP goes to obedient teammates');
      } else assert.ok(gains.every(p=>!obedienceRisk(p,after)),'ordinary XP goes to the trainee and obedient finisher');
      assert.ok(gains.some(p=>[111,112].includes(p.species)),'the underlevelled permanent member earns native XP');
      assert.deepEqual(controller.record,original.record,'retain the random team and run commitment');
      assert.ok([...initial.keys()].every(id=>party(after).some(p=>identity(p)===id)),'preserve every original party member');
      assert.equal(after.sram.sha256,before.sram.sha256,'a routine battle must not edit the saved SRAM');
      return {before,after};
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('Balanced training did not complete the native battle and progression handoff.');
}
