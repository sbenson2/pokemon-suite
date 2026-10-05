import {EffortTrainingTask} from './ev-training.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
import {partyFullyRestored} from '../player/recovery.js';
const FP=/^\[/;
const menuOpen=o=>Object.values(o.playerMemory.ui??{}).some(Boolean);
const itemCount=(trainer,id)=>Object.values(trainer.bag??{}).flatMap(v=>Array.isArray(v)?v:[]).reduce((n,item)=>n+(item.itemId===id?item.quantity:0),0);
export class PlayerTask {
 constructor({request,state=null,world,mechanics,planner,qmmSupply=null}) {
  this.state=structuredClone(state??{request,phase:'working'});this.world=world;this.mechanics=mechanics;this.planner=planner;this.qmmSupply=qmmSupply;
  const r=this.state.request;
  if(!r||!/^[a-zA-Z0-9_-]{1,100}$/.test(r.id)||!['travel','item','heal','save','ev-training','park'].includes(r.kind))throw Error('Choose a supported player task.');
  // extra-saves (build 126): a helper parks its goal Pokémon for the main save.
  if(r.kind==='park'){
   if(!/_POKEMON_CENTER_1F$/.test(r.map??'')||!world.data.maps.some(m=>m.id===r.map))throw Error('Choose a Pokémon Center to park in.');
   if(!Array.isArray(r.goals)||!r.goals.length||r.goals.length>4||r.goals.some(g=>!Number.isInteger(g?.speciesId)))throw Error('Choose the helper goal Pokémon to park.');
   if(r.keep!==undefined&&(!Array.isArray(r.keep)||r.keep.length>4||r.keep.some(fp=>typeof fp!=='string'||!FP.test(fp))))throw Error('Choose the Pokémon kept in the parked party.');
  }
  if(r.kind==='ev-training')this.effort=new EffortTrainingTask({request:r,state:this.state.effort,world,mechanics,planner});
  if(r.kind==='travel'&&!world.data.maps.some(m=>m.id===r.map))throw Error('Choose a location in this game.');
  if(r.kind==='item'&&(!Number.isInteger(r.itemId)||r.itemId<1||!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>99))throw Error('Choose an item and quantity from 1 to 99.');
 }
 inspect(o) {
  if(this.effort){const next=this.effort.inspect(o);this.state.effort=this.effort.state;this.state.phase=this.effort.state.phase;this.state.progress=this.effort.state.progress;return next;}
  const s=this.state,r=s.request,m=o.playerMemory;
  const policy=target=>({kind:'policy',objective:{id:`player-${r.id}`,target,dialogue:'advance',choice:'yes',deferOptionalDetours:true}});
  if(o.phase!=='stable'||!o.emulator.inputReady)return {kind:'wait'};
  if(s.phase==='complete')return {kind:'complete',receipt:s.receipt};
  if(s.phase==='saving'){
   const verified=m.saveAttemptStatus===1&&m.gameStats?.savedGame===s.save.counter+1&&o.sram?.sha256!==s.save.sha256;
   if(verified&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!menuOpen(o)){
    let parked={};
    if(r.kind==='park'){
     const party=m.trainer?.party??[],members=s.targets.map(fp=>party.find(p=>encounterFingerprint(p)===fp));
     if(m.map?.id!==r.map||members.some(p=>!p))return {kind:'stop',reason:'The parked helper goal is not in the saved party at the Pokémon Center.'};
     parked={center:r.map,grants:[...s.targets],pokemon:members.map(p=>structuredClone(p))};
    }
    s.phase='complete';s.receipt={request:r,nativeSaveVerified:true,savedSramSha256:o.sram.sha256,frame:o.frame,...parked};
    return {kind:'complete',receipt:s.receipt};
   }
   if(['error','saving-error'].includes(m.ui?.saveDialog?.stage))return {kind:'stop',reason:'The game could not save. Resolve the save prompt before resuming.'};
   return policy({kind:'save-game',map:s.save.map,saveVerified:verified});
  }
  if(r.kind==='park')return this.park(o,policy);
  const field=o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!menuOpen(o);
  let done=false;
  if(r.kind==='travel'){
   s.objective=policy({kind:'map-arrival',map:r.map}).objective;
   done=field&&m.map?.id===r.map;
  }else if(r.kind==='item'){
   if(m.trainer?.partyValidity!=='valid')return {kind:'wait'};
   const count=itemCount(m.trainer,r.itemId);s.baseline??=count;
   done=field&&count>=s.baseline+r.quantity;
   // With the opt-in Mail supply, Rare Candy requests are duplicated instead of collected.
   if(!done&&field&&r.itemId===68&&this.qmmSupply?.enabled&&this.qmmSupply.available?.()!==false)return {kind:'qmm',itemId:68,stockTarget:s.baseline+r.quantity};
   if(!done&&field){
    s.objective=this.planner.selectItemPreparation(o,r.itemId,s.baseline+r.quantity-count);
    if(!s.objective)return {kind:'stop',reason:'No reachable supply of this item is available in the current game.'};
   }
  }else if(r.kind==='heal'){
   const party=m.trainer?.party;
   if(m.trainer?.partyValidity!=='valid'||!party?.length)return {kind:'wait'};
   const moves=(this.mechanics?.data??this.mechanics)?.moves??[];
   done=field&&party.every(p=>p.validity==='valid'&&p.hp===p.maxHp&&p.status1===0&&p.moves.every((id,i)=>!id||p.pp[i]>=((Array.isArray(moves)?moves.find(v=>v.id===id):moves[id])?.pp??Infinity)*(1+(((p.ppBonuses??0)>>(i*2))&3)*.2)));
   if(!done&&field){s.objective=this.planner.selectRecovery(o);if(!s.objective)return {kind:'stop',reason:'No reachable healing location is verified.'};}
  }else done=field;
  if(done){
   if(!Number.isInteger(m.gameStats?.savedGame)||!o.sram?.sha256)return {kind:'wait'};
   s.phase='saving';s.save={counter:m.gameStats.savedGame,sha256:o.sram.sha256,map:m.map.id};
   return policy({kind:'save-game',map:m.map.id,saveVerified:false});
  }
  return s.objective?{kind:'policy',objective:s.objective}:policy({kind:'map',map:m.map?.id});
 }
 // The goal individuals are this save's own (its trainer ID), found once by
 // species; a shiny, missing or ambiguous goal stays home. They and any loan
 // subject join the party, which is healed and saved at the Center.
 park(o,policy){
  const s=this.state,r=s.request,m=o.playerMemory,t=m.trainer??{},ui=m.ui??{};
  if(o.emulator.inBattle)return policy({kind:'map',map:r.map});
  if(t.partyValidity!=='valid'||t.storage?.validity!=='valid')return {kind:'wait'};
  const all=[...t.party,...t.storage.pokemon].filter(p=>p?.validity==='valid');
  if(!s.targets){
   const targets=[];
   for(const goal of r.goals){
    const own=all.filter(p=>!p.isEgg&&p.otId===t.otId&&nationalSpeciesId(p.species)===goal.speciesId);
    if(own.length!==1)return {kind:'stop',reason:own.length?'The helper goal is ambiguous: this save holds more than one of that Pokémon.':'The helper goal Pokémon is not in this save.'};
    if(own[0].shiny)return {kind:'stop',reason:'The helper goal Pokémon is shiny. It stays in this save and is never offered.'};
    targets.push(encounterFingerprint(own[0]));
   }
   s.targets=targets;
  }
  const required=[...new Set([...s.targets,...(r.keep??[])])];
  if(!ui.storage&&required.some(fp=>all.filter(p=>encounterFingerprint(p)===fp).length!==1))return {kind:'stop',reason:'A Pokémon kept for the parked party is missing or duplicated.'};
  const party=t.party.map(encounterFingerprint);
  if(s.phase==='working'){
   if(required.some(fp=>!party.includes(fp))||m.map?.id!==r.map||ui.storage)
    return policy({kind:'party-roster',map:r.map,minimumPartySize:Math.max(2,Math.min(6,required.length)),maximumPartySize:6,requiredFingerprints:required,
     requiredFamilies:t.party.filter(p=>p.moves?.includes(19)).map(p=>[p.species])});
   s.phase='healing';
  }
  const nurse=this.world.data.maps.find(x=>x.id===r.map)?.objectEvents?.findIndex(e=>/EventScript_Nurse$/.test(e.script))??-1;
  if(!(nurse>=0))return {kind:'stop',reason:'The Pokémon Center nurse could not be verified.'};
  if(m.map?.id!==r.map||!partyFullyRestored(m,this.mechanics)||ui.fieldDialog||ui.choiceMenu||o.emulator.mode!=='overworld')return policy({kind:'object',map:r.map,index:nurse});
  if(!Number.isInteger(m.gameStats?.savedGame)||!o.sram?.sha256)return {kind:'wait'};
  s.phase='saving';s.save={counter:m.gameStats.savedGame,sha256:o.sram.sha256,map:r.map};
  return policy({kind:'save-game',map:r.map,saveVerified:false});
 }
}
