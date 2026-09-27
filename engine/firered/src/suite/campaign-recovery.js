import {campaignMemberIdentity} from '../player/campaign-tasks.js';
import {partyFullyRestored} from '../player/recovery.js';

export const recoveryFieldReady=o=>o?.phase==='stable'&&o.emulator?.mode==='overworld'&&o.emulator.inputReady!==false&&!o.emulator.inBattle&&
 !o.playerMemory?.scripts?.fieldControlsLocked&&!o.playerMemory?.questLog?.playback&&!Object.values(o.playerMemory?.ui??{}).some(Boolean);

export function captureRecoveryEvidence(o,campaign,planner){
 const members=o.playerMemory?.trainer?.party??[],training=planner.tasks?.training,healing=planner.tasks?.recovery;
 const trainee=training?.member??campaignMemberIdentity(members.find(p=>p.species===planner.commitments?.training?.trainingSpecies));
 return {frame:o.frame,completed:campaign.completedThroughObjectiveId??null,task:healing??training??null,trainee,
  captureSpecies:campaign.activeObjective?.captureSpecies??[],
  owned:[...members,...(o.playerMemory?.trainer?.storage?.pokemon??[])].map(campaignMemberIdentity).filter(Boolean),
  party:members.map(p=>({identity:campaignMemberIdentity(p),experience:p.experience,hp:p.hp,status1:p.status1,pp:p.pp,moves:p.moves}))};
}

export function recoveryProgress(baseline,o,campaign,planner,mechanics=null){
 if(!baseline||!recoveryFieldReady(o))return null;
 if(campaign.completedThroughObjectiveId&&campaign.completedThroughObjectiveId!==baseline.completed)return 'campaign-checkpoint';
 if(baseline.task?.id&&planner.tasks?.lastCompleted?.id===baseline.task.id&&planner.tasks.lastCompleted.frame>baseline.frame)return 'task-completed';
 const members=o.playerMemory?.trainer?.party??[];
 if((baseline.captureSpecies??[]).length&&[...members,...(o.playerMemory?.trainer?.storage?.pokemon??[])].some(p=>
   p.validity==='valid'&&baseline.captureSpecies.includes(p.species)&&campaignMemberIdentity(p)&&
   !(baseline.owned??[]).includes(campaignMemberIdentity(p))))return 'requested-capture';
 if(baseline.trainee){
  const member=members.find(p=>campaignMemberIdentity(p)===baseline.trainee),old=baseline.party.find(p=>p.identity===baseline.trainee);
  if(member&&old&&member.experience>old.experience)return 'trainee-experience';
 }
 if(baseline.task?.kind==='recovery'){
  const required=baseline.task.members.map(id=>members.find(p=>campaignMemberIdentity(p)===id));
  if(required.length&&required.every(Boolean)&&partyFullyRestored({trainer:{party:required}},mechanics)&&required.some(p=>{
   const old=baseline.party.find(q=>q.identity===campaignMemberIdentity(p));
   return old&&(p.hp>old.hp||old.status1!==0&&p.status1===0);
  }))return 'party-restored';
 }
 return null;
}
