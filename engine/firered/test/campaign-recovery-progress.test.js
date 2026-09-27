import test from 'node:test';
import assert from 'node:assert/strict';
import {captureRecoveryEvidence,recoveryProgress} from '../src/suite/campaign-recovery.js';
const party=[{personality:1,otId:2,species:93,experience:100,hp:10,maxHp:50,status1:0,moves:[122],pp:[10]},
 {personality:3,otId:2,species:6,experience:900,hp:100,maxHp:100,status1:0,moves:[53],pp:[10]}];
const observation=()=>({phase:'stable',frame:1,emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:'MAP_ROUTE21_NORTH'},ui:{},trainer:{party:structuredClone(party)}}});
const training={tasks:{training:{id:'train-haunter',member:'[2,1]',kind:'training'},lastCompleted:null},commitments:{training:{trainingSpecies:93}}};
test('closing menus, walking and escort XP cannot certify recovery of the trainee task',()=>{
 const o=observation(),baseline=captureRecoveryEvidence(o,{completedThroughObjectiveId:'badge-earth'},training);
 const next=observation();next.frame=2;next.playerMemory.position={x:10,y:10};next.playerMemory.trainer.party[1].experience++;
 assert.equal(recoveryProgress(baseline,next,{completedThroughObjectiveId:'badge-earth'},training),null);
 next.playerMemory.trainer.party[0].experience++;
 assert.equal(recoveryProgress(baseline,next,{completedThroughObjectiveId:'badge-earth'},training),'trainee-experience');
});
test('recovery requires native task outcome and readable field handoff',()=>{
 const o=observation(),task={tasks:{recovery:{id:'heal',members:['[2,1]'],kind:'recovery'}}};
 const baseline=captureRecoveryEvidence(o,{completedThroughObjectiveId:'badge-earth'},task);
 const next=observation();next.playerMemory.trainer.party[0].hp=50;
 assert.equal(recoveryProgress(baseline,next,{},task),'party-restored');
 next.playerMemory.ui={fieldDialog:{stage:'awaiting-close'}};
 assert.equal(recoveryProgress(baseline,next,{},task),null);
 next.playerMemory.ui={};next.phase='transition';assert.equal(recoveryProgress(baseline,next,{},task),null);
});
test('a confirmed campaign checkpoint is recovery evidence and survives serialization',()=>{
 const baseline=captureRecoveryEvidence(observation(),{completedThroughObjectiveId:'badge-earth'},{});
 assert.equal(recoveryProgress(JSON.parse(JSON.stringify(baseline)),observation(),{completedThroughObjectiveId:'rival-route22-late'},{}),'campaign-checkpoint');
 assert.equal(recoveryProgress(baseline,observation(),{activeObjective:{id:'another-task'},completedThroughObjectiveId:'badge-earth'},{}),null);
});

test('an earlier completion of a reused training-task ID cannot certify a new recovery',()=>{
 const old={...training,tasks:{...training.tasks,lastCompleted:{id:'train-haunter',frame:0}}};
 const baseline=captureRecoveryEvidence(observation(),{completedThroughObjectiveId:'badge-earth'},old);
 assert.equal(recoveryProgress(baseline,observation(),{completedThroughObjectiveId:'badge-earth'},old),null);
 const next=observation();next.frame=3;
 assert.equal(recoveryProgress(baseline,next,{}, {...old,tasks:{lastCompleted:{id:'train-haunter',frame:2}}}),'task-completed');
});

test('the requested native capture proves recovery while an existing or unrelated Pokemon does not',()=>{
 const o=observation(),campaign={activeObjective:{id:'find-rhyhorn',captureSpecies:[111]}};
 const baseline=captureRecoveryEvidence(o,campaign,{});
 const next=observation();next.playerMemory.trainer.party.push({species:25,personality:7,otId:2,validity:'valid'});
 assert.equal(recoveryProgress(baseline,next,campaign,{}),null);
 next.playerMemory.trainer.party.at(-1).species=111;
 assert.equal(recoveryProgress(baseline,next,campaign,{}),'requested-capture');
 const already=captureRecoveryEvidence(next,campaign,{});
 assert.equal(recoveryProgress(already,next,campaign,{}),null);
});
