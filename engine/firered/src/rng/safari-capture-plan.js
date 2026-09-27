import {encounterFingerprint} from '../player/encounter-tracker.js';
import {mapRecommendation} from '../player/delegator.js';

const sameSource=(a,b)=>a?.stateSha256===b?.stateSha256&&a?.sramSha256===b?.sramSha256;
const owned=(o,fp)=>{
 const t=o?.playerMemory?.trainer;
 if(t?.partyValidity!=='valid'||t.storage?.validity!=='valid')return null;
 return [...(t.party??[]),...(t.storage.pokemon??[])].filter(p=>encounterFingerprint(p)===fp).length;
};
// The hunt's own requested, non-shiny Safari target (a National Dex target or a
// request that accepts any shininess). It enters the same qualified first-ball
// capture as a shiny; shinies keep their separate, unchanged admission.
export function requestedSafariTarget({observation:o,state,request,matches}){
 const m=o?.playerMemory,e=m?.encounter,p=e?.pokemon;
 return Boolean(state?.method==='safari-land'&&state.protected===true&&!state.utilityCapture&&request?.shiny!=='required'&&
  o?.emulator?.inBattle&&m.battleTypeFlags===132&&e?.kind==='wild'&&e.validity==='valid'&&p?.validity==='valid'&&
  p.shiny===false&&!p.isEgg&&typeof matches==='function'&&matches(p)===true);
}
// Engines before build 109 stopped every requested non-shiny Safari target with
// this reason before capture planning. Only that stop, still inside the same
// Safari battle with the exact protected identity, no native save since its
// protected anchor and no catch, may resume; the capture re-verifies all of it.
export const UNREADABLE_PROTECTED_ENCOUNTER='The protected encounter is unreadable';
export function resumableSafariTargetStop({observation:o,state,request,matches,evidence=null}){
 const p=o?.playerMemory?.encounter?.pokemon,fp=p?encounterFingerprint(p):null;
 return Boolean(state?.status==='blocked'&&state.reason===UNREADABLE_PROTECTED_ENCOUNTER&&state.capturePlan?.completed!==true&&
  requestedSafariTarget({observation:o,state,request,matches})&&fp&&fp===state.recent?.at?.(-1)&&
  state.protectedAnchor?.sramSha256&&o.sram?.sha256===state.protectedAnchor.sramSha256&&owned(o,fp)===0&&
  !evidence?.caught&&!evidence?.postCatch&&!evidence?.nativeSaveVerified);
}
export function canRetrySafariCapture({observation:o,evidence,source}){
 return Boolean(evidence?.fingerprint&&!evidence.caught&&!evidence.postCatch&&!evidence.nativeSaveVerified&&
  o?.phase==='stable'&&!o.emulator?.inBattle&&o.sram?.sha256===source?.sramSha256&&owned(o,evidence.fingerprint)===0);
}
export async function executeSafariCapturePlan({plan,source,observe,execute,signal,onProgress=()=>{}}){
 if(plan?.schema!=='pokemon-suite/safari-capture-plan/v1'||!plan.verified||plan.verifiedRepeats<2||!sameSource(plan.source,source))throw new Error('Safari capture plan is unverified or its source changed');
 if(!Array.isArray(plan.steps)||plan.steps.length>10000||plan.steps.reduce((n,s)=>n+s.frames,0)>30000||plan.steps.some(s=>!Number.isSafeInteger(s.frames)||s.frames<1||s.frames>600||!Array.isArray(s.buttons)||s.buttons.length>1||s.buttons.some(b=>!['a','b','up','down','left','right'].includes(b))))throw new Error('Unsafe Safari capture inputs');
 const start=observe();
 if(!start.emulator?.inBattle||encounterFingerprint(start.playerMemory?.encounter?.pokemon)!==plan.fingerprint||owned(start,plan.fingerprint)!==0)throw new Error('Protected Safari identity changed or is already owned');
 for(const [i,s] of plan.steps.entries()){
  if(signal?.aborted)return {status:'cancelled'};
  const o=observe(),p=o.playerMemory?.encounter;
  if(p?.validity==='valid'&&encounterFingerprint(p.pokemon)!==plan.fingerprint)throw new Error('Protected Safari encounter changed');
  if(!o.emulator.inBattle&&o.phase==='stable')return {status:owned(o,plan.fingerprint)===1?'caught':'capture-mismatch'};
  await execute({buttons:s.buttons,holdFrames:s.frames,releaseFrames:0});onProgress({completed:i+1,total:plan.steps.length});
 }
 const o=observe();return {status:!o.emulator.inBattle&&owned(o,plan.fingerprint)===1?'caught':'capture-mismatch'};
}

