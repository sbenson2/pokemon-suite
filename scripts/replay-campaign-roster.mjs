import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';

export function replayCampaignBlockedClock(options) {
  const {state}=options.saved.metadata.campaign;
  assert.equal(state.supervision.stopReason,'no-meaningful-progress');
  assert.ok(state.supervision.idleMs>state.supervision.progressTimeoutMs);
  return replayCampaignRoster({...options,blockedClock:true});
}

export function replayCampaignRoster({session,saved,inputs,blockedClock=false}) {
  const {record,state}=saved.metadata.campaign;
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record,state});
  let controller=open(state),restarted=false,leftPC=false,selectedCapture=false;
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-roster-acquisition',storyWatch:controller.storyWatch()});
  const before=observer.capture();let after=before;
  assert.equal(state.reason,blockedClock?'no-meaningful-progress':'repeated-menu-transaction');
  assert.equal(state.objective.id,blockedClock?'master-native-112-capture':'assemble-permanent-roster');
  if(blockedClock) {
    const corrected=controller.state();
    assert.equal(corrected.supervision.stopReason,null);
    assert.ok(corrected.supervisionAccountingRepair.excludedMs>0);
    const stoppedIdleMs=state.recovery.current.finishedAt-Date.parse(state.supervision.lastProgressAt);
    const repair=corrected.supervisionAccountingRepair;
    assert.equal(repair.previous.idleMs-repair.excludedMs,stoppedIdleMs,'exclude exactly the documented review interval');
    assert.ok(corrected.supervision.idleMs>=stoppedIdleMs,'retain all consumed active time, including controller startup');
    for(const key of ['achievements','experience','recent','search'])assert.deepEqual(corrected.supervision[key],state.supervision[key]);
  }
  const owned=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon];
  assert.ok(!owned(before).some(p=>[111,112].includes(p.species)),'Rhyhorn has not been caught');
  const originals=owned(before).map(p=>[p.personality,p.otId]).sort();
  controller.resume({retryBlockedPolicy:true});
  let last='';
  for(let i=0;i<9000;i++) {
    after=observer.capture();
    const decision=controller.decide(after),r=decision.winner?.recommendation;
    const status=controller.state(),m=after.playerMemory;
    const trace=JSON.stringify([m.map.id,after.emulator.mode,m.ui.storage?.stage,status.objective?.id,r?.kind,r?.targetSpecies]);
    if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# roster '+after.frame+' '+trace+' '+(decision.reason??''));last=trace;}
    assert.notEqual(decision.kind,'blocked',decision.reason);
    if(!restarted&&(status.menuRecovery?.steps>0||blockedClock&&status.recovery.current?.status==='verifying')) {
      controller=open(JSON.parse(JSON.stringify(status)));restarted=true;
    }
    const free=after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&
      !Object.values(m.ui).some(Boolean);
    if(free&&!leftPC) {
      leftPC=true;
      assert.equal(after.sram.sha256,before.sram.sha256,'closing the PC cannot rewrite SRAM');
      assert.deepEqual(m.trainer.party,before.playerMemory.trainer.party);
      assert.equal(status.recovery.current.status,'verifying','PC exit alone is not task recovery');
    }
    if(status.objective?.id==='master-native-112-capture')selectedCapture=true;
    if(free&&selectedCapture&&m.trainer.party.some(p=>[111,112].includes(p.species))&&
        status.objective?.id!=='assemble-permanent-roster'&&status.objective?.id!=='master-native-112-capture'&&
        status.recovery.current.status==='recovered') {
      assert.ok(restarted&&leftPC,'complete recovery across restart');
      assert.equal(controller.record.commitment,record.commitment);
      assert.deepEqual(controller.record.teamPlan,record.teamPlan);
      const present=new Set(owned(after).map(p=>JSON.stringify([p.personality,p.otId])));
      assert.ok(originals.every(p=>present.has(JSON.stringify(p))),'preserve every original Pokemon');
      assert.ok(m.trainer.storage.pokemon.length+ m.trainer.party.length>originals.length,'capture a native Pokemon');
      assert.equal(status.player.transactionRecovery.blocked,null);
      return {before,after};
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('The PC recovery, missing capture and roster handoff did not finish within the native replay budget.');
}
