import {createHash} from 'node:crypto';
import {inspectNativePokeblock,planBeautyFeeding,pokeblockBeautyGain} from '../beauty.mjs';
import {createBerryRecipes,readNativeBlender,blenderButtons,verifyBlenderResult,predictPokeblock} from '../berry-blender.mjs';
import {planBeautyResources,planBeautyLevelUp,verifyBeautyIndividual} from '../beauty-preparation.mjs';

export function createBeautyEvolutionController({runtime,requestId,source,targetSpecies=350,state=null}){
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId??'')||targetSpecies!==350||source.species!==328)throw Error('Choose a saved Feebas for its native Milotic evolution.');
 if(state&&(state.requestId!==requestId||state.targetSpecies!==targetSpecies||JSON.stringify(state.source)!==JSON.stringify(source)))throw Error('This Beauty controller belongs to another request.');
 const current={requestId,source:structuredClone(source),targetSpecies,phase:'preparing',reason:null,blended:[],fed:[],excludedTrees:[],...state};
 const read=(p,n)=>runtime.session.readMemory(p,n),recipes=createBerryRecipes(read,runtime.manifest);
 const controller=runtime.createActivityController();let objective=null,routeFailures=0;
 let nativeSave=current.nativeSaveTask?runtime.createNativeSave({state:current.nativeSaveTask}):null;
 const player=runtime.createActivityPlayer({current:()=>({id:`beauty-${requestId}`,plan:()=>current.itemIntent??objective}),shoppingRemaining:()=>[],captureTargets:()=>new Set(),multichoice:()=>0});
 const input=buttons=>({kind:'input',buttons});
 const stop=reason=>{current.resumePhase=current.phase;current.phase='waiting';current.reason=reason;return {kind:'stop',reason};};
 const receipt=o=>({requestId,game:'emerald',pokemon:structuredClone(verifyBeautyIndividual(o.party,source)),nativeSaveVerified:true,savedFrame:o.frame,savedCounter:o.nativeSave.counter,savedSramSha256:createHash('sha256').update(runtime.session.saveSram()).digest('hex')});
 const saveStep=o=>{
  const d=nativeSave.next(o);current.nativeSaveTask=nativeSave.state();
  if(d.kind==='stop')return stop(d.reason);
  if(d.kind==='complete'){
   const saved=receipt(o);current.nativeSaveTask=null;nativeSave=null;
   if(current.phase==='saving'){
    if(saved.pokemon.species!==329)return stop('The native save did not retain the reserved Milotic.');
    current.receipt={...saved,beautyPreparation:{blended:current.blended,fed:current.fed}};current.phase='complete';return {kind:'complete',receipt:current.receipt};
   }
   current.progressSave=saved;current.phase='preparing';return input([]);
  }
  return input(d.buttons);
 };
 const beginSave=(o,complete=false)=>{current.phase=complete?'saving':'saving-progress';nativeSave=runtime.createNativeSave({observation:o});return saveStep(o);};
 const short=button=>runtime.inputProgram(button?[button]:[],2,16);
 return {
  state:()=>structuredClone(current),
  resume(){if(current.phase==='waiting'){current.phase=current.resumePhase??'preparing';current.reason=null;current.unreadableFrames=0;routeFailures=0;}},
  next(){
   if(current.phase==='complete')return {kind:'complete',receipt:current.receipt};
   if(current.phase==='waiting')return {kind:'wait',reason:current.reason};
   const o=runtime.observe();
   if(nativeSave)return saveStep(o);
   if(!o.battle?.isTrainer&&o.battle?.enemyParty?.some(p=>p.validity==='valid'&&p.shiny))return stop('A shiny appeared during Beauty preparation. The encounter is preserved.');
   if(o.emulator.paletteFadeActive)return input([]);
   const blender=readNativeBlender(read,runtime.manifest,o);
   if(o.emulator.mode==='transition'&&!blender)return input([]);
   if(o.party.some(p=>p.validity!=='valid')){
    current.unreadableFrames=(current.unreadableFrames??0)+1;
    return current.unreadableFrames>120?stop('The native party has remained unreadable. Preserve its current state.'):input([]);
   }
   current.unreadableFrames=0;
   let p;
   try{p=verifyBeautyIndividual(o.party,source);}catch(e){return stop(e.message);}
   current.progress={beauty:p.beauty,required:170,sheen:p.sheen,blocksBlended:current.blended.length,blocksFed:current.fed.length,stage:current.phase};
   if(p.species===329&&o.fieldReady){current.itemIntent=null;return beginSave(o,true);}
   if(p.species===328&&(p.level>=100||p.heldItem===195))return stop(p.level>=100?'A level 100 Feebas cannot evolve by native level-up.':'Remove the reserved Feebas’s Everstone before preparing Beauty.');
   if(blender?.phase==='CB2_PlayBlender'){
    if(!current.blend||blender.numPlayers!==4||blender.chosenItems[0]!==current.blend.itemId||blender.perfectOpponents!==0)return stop('The native blender participants do not match the reserved three-NPC recipe.');
    controller.cancel?.('native-blender-timing');
    const buttons=blenderButtons(blender,current.lastA);current.lastA=buttons.includes('a');current.blend.metrics=blender;
    return input(buttons);
   }
   if(controller.idle){
    let program=null;
    if(current.feed){
     const d=inspectNativePokeblock(o,current.feed);
     if(d.kind==='stop')return stop(d.reason);
     if(d.kind==='complete'){current.fed.push({block:current.feed.block,before:current.feed.before,after:current.feed.expected});current.feed=null;return beginSave(o);}
     program=short(d.button);
    }else if(current.blend){
     if(o.fieldReady&&current.blend.metrics){
      let block;try{block=verifyBlenderResult(current.blend.before,{berries:o.bag.berries,blocks:o.pokeblocks},current.blend.itemId);}catch(e){return stop(e.message);}
      const metrics=current.blend.metrics,expected=predictPokeblock(metrics.chosenItems.map(id=>recipes.berry(id)),metrics.maxRPM);
      if(!expected||Object.entries(expected).some(([k,v])=>block[k]!==v))return stop('The actual Pokéblock differs from the cartridge recipe. Feebas is preserved.');
      current.blended.push({berry:current.blend.itemId,block,metrics});current.blend=null;current.lastA=false;return beginSave(o);
     }
     current.phase='blending';objective={kind:'interact',map:'MAP_LILYCOVE_CITY_CONTEST_LOBBY',x:23,y:9};
     if(blender)program=short(blender.phase==='CB2_EndBlenderGame'&&blender.gameEndState===10?'b':'a');
     else if(o.emulator.mode==='bag'){
      if(o.hasTask('Task_BagMenu_HandleInput')){
       const index=o.bag.berries.findIndex(b=>b.itemId===current.blend.itemId&&b.quantity>0),bag=o.menus.bag;
       if(index<0)return stop('The reserved blending berry is absent.');
       if(bag.pocket!==3)program=short((3-bag.pocket+5)%5<=2?'right':'left');
       else {const cursor=bag.cursor[3]+bag.scroll[3];program=short(cursor===index?'a':cursor<index?'down':'up');}
      }else program=short('a');
     }
    }else if(current.harvest){
     const quantity=(o.bag.berries??[]).find(b=>b.itemId===current.harvest.itemId)?.quantity??0;
     if(quantity>current.harvest.before){
      if(o.fieldReady){current.harvest=null;return beginSave(o);}
      program=short('a');
     }else {current.phase='harvesting';objective=current.harvest.intent;}
    }else if(o.fieldReady){
     // Secure a real level-up resource before spending any irreversible Sheen.
     const level=planBeautyLevelUp(o,p,runtime.constants);
     if(level.kind==='stop')return stop(level.reason);
     if(level.kind!=='level-up'){objective=level;current.phase='level-up-supplies';}
     else if(!o.flag('FLAG_RECEIVED_POKEBLOCK_CASE')){current.phase='case';objective={kind:'interact-at',map:'MAP_LILYCOVE_CITY_CONTEST_LOBBY',x:14,y:4,facing:'up'};}
     else {
      const plan=planBeautyResources(o,p,runtime.constants,recipes,current.excludedTrees);
      if(plan.kind==='stop')return stop(plan.reason);
      if(plan.kind==='ready'){current.phase='leveling';current.itemIntent??=level;objective=current.itemIntent;}
      else if(plan.kind==='feed'){
       const block=o.pokeblocks.find(b=>b.slot===plan.slots[0]);
       // Reserve the full viable plan before acknowledging the first feed.
       current.feedingPlan={slots:plan.slots,beauty:plan.beauty,sheen:plan.sheen};current.phase='feeding';
       current.feed={source:structuredClone(p),block:structuredClone(block),blocksBefore:structuredClone(o.pokeblocks),before:{beauty:p.beauty,sheen:p.sheen},expected:{beauty:Math.min(255,p.beauty+pokeblockBeautyGain(p.personality,block)),sheen:Math.min(255,p.sheen+block.feel)},caseItemId:runtime.constants.items.ITEM_POKEBLOCK_CASE};
       return input([]);
      }else if(plan.kind==='blend'){
       current.blend={itemId:plan.itemId,before:{berries:structuredClone(o.bag.berries),blocks:structuredClone(o.pokeblocks)},metrics:null};current.phase='blending';return input([]);
      }else {current.harvest={itemId:plan.itemId,before:(o.bag.berries??[]).find(b=>b.itemId===plan.itemId)?.quantity??0,intent:plan};objective=plan;current.phase='harvesting';}
     }
    }
    if(!program){
     if(current.phase==='case'&&o.menus.multichoice?.active)program=short('b');
     else if(o.emulator.mode==='transition')program=short(null);
     else {
      const d=player.decide(o,{lastResult:controller.lastResult});current.lastDecision=d.recommendation;
      if(d.recommendation.kind==='native-item-blocked')return stop(d.recommendation.reason);
      if(['no-route','no-approach'].includes(d.recommendation.kind))routeFailures++;else routeFailures=0;
      if(routeFailures>=12){
       if(current.harvest){current.excludedTrees.push(current.harvest.intent.treeId);current.harvest=null;current.phase='preparing';routeFailures=0;return input([]);}
       return stop('The native route for Beauty preparation needs repair. Feebas and its progress are preserved.');
      }
      program=d.program;
     }
    }
    if(program)controller.start(program);
   }
   return input(controller.tick(runtime.observer.tick()));
  },
 };
}
