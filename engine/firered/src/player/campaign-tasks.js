import {encounterFingerprint} from './encounter-tracker.js';
import {isProgressObservation} from './progress-observation.js';
import {partyFullyRestored} from './recovery.js';

export function campaignMemberIdentity(member) {
  return Number.isSafeInteger(member?.personality)&&Number.isSafeInteger(member?.otId)
    ? JSON.stringify([member.otId,member.personality]) : null;
}

// Strategic obligations outlive map-local menus and trainer response arrays.
// Routes and tactical escorts may change while the task's subject and required
// outcome stay fixed. The state is carried in the normal planner checkpoint.
export function createCampaignTasks({initialState=null,mechanics=null}={}) {
  if(initialState!==null&&(initialState.schema!=='master-red/campaign-tasks/v1'||
      initialState.recovery&&(!Array.isArray(initialState.recovery.members)||!initialState.recovery.members.length||
        initialState.recovery.members.some(id=>typeof id!=='string')||!initialState.recovery.objective?.target)||
      initialState.training&&(typeof initialState.training.member!=='string'||!Number.isFinite(initialState.training.minimumLevel))))
    throw new TypeError('invalid campaign task checkpoint');
  let recovery=structuredClone(initialState?.recovery??null),training=structuredClone(initialState?.training??null);
  let blocked=structuredClone(initialState?.blocked??null),lastCompleted=structuredClone(initialState?.lastCompleted??null);
  const members=o=>o?.playerMemory?.trainer?.party??[];
  const find=(o,id)=>members(o).find(p=>campaignMemberIdentity(p)===id);
  const readable=o=>isProgressObservation(o)&&o.playerMemory.trainer?.partyValidity==='valid';
  return {
    observe(o) {
      if(!readable(o)||o.emulator.mode!=='overworld'||o.emulator.inBattle||Object.values(o.playerMemory.ui??{}).some(Boolean))return;
      if(recovery&&(!blocked||blocked.reason==='recovery-member-unavailable')) {
        const party=recovery.members.map(id=>find(o,id));
        if(party.some(p=>!p)){
          const storage=o.playerMemory.trainer.storage,all=[...members(o),...(storage?.pokemon??[])];
          const reserved=recovery.members.map(id=>all.filter(p=>p.validity==='valid'&&campaignMemberIdentity(p)===id));
          if(storage?.validity!=='valid'||reserved.some(rows=>rows.length!==1)) {blocked={kind:'blocked',reason:'recovery-member-unavailable',task:structuredClone(recovery)};return;}
          blocked=null;recovery.phase='reassembling';
          recovery.rosterObjective={id:recovery.id+'-reassemble',target:{kind:'party-roster',map:o.playerMemory.map.id.endsWith('POKEMON_CENTER_1F')?o.playerMemory.map.id:recovery.objective.target.map,minimumPartySize:recovery.members.length,maximumPartySize:6,requiredFingerprints:reserved.map(rows=>encounterFingerprint(rows[0]))},taskKind:'recovery',dialogue:'advance',deferOptionalDetours:true,identityEvolution:true};
          return;
        }
        blocked=null;recovery.rosterObjective=null;
        if(partyFullyRestored({trainer:{party}},mechanics)) {
          lastCompleted={id:recovery.id,kind:'recovery',parentObjectiveId:recovery.parentObjectiveId,frame:o.frame};recovery=null;
        } else recovery.phase=o.playerMemory.map.id===recovery.objective.target.map?'healing':'travel';
      }
      if(training) {
        const member=find(o,training.member);
        if(!member&&!blocked){blocked={kind:'blocked',reason:'training-member-unavailable',task:structuredClone(training)};return;}
        if(member&&Number(member.level)>=training.minimumLevel){
          lastCompleted={id:training.id,kind:'training',parentObjectiveId:training.parentObjectiveId,frame:o.frame};training=null;
        }
      }
    },
    beginRecovery({observation,objective,parentObjectiveId}) {
      if(recovery||blocked||!readable(observation))return;
      const identities=members(observation).map(campaignMemberIdentity);
      if(!identities.length||identities.some(id=>id===null)||new Set(identities).size!==identities.length)return;
      recovery={id:`recovery:${observation.frame}`,kind:'recovery',phase:'travel',parentObjectiveId,
        members:identities,startedFrame:observation.frame,objective:{...structuredClone(objective),
          taskKind:'recovery',dialogue:'advance',deferOptionalDetours:true}};
    },
    rememberTraining(selected,o) {
      if(!selected||selected.id==='finish-vs-seeker-response-batch'||!o)return;
      const member=members(o).find(p=>Number(p.slot)===Number(selected.trainingPartySlot)&&Number(p.species)===Number(selected.trainingSpecies));
      const identity=campaignMemberIdentity(member),minimumLevel=Number(selected.minimumTeamAnchorLevel??0);
      if(!identity||!member||minimumLevel<=Number(member.level))return;
      if(training?.parentObjectiveId===selected.forObjective&&find(o,training.member)&&Number(find(o,training.member).level)<training.minimumLevel) {
        if(selected.trainingRotation==='one-level'&&training.rotation!=='one-level') {
          // Upgrade a retained preparation task once, at its observed level.
          // Identity/evolution obligations without rotation keep their target.
          training.targetLevel=training.minimumLevel;
          training.minimumLevel=Math.min(training.minimumLevel,Number(find(o,training.member).level)+1);
          training.rotation='one-level';
        }
        return;
      }
      const targetLevel=minimumLevel;
      const nextLevel=selected.trainingRotation==='one-level'?Math.min(minimumLevel,Number(member.level)+1):minimumLevel;
      training={id:`training:${selected.forObjective}:${identity}:${minimumLevel}`,kind:'training',phase:'training',
        parentObjectiveId:selected.forObjective,member:identity,minimumLevel:nextLevel,targetLevel,rotation:selected.trainingRotation??null,startedFrame:o.frame};
    },
    trainingFor(o,parentObjectiveId) {
      if(!training||training.parentObjectiveId!==parentObjectiveId)return null;
      const member=find(o,training.member);
      return member&&Number(member.level)<training.minimumLevel?{...structuredClone(training),partySlot:member.slot,species:member.species}:null;
    },
    selectParent(parentObjectiveId,o){
      if(readable(o)&&training&&training.parentObjectiveId!==parentObjectiveId)training=null;
    },
    recovery:()=>recovery?structuredClone({...recovery,objective:recovery.rosterObjective??recovery.objective}):null,
    releaseRecovery(){
      if(!recovery)return false;
      if(blocked?.task?.id===recovery.id)blocked=null;
      recovery=null;return true;
    },
    retargetRecovery(objective){if(recovery)recovery.objective={...recovery.objective,...structuredClone(objective),id:recovery.objective.id};},
    block(reason){blocked={kind:'blocked',reason,task:structuredClone(recovery??training)};return structuredClone(blocked);},
    blocked:()=>structuredClone(blocked),
    active:()=>structuredClone(recovery??training),
    state:()=>recovery||training||blocked||lastCompleted?{schema:'master-red/campaign-tasks/v1',recovery:structuredClone(recovery),training:structuredClone(training),blocked:structuredClone(blocked),lastCompleted:structuredClone(lastCompleted)}:null,
  };
}
