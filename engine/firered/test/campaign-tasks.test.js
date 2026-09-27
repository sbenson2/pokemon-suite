import assert from 'node:assert/strict';
import test from 'node:test';
import {campaignTaskFixture} from '../test-support/campaign-task-fixture.js';

test('stalled training changes location without changing trainee or forgetting rejected trainers on restart',()=>{
 const f=campaignTaskFixture({training:true});
 f.world.wildEncounters=[{map:f.city.id,land_mons:{encounter_rate:20,mons:[{species:'SPECIES_DIGLETT',min_level:15,max_level:15}]}}];
 f.city.layout.cells.filter(c=>c.y===4).forEach(c=>{c.encounterType=1;});
 let {planner}=f.open();const o=f.observation(1,{responses:true,healed:true});
 const preparation=f.observation(0,{responses:false,healed:true});planner.selectTraining(preparation,planner.select(preparation));
 const first=planner.selectTraining(o,planner.select(o));assert.equal(first.trainer.id,42);
 const before=planner.state(),strategy=planner.recoverStalledTask(o);
 assert.equal(strategy?.kind,'alternate-training');assert.equal(strategy.to.map,f.city.id);
 ({planner}=f.open({...f.open().player.state(),campaignPlanner:JSON.parse(JSON.stringify(planner.state()))}));
 const selected=planner.selectTraining(o,planner.select(o));
 assert.equal(selected.target.map,f.city.id);assert.equal(selected.trainingSpecies,5);
 assert.equal(planner.state().tasks.training.member,before.tasks.training.member);
});

test('healing remains the active task after map changes clear the trainer responses',()=>{
  const f=campaignTaskFixture(),{player}=f.open();
  const start=player.decide(f.observation(1));
  assert.equal(start.winner.recommendation.objective,'recover-training-party');
  const across=player.decide(f.observation(2,{map:f.city.id,responses:false}));
  assert.equal(across.winner?.recommendation.targetMap,f.center.id);
  assert.equal(across.winner?.recommendation.objective,'recover-training-party');
});

test('healing survives checkpoint restoration and completes only with the same recovered members',()=>{
  const f=campaignTaskFixture();let {player}=f.open();
  player.decide(f.observation(1));
  const checkpoint=JSON.parse(JSON.stringify(player.state()));
  ({player}=f.open(checkpoint));
  const across=player.decide(f.observation(2,{map:f.city.id,responses:false}));
  assert.equal(across.winner?.recommendation.targetMap,f.center.id);
  const restored=player.decide(f.observation(3,{map:f.center.id,responses:false,healed:true}));
  assert.notEqual(restored.winner?.recommendation.objective,'recover-training-party');
});

test('a healthy replacement of the same species cannot satisfy an injured members recovery task',()=>{
  const f=campaignTaskFixture(),{player}=f.open();player.decide(f.observation(1));
  const changed=structuredClone(f.party);changed[1].personality=303;
  const d=player.decide(f.observation(2,{map:f.city.id,responses:false,members:changed,healed:true}));
  assert.equal(d.kind,'blocked');assert.equal(d.reason,'recovery-member-unavailable');
});

test('a recovery task survives party reorder and ignores transient healed observations',()=>{
  const f=campaignTaskFixture(),{player}=f.open();player.decide(f.observation(1));
  player.decide(f.observation(2,{map:f.city.id,responses:false,healed:true,phase:'transition'}));
  const party=[...f.party].reverse().map((p,slot)=>({...p,slot}));
  const d=player.decide(f.observation(3,{map:f.city.id,responses:false,members:party}));
  assert.equal(d.winner?.recommendation.targetMap,f.center.id);
});

test('VS Seeker response handling preserves the member whose training unlocks the parent objective',()=>{
  const f=campaignTaskFixture({training:true}),{planner}=f.open();
  const first=f.observation(1,{responses:false});
  const planned=planner.selectTraining(first,planner.select(first));
  assert.equal(planned?.trainingSpecies,5);
  const responding=f.observation(2);
  const batch=planner.selectTraining(responding,planner.select(responding));
  assert.equal(batch.trainingSpecies,5);
  assert.equal(batch.minimumTeamAnchorLevel,36);
});

test('restored training identifies its intended Pokemon after party slots change',()=>{
  const f=campaignTaskFixture({training:true});let {planner}=f.open();const o=f.observation(1,{responses:false});
  planner.selectTraining(o,planner.select(o));
  const state={...f.open().player.state(),campaignPlanner:JSON.parse(JSON.stringify(planner.state()))};
  ({planner}=f.open(state));
  const members=[...f.party].reverse().map((p,slot)=>({...p,slot}));const next=f.observation(2,{members});
  const selected=planner.selectTraining(next,planner.select(next));
  assert.equal(selected.trainingSpecies,5);assert.equal(selected.trainingPartySlot,1);
});

