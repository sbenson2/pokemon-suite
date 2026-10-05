// Extra saves, part 4 (build 126): helper tasks on an archived FireRed save.
// They run in the save's helper owner before it becomes a partner (one working
// copy per lineage): the Fighting Dojo prize is an ordinary gift hunt, and the
// roaming dog is RoamerMission (the National Pokédex and Celio's link, the
// release, the pursuit and the capture). The host starts each hunt, then a
// park task saves the obtained individuals in a Pokémon Center with a Direct
// Corner. Controller inputs only; no memory writes.
import {isDeepStrictEqual} from 'node:util';
import {postgameCaptureRequest} from './national-dex-agenda.js';
import {giftRoute} from './gift-mission.js';

export const HELPER_TASK_KINDS=Object.freeze(['dojo-prize','roamer-capture']);
const PROFILE=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

// The hunt record the host sends for one task ({type:'start',record}).
export function helperTaskHunt(task){
 if(!HELPER_TASK_KINDS.includes(task?.kind)||!PROFILE.test(task.profileId??''))throw Error('Choose a helper task of an archived FireRed save.');
 if(task.kind==='dojo-prize'&&![106,107].includes(task.speciesId)||task.kind==='roamer-capture'&&![243,244,245].includes(task.speciesId))
  throw Error('The helper task names an unsupported Pokémon.');
 return {id:`helper-${task.kind==='dojo-prize'?'dojo':'roamer'}-${task.speciesId}-${task.profileId.slice(0,8)}`,
  request:postgameCaptureRequest(task.speciesId),route:task.kind==='dojo-prize'?giftRoute(task.speciesId):{method:'roamer'}};
}

// A helper owner plays only what its config names: a story helper its
// campaign; a parking helper its travel or park task; an archived save's
// helper also exactly the hunts of its tasks.
export function helperTaskAllows(cfg,c){
 const helper=cfg?.extraSaveHelper;
 if(c?.type==='player-task')return helper?.park===true&&['travel','park'].includes(c.request?.kind);
 if(c?.type==='start'){
  const record=c.record;
  return Boolean(record&&(helper?.tasks??[]).some(t=>t?.hunt?.id===record.id&&isDeepStrictEqual(t.hunt.request,record.request)&&isDeepStrictEqual(t.hunt.route,record.route)));
 }
 return false;
}
