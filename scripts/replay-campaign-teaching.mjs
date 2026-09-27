import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';

export function replayCampaignTeaching({session,saved,inputs}) {
  const original=saved.metadata.campaign;
  assert.equal(original.state.objective.id,'teach-fly');
  assert.equal(original.state.player.transactionRecovery.blocked.reason,'repeated-menu-transaction');
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state});
  let controller=open(original.state),restarted=false,selected=false,last='';
  // The user reviewed the stopped transaction. Exercise the supported retry,
  // retaining its original party, objective, training batch and recovery log.
  controller.resume({retryBlockedPolicy:true});
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-teaching',storyWatch:controller.storyWatch()});
  const before=observer.capture();
  const identity=p=>JSON.stringify([p.otId,p.personality]);
  const initial=new Map(before.playerMemory.trainer.party.map(p=>[identity(p),p]));
  const charizard=before.playerMemory.trainer.party.find(p=>p.species===6);
  assert.ok(charizard&&!charizard.moves.includes(19),'start with Charizard awaiting Fly');
  assert.ok(before.playerMemory.vsSeeker.rematchEntries.some((n,i)=>i>0&&n>0),'retain the pending trainer responses');
  let after=before;
  for(let i=0;i<1600;i++) {
    after=observer.capture();
    const m=after.playerMemory,decision=controller.decide(after),state=controller.state(),r=decision.winner?.recommendation;
    const trace=JSON.stringify([after.emulator.mode,m.ui.party?.stage,m.ui.party?.itemId,m.ui.bag?.stage,m.ui.moveLearning?.stage,
      state.objective?.id,r?.kind,r?.objective,r?.targetItem,r?.targetPartySlot]);
    if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# teaching '+after.frame+' '+trace);last=trace;}
    assert.notEqual(decision.kind,'blocked',decision.reason);
    if(state.objective?.id==='teach-fly'&&r?.kind==='choose-start-menu-item')
      assert.equal(r.targetItem,'bag','teaching must own the menu instead of competing with training party order');
    if(m.ui.party?.itemId===340&&r?.kind==='choose-party-member') {
      assert.equal(identity(m.trainer.party[r.targetPartySlot]),identity(charizard));
      selected=true;
      if(!restarted){controller=open(JSON.parse(JSON.stringify(state)));restarted=true;}
    }
    const free=after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&!Object.values(m.ui).some(Boolean);
    if(free&&m.trainer.party.find(p=>identity(p)===identity(charizard))?.moves.includes(19)) {
      assert.ok(selected&&restarted,'teach the intended member across controller reconstruction');
      assert.notEqual(state.objective?.id,'teach-fly','hand control back to the following story objective');
      assert.deepEqual(controller.record,original.record,'retain the committed random team and seed');
      for(const p of m.trainer.party) {
        const prior=initial.get(identity(p));assert.ok(prior,'preserve each original Pokemon');
        assert.equal(p.experience,prior.experience,'teaching does not start another training battle');
        if(identity(p)!==identity(charizard))assert.deepEqual(p.moves,prior.moves);
      }
      // Opening the TM Case natively sorts its contents. Quantities, not the
      // cartridge's presentation order, establish whether an item was used.
      const contents=bag=>Object.fromEntries(Object.entries(bag).map(([pocket,items])=>
        [pocket,[...items].sort((a,b)=>a.itemId-b.itemId)]));
      assert.deepEqual(contents(m.trainer.bag),contents(before.playerMemory.trainer.bag),'the reusable HM consumes no items');
      assert.equal(after.sram.sha256,before.sram.sha256,'no native save or ROM patch is used to teach the move');
      return {before,after};
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('The native teaching transaction did not learn Fly, close its menus and resume the campaign.');
}