test('ordinary training retains its committed member when another eligible member arrives',()=>{
  const f=campaignTaskFixture({training:true}),{planner}=f.open();const first=f.observation(1,{responses:false});
  planner.selectTraining(first,planner.select(first));
  const members=[...f.party,{...f.party[0],slot:2,personality:404,level:31,experience:26000}];
  const next=f.observation(2,{responses:false,members});
  assert.equal(planner.selectTraining(next,planner.select(next)).trainingPartySlot,0);
});

test('training reports a missing committed member instead of quietly replacing it',()=>{
  const f=campaignTaskFixture({training:true}),{planner,player}=f.open();const first=f.observation(1,{responses:false});
  planner.selectTraining(first,planner.select(first));
  const replacement=f.party.map(p=>({...p,personality:p.personality+1000}));
  const decision=player.decide(f.observation(2,{responses:false,members:replacement}));
  assert.equal(decision.kind,'blocked');assert.equal(decision.reason,'training-member-unavailable');
});

test('a changed parent objective releases an unfinished training assignment',()=>{
  const f=campaignTaskFixture({training:true});
  f.objective.completion={kind:'flag-set',id:9999};
  f.campaign.objectives.push({id:'next-task',target:{kind:'object',map:f.route.id,index:0},completion:{kind:'flag-set',id:9998}});
  const {planner}=f.open(),first=f.observation(1,{responses:false});
  planner.selectTraining(first,planner.select(first));
  const next=f.observation(2,{responses:false});next.playerMemory.storyState.flagIds[9999]=true;
  assert.equal(planner.select(next).id,'next-task');
  assert.equal(planner.campaignStatus().activeTask,undefined);
});

test('a recovery member moved into verified storage is reassembled and healed without accepting a substitute',()=>{
 const f=campaignTaskFixture();let {player,planner}=f.open();player.decide(f.observation(1));
 const changed=structuredClone(f.party);changed[1].personality=303;
 const o=f.observation(2,{map:f.city.id,responses:false,members:changed});
 o.playerMemory.trainer.storage={validity:'valid',pokemon:[{...f.party[1],validity:'valid',box:0,slot:0}]};
 o.playerMemory.trainer.party.forEach(p=>p.validity='valid');
 const decision=player.decide(o);assert.notEqual(decision.kind,'blocked',decision.reason);
 assert.equal(planner.select(o)?.target.kind,'party-roster');
 ({player,planner}=f.open(JSON.parse(JSON.stringify(player.state()))));
 const restored=f.observation(3,{map:f.center.id,responses:false});
 restored.playerMemory.trainer.storage={validity:'valid',pokemon:[{...changed[1],validity:'valid',box:0,slot:0}]};
 const d=player.decide(restored);assert.notEqual(d.kind,'blocked');assert.equal(planner.select(restored)?.target.kind,'object');
 player.decide(f.observation(4,{map:f.center.id,responses:false,healed:true}));assert.equal(planner.state().tasks.recovery,null);
});

test('fully restored five-PP attacks do not create an impossible healing obligation',()=>{
 const f=campaignTaskFixture({training:true});f.mechanics.moves=Array.from({length:34},(_,id)=>({id,power:id===33?35:0,pp:5,type:'TYPE_NORMAL',accuracy:95}));
 const members=f.party.map(p=>({...p,hp:p.maxHp,pp:[5]}));
 const {player,planner}=f.open();
 const d=player.decide(f.observation(1,{members,responses:false}));
 assert.notEqual(d.winner?.recommendation.objective,'recover-training-party');
 assert.equal(planner.state().tasks?.recovery??null,null);
});

test('depleted five-PP attacks retain healing across restart and finish at their real capacity',()=>{
 const f=campaignTaskFixture({training:true});f.mechanics.moves=Array.from({length:34},(_,id)=>({id,power:id===33?35:0,pp:5,type:'TYPE_NORMAL',accuracy:95}));
 const members=f.party.map(p=>({...p,hp:p.maxHp,pp:[1]}));
 let {player,planner}=f.open();
 assert.equal(player.decide(f.observation(1,{members,responses:false})).winner?.recommendation.objective,'recover-training-party');
 ({player,planner}=f.open(JSON.parse(JSON.stringify(player.state()))));
 const across=player.decide(f.observation(2,{map:f.city.id,responses:false,members}));
 assert.equal(across.winner?.recommendation.targetMap,f.center.id);
 const restored=members.map(p=>({...p,pp:[5]}));
 const d=player.decide(f.observation(3,{map:f.center.id,responses:false,members:restored}));
 assert.notEqual(d.winner?.recommendation.objective,'recover-training-party');
 assert.equal(planner.state().tasks?.recovery??null,null);
});
