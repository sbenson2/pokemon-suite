import {encounterFingerprint} from '../player/encounter-tracker.js';
import {mapRecommendation} from '../player/delegator.js';
import {selectBestCaptureBall} from '../player/capture-balls.js';
import {knownCaptureFreeSlots} from '../player/encounter-safety.js';

// Scripted singles add legendary flags; trainer, link, Safari and doubles remain excluded.
const supportedWild=flags=>Number.isInteger(flags)&&!!(flags&4)&&!(flags&~(4|(1<<10)|(1<<13)|(1<<17)|(1<<18)));
const sameSource=(a,b)=>Boolean(a?.stateSha256&&a?.sramSha256&&a.stateSha256===b?.stateSha256&&a.sramSha256===b?.sramSha256);
const availableBalls=o=>{
 const balls=o?.playerMemory?.trainer?.bag?.pokeBalls;
 return Array.isArray(balls)?balls.reduce((n,b)=>n+(b.itemId>=1&&b.itemId<=12&&b.itemId!==5?Math.max(0,Number(b.quantity)||0):0),0):null;
};
export function ownedCaptureCount(o,fp){
 const t=o?.playerMemory?.trainer;
 if(t?.partyValidity!=='valid'||t.storage?.validity!=='valid'||!Array.isArray(t.party)||!Array.isArray(t.storage.pokemon))return null;
 return [...t.party,...t.storage.pokemon].filter(p=>encounterFingerprint(p)===fp).length;
}
export function requiresTimedCapture(o,mechanics,{requestedRoamer=false}={}){
 const m=o?.playerMemory,p=m?.encounter?.pokemon,moves=(mechanics?.data??mechanics)?.moves??[];
 if(!o?.emulator?.inBattle||!supportedWild(m?.battleTypeFlags)||p?.validity!=='valid'||!(p.shiny===true||requestedRoamer&&p.shiny===false&&(m.battleTypeFlags&(1<<10))))return false;
 if(m.battleTypeFlags&(1<<10))return true;
 const balls=availableBalls(o);
 if(balls!==null&&balls>0&&balls<=3)return true;
 const opponent=m.battle?.opponent??p;
 // Shadow Tag prevents changing catchers. Qualify a complete capture input trace
 // before spending any live turns on status, weakening or a forbidden switch.
 // A fainted catcher uses the same verified forced-replacement path.
 if(Number(opponent.ability)===23||m.battle?.player?.hp===0)return true;
 // Match the capture guard's native residual-damage flags, including
 // confusion, trapping, Curse, Perish Song, sandstorm and hail.
 if((Number(opponent.status1)&(8|16|128))||(Number(opponent.status2)&(7|0xe000|(1<<27)|(1<<28)))||(Number(opponent.status3)&((1<<2)|(1<<5)))||(Number(m.battle?.weather)&(24|128)))return true;
 if(p.moves?.some(Boolean)&&p.moves.every((id,i)=>!id||p.pp?.[i]===0))return true;
 return (p.moves??[]).some((id,i)=>id&&p.pp?.[i]>0&&/ROAR|TELEPORT|EXPLOSION|SELF_DESTRUCT|MEMENTO|PERISH_SONG|RECOIL|STRUGGLE|CURSE|BELLY_DRUM|COUNTER|MIRROR_COAT|DESTINY_BOND/.test(moves.find(x=>x.id===id)?.effect??''));
}
export function canRetryProtectedCapture({observation:o,evidence,source}){
 return Boolean(evidence?.pokemon?.validity==='valid'&&evidence.pokemon.shiny&&
  evidence.fingerprint===encounterFingerprint(evidence.pokemon)&&!evidence.caught&&!evidence.postCatch&&!evidence.nativeSaveVerified&&
  source?.stateSha256&&source?.sramSha256&&o?.phase==='stable'&&o.emulator?.mode==='overworld'&&!o.emulator.inBattle&&
  [1,2,4,5,6].includes(o.playerMemory?.battleOutcome)&&o.sram?.sha256===source.sramSha256&&ownedCaptureCount(o,evidence.fingerprint)===0);
}
export function canRetryDepletedCapture({observation:o,evidence,source}){
 return Boolean(evidence?.pokemon?.validity==='valid'&&evidence.pokemon.shiny&&
  evidence.fingerprint===encounterFingerprint(evidence.pokemon)&&!evidence.caught&&!evidence.postCatch&&!evidence.nativeSaveVerified&&
  source?.stateSha256&&source?.sramSha256&&o?.phase==='stable'&&o.emulator?.inBattle&&supportedWild(o.playerMemory?.battleTypeFlags)&&
  o.playerMemory.encounter?.validity==='valid'&&o.playerMemory.encounter.pokemon?.validity==='valid'&&
  encounterFingerprint(o.playerMemory.encounter.pokemon)===evidence.fingerprint&&availableBalls(o)===0&&
  o.sram?.sha256===source.sramSha256&&ownedCaptureCount(o,evidence.fingerprint)===0);
}
export function canQualifyPostgameCapture(o,evidence,reason){
 return Boolean(reason==='capture-battler-survival-unknown'&&o?.phase==='stable'&&o.emulator?.inBattle&&supportedWild(o.playerMemory?.battleTypeFlags)&&
  evidence?.pokemon?.validity==='valid'&&typeof evidence.pokemon.shiny==='boolean'&&!evidence.caught&&!evidence.postCatch&&!evidence.nativeSaveVerified&&
  evidence.fingerprint===encounterFingerprint(evidence.pokemon)&&o.playerMemory.encounter?.validity==='valid'&&
  evidence.fingerprint===encounterFingerprint(o.playerMemory.encounter.pokemon)&&ownedCaptureCount(o,evidence.fingerprint)===0&&availableBalls(o)>0);
}
export async function executeProtectedCapturePlan({plan,source,observe,execute,signal,onProgress=()=>{}}){
 if(plan?.schema!=='pokemon-suite/protected-capture-plan/v1'||!plan.verified||plan.verifiedRepeats<2||!sameSource(plan.source,source))throw Error('Capture plan is unverified or its source changed');
 if(!Array.isArray(plan.steps)||plan.steps.length===0||plan.steps.length>10000||plan.steps.some(s=>!Number.isSafeInteger(s.frames)||s.frames<1||s.frames>600||!Array.isArray(s.buttons)||s.buttons.length>1||s.buttons.some(b=>!['a','b','up','down','left','right'].includes(b)))||plan.steps.reduce((n,s)=>n+s.frames,0)>30000)throw Error('Unsafe protected capture inputs');
 const start=observe();
 if(!start.emulator?.inBattle||!supportedWild(start.playerMemory?.battleTypeFlags)||encounterFingerprint(start.playerMemory?.encounter?.pokemon)!==plan.fingerprint||ownedCaptureCount(start,plan.fingerprint)!==0)throw Error('Protected identity changed or is already owned');
 for(const [i,s] of plan.steps.entries()){
  if(signal?.aborted)return {status:'cancelled'};
  const o=observe(),p=o.playerMemory?.encounter;
  if(p?.validity==='valid'&&encounterFingerprint(p.pokemon)!==plan.fingerprint)throw Error('Protected encounter changed');
  if(!o.emulator.inBattle&&o.phase==='stable')return {status:ownedCaptureCount(o,plan.fingerprint)===1?'caught':'capture-mismatch'};
  await execute({buttons:s.buttons,holdFrames:s.frames,releaseFrames:0});onProgress({completed:i+1,total:plan.steps.length});
 }
 const o=observe();return {status:!o.emulator.inBattle&&ownedCaptureCount(o,plan.fingerprint)===1?'caught':'capture-mismatch'};
}

