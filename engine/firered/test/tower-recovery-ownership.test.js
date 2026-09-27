import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignTaskFixture} from '../test-support/campaign-task-fixture.js';
import {createPolicyAdvisors} from '../src/player/advisors.js';
import {createCampaignPlanner} from '../src/player/campaign.js';

function towerRecoveryScene(){
 const fixture=campaignTaskFixture();
 fixture.route.id='MAP_TRAINER_TOWER_3F';
 fixture.city.connections[0].map=fixture.route.id;
 fixture.campaign.objectives[0]={id:'postgame-trainer-tower-travel',
  target:{kind:'map-arrival',map:'MAP_TRAINER_TOWER_4F'},
  completion:{kind:'flag-set',id:9999},importantBattle:true,identityEvolution:true,
  battleCategory:'trainer-tower',minimumBattlePartySize:6,
  rosterPreparationFor:'postgame-trainer-tower'};
 const {planner,player}=fixture.open();
 const inventory=createPolicyAdvisors({world:fixture.world,mechanics:fixture.mechanics,campaignPlanner:planner})
  .find(advisor=>advisor.id==='inventory');
 const observe=(frame,members,{active=true,map=fixture.route.id}={})=>{
  const observation=fixture.observation(frame,{map,members,responses:false});
  observation.playerMemory.storyState.variableIds[0x4082]=active?1:0;
  return observation;
 };
 return {fixture,inventory,observe,planner,player};
}

for(const [condition,membersFor] of [
 ['low HP',party=>party.map(p=>({...p,hp:10}))],
 ['paralysis',party=>party.map((p,index)=>({...p,hp:p.maxHp,status1:index===1?64:0}))],
])test(`active Tower ${condition} cannot select an outside free healer`,()=>{
 const {fixture,inventory,observe}=towerRecoveryScene();
 const members=membersFor(fixture.party);
 const outside=inventory.advise(observe(1,members,{active:false,map:fixture.city.id}))?.recommendation;
 assert.ok(['recover-party','recover-training-party'].includes(outside?.objective),
  'ordinary recovery must still route to the Pokémon Center');
 assert.equal(outside?.targetMap,fixture.center.id);
 const inside=inventory.advise(observe(2,members))?.recommendation;
 assert.ok(!['recover-party','recover-training-party'].includes(inside?.objective),
  'the started challenge owns its recovery route');
 assert.notEqual(inside?.targetMap,fixture.center.id,'a Tower floor must not navigate to an outside healer');
});

test('a restarted active Tower challenge releases an outside recovery task but retains an in-Tower nurse task',()=>{
 const {fixture,observe,planner,player}=towerRecoveryScene();
 const low=fixture.party.map(p=>({...p,hp:10}));
 const outside=observe(10,low,{active:false,map:fixture.city.id});
 const decision=player.decide(outside);
 assert.ok(['recover-party','recover-training-party'].includes(decision.winner?.recommendation?.objective));
 const retained=planner.state();
 assert.equal(retained.tasks.recovery.objective.target.map,fixture.center.id);
 const restored=createCampaignPlanner({world:fixture.world,story:fixture.story,
  mechanics:fixture.mechanics,campaign:fixture.campaign,initialState:JSON.parse(JSON.stringify(retained))});
 const active=observe(11,low);
 assert.equal(restored.retainedRecovery(active),null,'the accepted challenge must resume its own floor route');
 assert.equal(restored.state().tasks?.recovery??null,null,'the outside care task must not reappear on another restart');
 const nurse={...retained,tasks:{...retained.tasks,recovery:{...retained.tasks.recovery,
  objective:{...retained.tasks.recovery.objective,target:{kind:'object',map:'MAP_TRAINER_TOWER_LOBBY',index:0}}}}};
 const within=createCampaignPlanner({world:fixture.world,story:fixture.story,
  mechanics:fixture.mechanics,campaign:fixture.campaign,initialState:nurse});
 assert.equal(within.retainedRecovery(active)?.target.map,'MAP_TRAINER_TOWER_LOBBY',
  'an owned lobby-nurse task remains valid inside the challenge');
});