// A bounded search for a successful first-ball timing. Trials read an immutable
// owner checkpoint. Only the independently replayed controller trace is returned.
export async function buildSafariCapturePlan({openTrial,source,signal,maxDelays=256,onProgress=()=>{},nickname=null}){
 const lab=await openTrial(),observe=()=>lab.capture?lab.capture():lab.observer.capture();
 let steps=[];
 const step=async(n,buttons=[])=>{
  for(let left=n;left>0;left-=Math.min(600,left)){
   if(signal?.aborted)throw new Error('Safari capture planning cancelled');
   const frames=Math.min(600,left);steps.push({frames,buttons:[...buttons]});
   for(let i=0;i<frames;i++)lab.session.step(buttons);
   await new Promise(r=>setImmediate(r));
  }
 };
 const action=async r=>{const a=mapRecommendation(r,observe());await step(a.holdFrames??1,a.buttons??[]);if(a.releaseFrames)await step(a.releaseFrames);};
 try{
  if(lab.commit&&!sameSource(lab.commit,source))throw new Error('Safari qualification source changed');
  const initial=observe(),fingerprint=encounterFingerprint(initial.playerMemory.encounter?.pokemon);
  if(!initial.emulator.inBattle||initial.playerMemory.battleTypeFlags!==132||!fingerprint||owned(initial,fingerprint)!==0)throw new Error('A protected, uncaught Safari encounter is required');
  let ready=false;
  for(let n=0;n<2000;n++){
   const o=observe();if(o.phase==='stable'&&o.playerMemory.ui.battle?.stage==='action'){ready=true;break;}
   if(o.playerMemory.ui.battle?.stage==='message')await action({kind:'acknowledge-cartridge-prompt'});else await step(4);
  }
  if(!ready)throw new Error('Safari capture menu did not become ready');
  const anchor={state:lab.session.saveState(),sram:lab.session.saveSram(),steps:structuredClone(steps)};
  for(let delay=0;delay<maxDelays;delay++){
   lab.session.loadSram(anchor.sram);lab.session.loadState(anchor.state);lab.observer.resetHistory?.();steps=structuredClone(anchor.steps);
   await step(delay);
   // Move to Ball without accidentally confirming Bait or Run.
   for(let n=0;n<8;n++){
    const o=observe(),cursor=o.playerMemory.ui.battle?.cursor;
    if(cursor===0)break;
    await action({kind:'choose-safari-command',targetIndex:0,targetAction:'ball'});
   }
   await step(1,['a']);await step(8);
   let threw=false,caught=false;
   for(let n=0;n<2000;n++){
    const o=observe(),m=o.playerMemory;
    if(!o.emulator.inBattle&&o.phase==='stable'){caught=owned(o,fingerprint)===1;break;}
    if(m.safari.balls<initial.playerMemory.safari.balls)threw=true;
    if(threw&&m.ui.battle?.stage==='action')break;
    if(m.ui.pokedexRegistration?.stage==='registered-entry'||m.ui.battle?.stage==='message')await action({kind:'acknowledge-cartridge-prompt'});
    else if(m.ui.choiceMenu&&m.battle?.scriptName==='capture-nickname-prompt')await action({kind:'choose-menu-option',targetOption:nickname?'yes':'no'});
    else if(m.ui.naming?.subject==='pokemon'&&nickname)await action({kind:'enter-naming-screen-text',subject:'pokemon',targetText:nickname});
    else await step(4);
   }
   onProgress({phase:'qualifying-capture',attempt:delay+1,caught});
   if(!caught)continue;
   const plan={schema:'pokemon-suite/safari-capture-plan/v1',source,fingerprint,steps,delay,verified:true,verifiedRepeats:2,estimatedFrames:steps.reduce((n,s)=>n+s.frames,0),calculatedAt:new Date().toISOString()};
   const replay=await openTrial();
   try{
    const result=await executeSafariCapturePlan({plan,source,observe:()=>replay.capture?replay.capture():replay.observer.capture(),execute:async a=>{for(let i=0;i<a.holdFrames;i++)replay.session.step(a.buttons);await new Promise(r=>setImmediate(r));},signal});
    if(result.status!=='caught')throw new Error('Safari capture did not reproduce in an independent replay');
   }finally{replay.session.close();}
   return plan;
  }
  throw new Error('No first-ball timing passed qualification; the protected encounter is preserved');
 }finally{lab.session.close();}
}