// Trials may lose the encounter. Only a twice-qualified input trace is replayed
// in the owner, from its own protected encounter; no captured trial is imported.
export async function buildProtectedCapturePlan({openTrial,source,mechanics,signal,maxDelays=256,onProgress=()=>{},allowOrdinary=false,nickname=null}){
 if(!Number.isInteger(maxDelays)||maxDelays<1||maxDelays>1024)throw Error('Invalid capture search budget');
 const lab=await openTrial(),observe=()=>lab.capture?lab.capture():lab.observer.capture();let steps=[];
 const step=async(n,buttons=[])=>{
  for(let left=n;left>0;left-=Math.min(600,left)){
   if(signal?.aborted)throw Error('Protected capture planning cancelled');
   const frames=Math.min(600,left);steps.push({frames,buttons:[...buttons]});
   if(steps.reduce((sum,s)=>sum+s.frames,0)>30000)throw Error('Protected capture trace exceeded its frame budget');
   for(let i=0;i<frames;i++)lab.session.step(buttons);
   await new Promise(resolve=>setImmediate(resolve));
  }
 };
 const action=async r=>{const a=mapRecommendation(r,observe());await step(a.holdFrames??1,a.buttons??[]);if(a.releaseFrames)await step(a.releaseFrames);};
 try{
  if(!sameSource(lab.commit,source))throw Error('Capture qualification source changed');
  const initial=observe(),m=initial.playerMemory,p=m.encounter?.pokemon,fingerprint=encounterFingerprint(p);
  if(!initial.emulator.inBattle||!supportedWild(m.battleTypeFlags)||p?.validity!=='valid'||!(p.shiny===true||allowOrdinary&&p.shiny===false)||ownedCaptureCount(initial,fingerprint)!==0||!(knownCaptureFreeSlots(m.trainer)>0))throw Error('A protected uncaught wild Pokémon with free storage is required');
  const ball=selectBestCaptureBall({balls:m.trainer.bag.pokeBalls,opponent:p,mechanics,ownedSpecies:m.trainer.pokedex?.ownedSpecies,mapType:m.map?.type,turn:m.battle?.turn??0});
  if(!ball)throw Error('No usable capture ball is available');
  let ready=false;
  for(let n=0;n<2500;n++){
   const o=observe(),memory=o.playerMemory,ui=memory.ui;
   const replacement=memory.battle?.player?.hp===0?memory.trainer.party.filter(p=>p.validity==='valid'&&p.hp>0).sort((a,b)=>b.hp-a.hp)[0]:null;
   if(!o.emulator.inBattle)throw Error('Encounter ended before capture preparation');
   if(o.phase!=='stable')await step(4);
   else if(replacement&&ui.choiceMenu)await action({kind:'choose-menu-option',targetOption:'yes'});
   else if(replacement&&ui.party?.stage==='choose-pokemon')await action({kind:'choose-party-member',targetPartySlot:replacement.slot,targetSpecies:replacement.species});
   else if(replacement&&ui.party?.stage==='selection-menu')await action(ui.party.selectedPartySlot===replacement.slot?{kind:'choose-menu-option',targetIndex:0}:{kind:'close-menu'});
   else if(ui.bag?.stage==='context'&&ui.bag.pocket===2&&ui.bag.selectedItemId===ball.itemId){ready=true;break;}
   else if(ui.battle?.stage==='message')await action({kind:'acknowledge-cartridge-prompt'});
   else if(ui.battle?.stage==='action')await action({kind:'choose-battle-command',targetCommand:'bag'});
   else if(ui.bag?.stage==='list')await action(ui.bag.pocket!==2?{kind:'choose-bag-pocket',targetPocket:2}:{kind:'choose-bag-item',targetItemId:ball.itemId,targetIndex:ball.index});
   else if(ui.bag||ui.party||ui.battle?.stage==='move')await action({kind:'close-menu'});
   else await step(4);
  }
  if(!ready)throw Error('The capture ball menu did not become ready');
  // Roamers must succeed before their first escape opportunity. Other trials
  // may prove up to three throws, including intervening native enemy turns.
  // No owning input is permitted until the entire trace reproduces.
  const throwLimit=Math.min(ball.quantity,m.battleTypeFlags&(1<<10)?1:3);
  const anchor={state:lab.session.saveState(),sram:lab.session.saveSram(),steps:structuredClone(steps)};
  for(let delay=0;delay<maxDelays;delay++){
   lab.session.loadSram(anchor.sram);lab.session.loadState(anchor.state);lab.observer.resetHistory?.();steps=structuredClone(anchor.steps);
   await step(delay);await action({kind:'choose-bag-context-action',targetAction:'use',targetIndex:0});
   let throws=0,caught=false;
   for(let n=0;n<3500;n++){
    const o=observe(),m=o.playerMemory,ui=m.ui;
    if(!o.emulator.inBattle&&o.phase==='stable'){caught=ownedCaptureCount(o,fingerprint)===1;break;}
    if(m.encounter?.validity==='valid'&&encounterFingerprint(m.encounter.pokemon)!==fingerprint)throw Error('Protected encounter changed');
    throws=ball.quantity-(m.trainer.bag.pokeBalls.find(b=>b.itemId===ball.itemId)?.quantity??0);
    if(throws>=throwLimit&&ui.battle?.stage==='action')break;
    if(ui.pokedexRegistration?.stage==='registered-entry'||ui.battle?.stage==='message')await action({kind:'acknowledge-cartridge-prompt'});
    else if(ui.battle?.stage==='action'&&throws<throwLimit)await action({kind:'choose-battle-command',targetCommand:'bag'});
    else if(ui.bag?.stage==='list'&&throws<throwLimit)await action(ui.bag.pocket!==2?{kind:'choose-bag-pocket',targetPocket:2}:{kind:'choose-bag-item',targetItemId:ball.itemId,targetIndex:m.trainer.bag.pokeBalls.findIndex(b=>b.itemId===ball.itemId)});
    else if(ui.bag?.stage==='context'&&ui.bag.pocket===2&&ui.bag.selectedItemId===ball.itemId&&throws<throwLimit)await action({kind:'choose-bag-context-action',targetAction:'use',targetIndex:0});
    else if(ui.choiceMenu&&m.battle?.scriptName==='capture-nickname-prompt')await action({kind:'choose-menu-option',targetOption:nickname?'yes':'no'});
    else if(ui.naming?.subject==='pokemon'&&nickname)await action({kind:'enter-naming-screen-text',subject:'pokemon',targetText:nickname});
    else await step(4);
   }
   onProgress({phase:'qualifying-capture',attempt:delay+1,total:maxDelays,caught});
   if(!caught)continue;
   const plan={schema:'pokemon-suite/protected-capture-plan/v1',source,fingerprint,ballId:ball.itemId,steps,delay,throws:ball.quantity-(observe().playerMemory.trainer.bag.pokeBalls.find(b=>b.itemId===ball.itemId)?.quantity??0),verified:true,verifiedRepeats:2,estimatedFrames:steps.reduce((n,s)=>n+s.frames,0),calculatedAt:new Date().toISOString()};
   const replay=await openTrial();try{
    if(!sameSource(replay.commit,source))throw Error('Independent capture source changed');
    const result=await executeProtectedCapturePlan({plan,source,signal,observe:()=>replay.capture?replay.capture():replay.observer.capture(),execute:async a=>{for(let i=0;i<a.holdFrames;i++)replay.session.step(a.buttons);await new Promise(resolve=>setImmediate(resolve));}});
    if(result.status!=='caught')throw Error('Protected capture did not reproduce in an independent replay');
   }finally{replay.session.close();}
   return plan;
  }
  throw Error('No bounded capture timing passed qualification; the protected encounter is preserved');
 }finally{lab.session.close();}
}
