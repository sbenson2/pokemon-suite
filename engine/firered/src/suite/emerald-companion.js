// Native Emerald campaign inputs for a FireRed evolution dependency. The Suite
// supplies its existing owner/runtime; this controller cannot load a save.
import {createHash} from 'node:crypto';
import {selectLocalTradePartner} from './local-evolution.js';

const leagueReady=o=>{
 if(!/^MAP_EVER_GRANDE_CITY_(SIDNEYS_ROOM|PHOEBES_ROOM|GLACIAS_ROOM|DRAKES_ROOM|CHAMPIONS_ROOM|HALL[1-5])$/.test(o.player?.map.id))return null;
 const party=o.party.filter(p=>p.validity==='valid'&&!p.isEgg),lead=party[0],move=lead?.moves.filter(m=>m.power>0).sort((a,b)=>b.power*(lead.types?.includes(b.type)?1.5:1)-a.power*(lead.types?.includes(a.type)?1.5:1))[0];
 return party.length>0&&party.every(p=>p.hp===p.maxHp&&!p.status)&&(!move||move.pp>=8);
};
const milestone=o=>JSON.stringify({flags:[...Array.from({length:8},(_,i)=>`FLAG_BADGE0${i+1}_GET`),'FLAG_SYS_GAME_CLEAR','FLAG_SYS_NATIONAL_DEX',...['SIDNEY','PHOEBE','GLACIA','DRAKE'].map(name=>`FLAG_DEFEATED_ELITE_4_${name}`)].map(name=>o.flag(name)),leagueReady:leagueReady(o),party:o.party.map(p=>[p.species,p.personality,p.otId,p.moves.map(m=>m.id).filter(id=>[15,19,57,70,127,148,249,291].includes(id))])});
export function createEmeraldCompanion({runtime,requestId,state=null}){
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId??''))throw Error('Invalid companion request.');
 if(state&&state.requestId!==requestId)throw Error('This companion belongs to another evolution request.');
 let lastDecision=null,routeFailures=0;
 const current={requestId,phase:'preparing',reason:null,...state};
 let nativeSave=current.nativeSaveTask?runtime.createNativeSave({state:current.nativeSaveTask}):null;
 const input=buttons=>({kind:'input',action:{buttons,holdFrames:1,releaseFrames:0}});
 const saveStep=o=>{
  const next=nativeSave.next(o);current.nativeSaveTask=nativeSave.state();
  if(next.kind==='stop'){current.phase='waiting';current.reason=next.reason;return next;}
  if(next.kind==='complete'){
   current.nativeSaveReceipt={frame:o.frame,counter:o.nativeSave.counter,gameStat:o.nativeSave.gameStat,sha256:createHash('sha256').update(runtime.session.saveSram()).digest('hex'),party:JSON.parse(current.nativeSaveTask.party)};
   current.savedMilestone=current.savingMilestone;current.nativeSaveTask=null;current.savingMilestone=null;nativeSave=null;
   return input([]);
  }
  return input(next.buttons);
 };
 return {
  state:()=>({...current}),
  wait(reason){current.phase='waiting';current.reason=reason;},
  resume(){current.phase='preparing';current.reason=null;routeFailures=0;lastDecision=null;},
  next(){
   if(current.phase!=='preparing')return {kind:'wait',reason:current.reason};
   if(nativeSave){
    const o=runtime.observe();
    // Hall of Fame starts its own scripted save. A stale menu-save intent
    // from the short entry transition must not monopolize those inputs.
    if(o.player?.map.id==='MAP_EVER_GRANDE_CITY_HALL_OF_FAME'&&!o.nativeSave.active&&!current.nativeSaveTask?.sawSuccess){nativeSave=null;current.nativeSaveTask=null;current.savingMilestone=null;}
    else return saveStep(o);
   }
   const buttons=runtime.stepButtons(),o=runtime.lastObservation??runtime.observe();
   current.objective=runtime.story.status(o).activeObjective;
   const shiny=!o.battle?.isTrainer&&o.battle?.enemyParty?.find(p=>p.validity==='valid'&&p.shiny);
   if(shiny){current.phase='protected-encounter';current.reason='A shiny appeared during companion preparation. Its encounter is preserved.';current.protectedPokemon=structuredClone(shiny);return {kind:'stop',reason:current.reason};}
   if(runtime.createNativeSave&&o.fieldReady&&o.player?.map.id!=='MAP_EVER_GRANDE_CITY_HALL_OF_FAME'&&o.party?.length&&o.party.every(p=>p.validity==='valid')){
    const key=milestone(o);
    if(key!==current.savedMilestone || runtime.lastDecision?.recommendation.kind==='campaign-complete' && (current.nativeSaveReceipt?.counter!==o.nativeSave.counter || current.nativeSaveReceipt?.gameStat!==o.nativeSave.gameStat || current.nativeSaveReceipt?.sha256!==createHash('sha256').update(runtime.session.saveSram()).digest('hex'))){
     const fresh=runtime.observe();
     if(fresh.fieldReady){
      runtime.controller.cancel('native-save-milestone');
      nativeSave=runtime.createNativeSave({observation:fresh});current.savingMilestone=milestone(fresh);
      return saveStep(fresh);
     }
    }
   }
   if(runtime.lastDecision!==lastDecision){
    lastDecision=runtime.lastDecision;
    if(['no-route','no-approach'].includes(lastDecision?.recommendation.kind))routeFailures++;
    else if(lastDecision?.advisor==='navigation'||['transit','walk','interact'].includes(lastDecision?.recommendation.kind))routeFailures=0;
    if(routeFailures>=30){current.phase='waiting';current.reason=`The native route for ${current.objective?.id??'companion preparation'} needs repair. The current game is preserved.`;return {kind:'stop',reason:current.reason};}
   }
   if(runtime.lastDecision?.recommendation.kind==='native-item-blocked'){current.phase='waiting';current.reason=runtime.lastDecision.recommendation.reason;return {kind:'stop',reason:current.reason};}
   if(runtime.lastDecision?.recommendation.kind==='campaign-complete'){
    if(o.fieldReady&&o.flag?.('FLAG_SYS_GAME_CLEAR')&&o.flag('FLAG_SYS_NATIONAL_DEX')&&current.savedMilestone===milestone(o)&&current.nativeSaveReceipt?.counter===o.nativeSave.counter&&current.nativeSaveReceipt?.gameStat===o.nativeSave.gameStat&&current.nativeSaveReceipt.sha256===createHash('sha256').update(runtime.session.saveSram()).digest('hex')){
     current.phase='ready-for-transfer';current.reason='Emerald’s League and National Dex are complete and natively saved. Waiting for the paired evolution transfer.';
     current.transferCandidate=structuredClone(selectLocalTradePartner(o.party));
     return {kind:'stop',reason:current.reason};
    }
    current.phase='waiting';current.reason='The companion needs its remaining native campaign route before it can trade with FireRed.';
    return {kind:'stop',reason:current.reason};
   }
   return input(buttons);
  },
 };
}
