import {createHash} from 'node:crypto';
import {planTimeEvolution} from '../time-evolution.mjs';

export function createTimeEvolutionController({runtime,requestId,source,targetSpecies,state=null}){
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId??''))throw Error('Invalid evolution request.');
 if(state&&(state.requestId!==requestId||state.targetSpecies!==targetSpecies||JSON.stringify(state.source)!==JSON.stringify(source)))throw Error('This evolution controller belongs to another request.');
 const current={requestId,source:structuredClone(source),targetSpecies,phase:'preparing',reason:null,...state};
 const controller=runtime.createActivityController();
 let nativeSave=current.nativeSaveTask?runtime.createNativeSave({state:current.nativeSaveTask}):null;
 const plan=o=>planTimeEvolution(o,{source,targetSpecies},runtime.constants);
 const player=runtime.createActivityPlayer({current:()=>({id:`evolve-${requestId}`,plan:o=>current.itemIntent??plan(o)}),shoppingRemaining:()=>[],captureTargets:()=>new Set(),multichoice:()=>0});
 const stop=reason=>{current.phase='waiting';current.reason=reason;return {kind:'stop',reason};};
 const saveStep=o=>{
  const d=nativeSave.next(o);current.nativeSaveTask=nativeSave.state();
  if(d.kind==='stop')return stop(d.reason);
   if(d.kind==='complete'){
   if(current.phase==='saving-progress'){
    const p=o.party.find(p=>p.validity==='valid'&&p.personality===source.personality&&p.otId===source.otId);
    if(!p||p.species!==133||source.shiny&&!p.shiny)return stop('The saved friendship individual is no longer verified.');
    current.savedFriendship=p.friendship;current.progressSave={nativeSaveVerified:true,pokemon:structuredClone(p),savedSramSha256:createHash('sha256').update(runtime.session.saveSram()).digest('hex'),savedCounter:o.nativeSave.counter,savedFrame:o.frame};
    current.phase='preparing';current.nativeSaveTask=null;nativeSave=null;return {kind:'input',buttons:[]};
   }
   const result=plan(o);if(result.kind!=='evolved')return stop('The saved evolution identity is no longer verified.');
   current.receipt={requestId,game:'emerald',pokemon:structuredClone(result.pokemon),nativeSaveVerified:true,savedFrame:o.frame,savedCounter:o.nativeSave.counter,savedSramSha256:createHash('sha256').update(runtime.session.saveSram()).digest('hex')};
   current.phase='complete';current.nativeSaveTask=null;return {kind:'complete',receipt:current.receipt};
  }
  return {kind:'input',buttons:d.buttons};
 };
 return {
  state:()=>structuredClone(current),
  next(){
   if(current.phase==='complete')return {kind:'complete',receipt:current.receipt};
   if(current.phase==='waiting')return {kind:'wait',reason:current.reason};
   const o=runtime.observe();
   if(nativeSave)return saveStep(o);
   const shiny=!o.battle?.isTrainer&&o.battle?.enemyParty?.find(p=>p.validity==='valid'&&p.shiny);
   if(shiny){current.protectedPokemon=structuredClone(shiny);return stop('A shiny appeared while preparing the evolution. Its encounter is preserved.');}
   if(controller.idle){
    const intent=plan(o);current.progress={friendship:o.party.find(p=>p.personality===source.personality&&p.otId===source.otId)?.friendship,required:220,clock:o.localTime};
    if(intent.kind==='stop')return stop(intent.reason);
    if(intent.kind==='evolved'&&o.fieldReady){
     current.phase='saving';current.itemIntent=null;nativeSave=runtime.createNativeSave({observation:o});return saveStep(o);
    }
    const friendship=current.progress.friendship;
    if(o.fieldReady&&intent.reason==='friendship-walking'&&friendship>=(current.savedFriendship??source.friendship??70)+25){
     current.phase='saving-progress';nativeSave=runtime.createNativeSave({observation:o});return saveStep(o);
    }
    if(intent.kind==='level-up')current.itemIntent??=intent;
    if(intent.kind==='wait')current.reason=intent.reason;else current.reason=null;
    const d=player.decide(o,{lastResult:controller.lastResult});current.lastDecision=d.recommendation;
    if(d.recommendation.kind==='native-item-blocked')return stop(d.recommendation.reason);
    controller.start(d.program);
   }
   const buttons=controller.tick(runtime.observer.tick());
   const running=o.emulator.mode==='overworld'&&o.player?.map.id==='MAP_OLDALE_TOWN'&&!o.script?.fieldControlsLocked&&current.progress?.friendship<220&&buttons.some(b=>['up','down','left','right'].includes(b));
   return {kind:'input',buttons:running?['b',...buttons]:buttons};
  },
 };
}
