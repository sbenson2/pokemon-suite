import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';

export function replayCampaignHomeHealing({session,saved,inputs}) {
  const original=saved.metadata.campaign;
  assert.equal(original.state.task.kind,'recovery');
  assert.equal(original.state.task.objective.target.map,'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F');
  const create=state=>createCampaignController({record:original.record,state,...inputs,mechanics:inputs.battle,clock:()=>0});
  let controller=create(original.state),restarted=false,healed=false,approached=false;
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-home-healing',storyWatch:controller.storyWatch()});
  const before=observer.capture();let after=before;
  const party=o=>o.playerMemory.trainer.party;
  assert.ok(party(before).some(p=>p.hp<p.maxHp));
  for(let i=0;i<2000;i++) {
    after=observer.capture();const decision=controller.decide(after),state=controller.state();
    assert.notEqual(decision.kind,'blocked',decision.reason);
    const home=after.playerMemory.map.id==='MAP_PALLET_TOWN_PLAYERS_HOUSE_1F';
    const free=after.phase==='stable'&&after.emulator.mode==='overworld'&&!Object.values(after.playerMemory.ui).some(Boolean);
    if(home&&decision.winner?.recommendation?.objective==='recover-party')approached=true;
    if(!restarted&&approached&&home&&after.playerMemory.ui.fieldDialog) {
      controller=create(JSON.parse(JSON.stringify(state)));restarted=true;
    }
    if(after.phase==='stable'&&party(after).every(p=>p.hp===p.maxHp&&p.status1===0))healed=true;
    if(healed&&free&&!home) {
      assert.ok(approached,'the actual healing task must own navigation after entering');
      assert.ok(restarted,'the healing dialogue must survive a controller restart');
      assert.equal(state.task?.kind==='recovery',false,'complete healing and hand control back to the campaign');
      assert.equal(after.playerMemory.map.id,'MAP_PALLET_TOWN');
      const identity=p=>[p.species,p.personality,p.otId,p.experience,p.moves];
      assert.deepEqual(party(after).map(identity),party(before).map(identity));
      assert.deepEqual(controller.record,original.record);
      return {before,after};
    }
    if(approached&&free&&!home)assert.ok(healed,'do not exit home before actually healing');
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('The campaign did not heal at home and hand off to the next task.');
}

export function replayCampaignSearch({session,saved,inputs}) {
  const original=saved.metadata.campaign;
  assert.equal(original.state.reason,'no-meaningful-progress');
  assert.equal(original.state.objective.id,'master-native-115-capture');
  // Replay the owning game's preserved stop in isolation. Re-arm only this
  // diagnostic watchdog; this continuation cannot qualify as a fresh run.
  const initial={...structuredClone(original.state),status:'running',reason:null,supervision:null};
  let now=0;
  const create=state=>createCampaignController({record:original.record,state,...inputs,
    mechanics:inputs.battle,clock:()=>now,progressTimeoutMs:2500});
  let controller=create(initial),restarted=false;
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-safari-search',storyWatch:controller.storyWatch()});
  const before=observer.capture();let after=before;
  assert.equal(before.playerMemory.map.id,'MAP_SAFARI_ZONE_EAST');
  for(let i=0;i<1800;i++) {
    after=observer.capture();now=after.frame-before.frame;
    const decision=controller.decide(after),state=controller.state();
    assert.notEqual(decision.kind,'blocked',decision.reason);
    assert.equal(state.objective.id,'master-native-115-capture');
    if(!restarted&&state.supervision.search.completedEncounters>=2&&state.supervision.search.pending) {
      controller=create(JSON.parse(JSON.stringify(state)));restarted=true;
    }
    if(state.supervision.search.completedEncounters>=6) {
      assert.ok(restarted,'retain the pending encounter across a controller restart');
      assert.ok(now>2500,'continue beyond the old false-stall deadline');
      assert.equal(after.emulator.mode,'overworld');
      assert.equal(after.emulator.inBattle,false);
      assert.deepEqual(after.playerMemory.trainer.party,before.playerMemory.trainer.party);
      assert.equal(after.sram.sha256,before.sram.sha256);
      // No more emulator inputs: the same field screen must still time out.
      now+=2501;
      assert.equal(controller.decide(after).reason,'no-meaningful-progress');
      return {before,after};
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('The campaign did not finish six independent Safari encounters.');
}
