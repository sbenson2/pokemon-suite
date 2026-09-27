import {obedienceRisk} from '../src/player/training-policy.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {partyMatchupPlan} from '../src/player/battle-model.js';
import {createCampaignTasks} from '../src/player/campaign-tasks.js';
import {campaignTaskFixture} from '../test-support/campaign-task-fixture.js';
import {createCampaignPlanner,selectTrainingObjective} from '../src/player/campaign.js';

const mechanics={species:{1:{id:1,types:['TYPE_NORMAL'],baseAttack:70,baseDefense:70,baseSpAttack:70,baseSpDefense:70}},
  moves:{33:{id:33,power:35,pp:35,accuracy:100,type:'TYPE_NORMAL'}}};
const member=(slot,level,otId=77)=>({slot,level,otId,species:1,hp:100,maxHp:100,moves:[33],pp:[35]});
const observation={playerMemory:{trainer:{otId:77},storyState:{flagIds:{2081:true,2083:true,2085:false,2087:false}}}};
const matchup=(party,extra={})=>partyMatchupPlan({mechanics,party,opponentSpecies:1,
  opponentBattle:{species:1,level:30,hp:60,maxHp:60,moves:[33],pp:[35]},observation,...extra});

test('an obedient capable fighter is preferred to an over-limit traded attacker',()=>{
  assert.equal(matchup([member(0,43),member(1,62,1985)]).best.member.slot,0);
  const unlocked=structuredClone(observation);unlocked.playerMemory.storyState.flagIds[2085]=true;
  assert.equal(matchup([member(0,43),member(1,62,1985)],{observation:unlocked}).best.member.slot,1);
  assert.equal(matchup([member(0,43),member(1,62)]).best.member.slot,1,'own Pokemon are not badge capped');
});

test('routine training chooses a safe lower-level finisher while major battles retain damage priorities',()=>{
  const party=[member(0,43),member(1,62)];
  assert.equal(matchup(party,{balanceExperience:true}).best.member.slot,0);
  assert.equal(matchup(party).best.member.slot,1);
  party[0].hp=10;assert.equal(matchup(party,{balanceExperience:true}).best.member.slot,1,'health overrides XP');
  party[0].hp=100;party[0].pp=[0];assert.equal(matchup(party,{balanceExperience:true}).best.member.slot,1,'PP overrides XP');
  assert.equal(matchup([member(0,62,1985)]).best.member.slot,0,'last available Pokemon remains selectable');
});

test('balanced training completes a one-level assignment across restart, without forgetting the final requirement',()=>{
  const f=campaignTaskFixture({training:true});const o=f.observation(1,{responses:false});
  let tasks=createCampaignTasks();const selected={id:'train-battle-member',forObjective:'badge-soul',
    trainingPartySlot:0,trainingSpecies:5,minimumTeamAnchorLevel:45,trainingRotation:'one-level'};
  tasks.rememberTraining(selected,o);assert.equal(tasks.trainingFor(o,'badge-soul').minimumLevel,34);
  assert.equal(tasks.state().training.targetLevel,45);
  tasks=createCampaignTasks({initialState:JSON.parse(JSON.stringify(tasks.state()))});
  const gained=structuredClone(o);gained.frame++;gained.playerMemory.trainer.party[0].level=34;
  tasks.observe(gained);assert.equal(tasks.trainingFor(gained,'badge-soul'),null);
  assert.equal(tasks.state().lastCompleted.kind,'training');
});

test('story travel uses the weakest permanent member without choosing an experience detour',()=>{
  const f=campaignTaskFixture();const o=f.observation(1,{responses:false,healed:true});
  o.playerMemory.trainer.party.push({...o.playerMemory.trainer.party[0],slot:2,species:16,level:12,personality:303});
  const selected=selectTrainingObjective({world:f.world,observation:o,objective:f.objective,
    progressionObjective:{battleTeamTargetLevel:36},teamPlan:{permanentFamilies:[[4,5,6],[129,130]]}});
  assert.equal(selected?.trainingSource,'story');assert.equal(selected.trainingPartySlot,1);
  assert.deepEqual(selected.target,f.objective.target);assert.equal(selected.trainingMode,'passive');
});

test('battle preparation rotates to the lowest member after a level, including a legacy checkpoint',()=>{
  for(const legacy of [false,true]) {
    const f=campaignTaskFixture({training:true});Object.assign(f.objective,{importantBattle:true,minimumBattleMemberLevel:36});
    const first=f.observation(1,{responses:false,healed:true});first.playerMemory.trainer.party[1].level=33;
    let {planner}=f.open();let planned=planner.selectTraining(first,planner.select(first));
    assert.equal(planned.trainingPartySlot,0);
    const checkpoint=JSON.parse(JSON.stringify(planner.state()));
    if(legacy){checkpoint.tasks.training.minimumLevel=36;delete checkpoint.tasks.training.rotation;delete checkpoint.tasks.training.targetLevel;}
    ({planner}=f.open({...f.open().player.state(),campaignPlanner:checkpoint}));
    planner.selectTraining(first,planner.select(first));
    const gained=structuredClone(first);gained.frame=2;gained.playerMemory.trainer.party[0].level=34;
    const next=planner.selectTraining(gained,planner.select(gained));
    assert.equal(next.trainingPartySlot,1,'reconsider the team when the current member gains a level');
    assert.equal(next.minimumTeamAnchorLevel,36,'preserve the boss readiness requirement');
    gained.playerMemory.trainer.party.forEach(p=>p.level=36);
    assert.equal(planner.selectTraining(gained,planner.select(gained)),null,'advance as soon as preparation is complete');
  }
});


test('foreign-OT obedience follows the actual badge gates and uses the full trainer ID',()=>{
  for(const [flag,limit] of [[null,10],[2081,30],[2083,50],[2085,70],[2087,100]]) {
    const o={playerMemory:{trainer:{otId:0x10001},storyState:{flagIds:flag?{[flag]:true}:{}}}};
    assert.equal(obedienceRisk(member(0,limit,0x20001),o),false);
    assert.equal(obedienceRisk(member(0,limit+1,0x20001),o),flag!==2087);
    assert.equal(obedienceRisk(member(0,100,0x10001),o),false);
  }
  assert.equal(obedienceRisk({level:62},observation),false,'missing OT evidence cannot prove foreign ownership');
});

test('finishing a VS Seeker batch during story or medicine errands trains permanent members, not a Fly helper',()=>{
  const f=campaignTaskFixture();const o=f.observation(1,{healed:true});
  o.playerMemory.trainer.party.push({...o.playerMemory.trainer.party[0],slot:2,species:16,level:12,personality:303});
  const teamPlan={permanentFamilies:[[4,5,6],[129,130]],utilityAcquisitions:[{family:[16,17,18],helperRole:'field'}]};
  for(const objective of [f.objective,{id:'battle-medicine:badge-soul',target:{kind:'shop',map:f.city.id}},
    {id:'train-fly-carrier',target:{kind:'roster-training'},minimumCoreLevel:18,coreSpecies:[16,17,18]}]) {
    const campaign=structuredClone(f.campaign);campaign.objectives=[objective];
    const p=createCampaignPlanner({world:f.world,story:f.story,mechanics:f.mechanics,campaign,teamPlan});
    const batch=p.selectTraining(o,objective);
    assert.equal(batch.id,'finish-vs-seeker-response-batch');
    assert.equal(batch.trainingSpecies,objective.id==='train-fly-carrier'?16:130,'explicit field-carrier requirements retain their subject');
    assert.equal(batch.responseBatchRemaining,1,'preserve the already activated response');
  }
});
