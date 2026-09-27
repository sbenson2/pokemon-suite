import {encounterFingerprint} from '../player/encounter-tracker.js';
import {fireRedPokemonCenter,saveFireRedQuestMilestone} from './fire-red-link-quest.js';
import {partyFullyRestored} from '../player/recovery.js';

export function readNativeEggHatch(session,runtime,o){
 if(o?.emulator?.callback2!=='CB2_EggHatch_1')return null;
 const address=(runtime.data??runtime).symbols.sEggHatchData?.address;if(!Number.isInteger(address))return null;
 const ptr=Buffer.from(session.readMemory(address,4));if(ptr.length!==4)return null;
 const base=ptr.readUInt32LE();if(base<0x02000000||base>0x0203fff0)return null;
 const bytes=Buffer.from(session.readMemory(base,16));
 if(bytes.length!==16||bytes[2]>12||bytes[4]>5)return null;
 return {stage:bytes[2],partySlot:bytes[4],species:bytes.readUInt16LE(12)};
}

// All targets are native map interactions. Workflow state holds reservations
// and receipts only; progress is read again after every menu, battle and restart.
const towerRoster=o=>{
 const t=o.playerMemory?.trainer;
 if(t?.partyValidity!=='valid'||!t.party?.length)return null;
 return JSON.stringify(t.party.map(p=>[encounterFingerprint(p),p.level,p.moves,p.heldItem,p.stats]).sort((a,b)=>a[0].localeCompare(b[0])));
};

function hasPermanentTowerCore(members,teamPlan){
 const families=teamPlan?.permanentFamilies;
 if(!Array.isArray(families)||families.length<6)return false;
 const represented=members.map(p=>families.findIndex(family=>family.includes(p.species)));
 return represented.every(index=>index>=0)&&new Set(represented).size>=5;
}

function balancedTowerRoster(trainer,teamPlan){
 if(trainer?.partyValidity!=='valid'||trainer.storage?.validity!=='valid'||trainer.party?.length!==6)return null;
 const ranked=[...trainer.party].filter(p=>p.validity==='valid'&&!p.isEgg&&Number.isInteger(p.level)).sort((a,b)=>b.level-a.level);
 if(ranked.length!==6||ranked[0].level-ranked[1].level<=12)return null;
 const core=trainer.party.filter(p=>p!==ranked[0]),ceiling=ranked[1].level;
 if(!hasPermanentTowerCore(core,teamPlan))return null;
 const coreExperience=core.map(p=>p.experience);
 if(!coreExperience.every(Number.isInteger))return null;
 const experienceFloor=Math.min(...coreExperience)*0.6;
 // Boxed Pokémon expose experience but not a current level. Require enough
 // recorded experience before using one to replace a single high-level outlier.
 const reserve=trainer.storage.pokemon?.filter(p=>p.validity==='valid'&&!p.isEgg&&
  (Number.isInteger(p.level)?p.level>=ceiling-12&&p.level<=ceiling+2:
   Number.isInteger(p.experience)&&p.experience>=experienceFloor)&&
  !core.some(q=>q.species===p.species)).sort((a,b)=>Number(b.experience??0)-Number(a.experience??0))[0];
 if(!reserve||new Set([...core,reserve].map(p=>p.species)).size!==6)return null;
 return {preferredFamilies:[...core,reserve].map(p=>[p.species]),targetLevel:Math.max(...core.map(p=>p.level),Number(reserve.level)||1)};
}

export function observeTrainerTower(o,state){
 const m=o.playerMemory,s=state?.tower;
 if(!s||!m?.map?.id?.startsWith('MAP_TRAINER_TOWER_'))return;
 // The native lobby heals the party and clears hasLost. Retain the actual
 // battle outcome, not the short-lived lobby flag or the healed HP values.
 if(o.emulator.inBattle&&m.battleOutcome===0){
  const roster=towerRoster(o);if(roster)s.battleRoster??=roster;
 }
 if(s.battleRoster&&m.battleOutcome===2){
  const retain=defeat=>{
   if(!Number.isInteger(defeat?.mode)||!defeat.roster)return;
   const history=(s.defeats??={})[defeat.mode]??=[];
   if(!history.some(prior=>prior.roster===defeat.roster))history.push(defeat);
   s.defeats[defeat.mode]=history;
  };
  retain(s.defeat);
  s.defeat={mode:s.mode,roster:s.battleRoster,frame:o.frame};retain(s.defeat);
  delete s.battleRoster;
 }else if(m.battleOutcome===1)delete s.battleRoster;
}

export function postgameSideQuest(id,o,world,state,context={}){
 const m=o.playerMemory,t=m.trainer??{},here=m.map.id,f=m.storyState?.flagIds??{},v=m.storyState?.variableIds??{};
 const maps=(world.data??world).maps,party=t.party??[],all=[...party,...(t.storage?.pokemon??[])];
 // Tower preparation uses the same roster policy as campaign battles. Keep
 // that requirement on travel/menu objectives too, so leaving the lobby for
 // the PC does not discard the pending roster assembly.
 const preparingTower=id==='trainer-tower'&&!(v[0x4082]===1&&here.startsWith('MAP_TRAINER_TOWER_'));
 const towerState=id==='trainer-tower'?(state.tower??={}):null;
 if(!preparingTower&&towerState)delete towerState.restorePermanentRoster;
 if(preparingTower&&towerState?.balancedRoster&&
    !hasPermanentTowerCore(towerState.balancedRoster.preferredFamilies.slice(0,5).map(family=>({species:family[0]})),context.teamPlan))delete towerState.balancedRoster;
 if(preparingTower&&towerState?.balancedRoster&&t.partyValidity==='valid'&&t.storage?.validity==='valid'&&
    !towerState.balancedRoster.preferredFamilies.every(family=>all.some(p=>p.validity==='valid'&&family.includes(p.species))))delete towerState.balancedRoster;
 // Restoring a collection party owns the whole preparation transaction. The
 // newly assembled permanent six must not trigger a second roster choice.
 if(preparingTower&&!towerState.balancedRoster&&!towerState.restorePermanentRoster&&t.partyValidity==='valid'&&
    context.teamPlan?.permanentFamilies?.length>=6&&party.some(p=>
     !context.teamPlan.permanentFamilies.some(family=>family.includes(p.species))))towerState.restorePermanentRoster=true;
 const balanced=preparingTower?
  (!towerState.restorePermanentRoster?(towerState.balancedRoster??=balancedTowerRoster(t,context.teamPlan)):null):towerState?.balancedRoster;
 const battleRoster=id==='trainer-tower'?{importantBattle:true,minimumBattlePartySize:6,minimumReadyBattleMembers:6,battleCategory:'trainer-tower',rosterPreparationFor:'postgame-trainer-tower',
  // The cartridge scales every opponent to the party's highest level. Tower
  // battles award no training experience, so prepare before starting a run.
  ...(preparingTower?{identityEvolution:false,battleTeamTargetLevel:balanced?.targetLevel??Math.min(100,Math.max(1,...party.map(p=>Number(p.level)||1)))}:{}),
  ...(balanced?{preferredFamilies:balanced.preferredFamilies}:{})}:{};
 const goal=(suffix,target,extra={})=>({id:`postgame-${id}-${suffix}`,target,dialogue:'advance',choice:'yes',identityEvolution:true,deferOptionalDetours:true,...battleRoster,...extra});
 const stop=reason=>goal('unavailable',{kind:'stop-for-review',reason});
 const reach=map=>goal('travel',{kind:'map-arrival',map});
 const event=(map,script,kind='object',extra={})=>{
  const row=maps.find(m=>m.id===map),list=kind==='background'?row?.backgroundEvents:row?.objectEvents,index=list?.findIndex(e=>e.script===script)??-1;
  return index<0?stop(`The cartridge interaction ${script} is unavailable.`):goal('interact',{kind,map,index},extra);
 };
 if(id==='togepi'){
  const s=state.togepi??={started:true};
  if(t.partyValidity!=='valid'||t.storage?.validity!=='valid')return stop('Verify the party and PC before receiving the Togepi Egg.');
  if(f[730]===true){
   const candidates=all.filter(p=>p.validity==='valid'&&p.species===175);
   const p=s.fingerprint?candidates.find(p=>encounterFingerprint(p)===s.fingerprint):candidates.find(p=>p.isEgg);
   if(p&&!s.fingerprint)s.fingerprint=encounterFingerprint(p);
   if(p?.isEgg){
    if(!party.some(q=>encounterFingerprint(q)===s.fingerprint))return goal('withdraw-egg',{kind:'party-roster',map:fireRedPokemonCenter(here),minimumPartySize:2,maximumPartySize:6,requiredFingerprints:[s.fingerprint],requiredFamilies:party.filter(q=>q.moves?.includes(19)).map(q=>[q.species])});
    return goal('hatch',{kind:'friendship-walk',map:fireRedPokemonCenter(here),fingerprint:s.fingerprint});
   }
   if(!p&&!t.pokedex?.ownedSpecies?.includes(175))return stop('The received Togepi Egg is absent from this save. A native trade or breeding source is required.');
   const saved=saveFireRedQuestMilestone(o,s.save??={},{flagId:730,id:'postgame-togepi-save',label:'The hatched Togepi'});
   if(saved.kind==='policy')return saved.objective;
   if(saved.kind==='stop')return stop(saved.reason);
   s.receipt={...saved.receipt,fingerprint:s.fingerprint??null};return null;
  }
  if(f[730]!==false)return stop('The Togepi gift availability is unreadable.');
  const lead=party.filter(p=>p.validity==='valid'&&!p.isEgg&&Number.isInteger(p.friendship)).sort((a,b)=>b.friendship-a.friendship||a.slot-b.slot)[0];
  if(!lead)return stop('The lead Pokémon’s friendship could not be read.');
  if(lead.friendship<255&&f[731]!==true)return goal('friendship',{kind:'friendship-walk',map:fireRedPokemonCenter(here),fingerprint:encounterFingerprint(lead)});
  if(lead.slot!==0)return goal('lead',{kind:'lead-party-member',map:here,fingerprint:encounterFingerprint(lead)});
  if(party.length>=6)return goal('party-space',{kind:'party-roster',map:fireRedPokemonCenter(here),minimumPartySize:2,maximumPartySize:5,requiredFingerprints:[...new Set([lead,...party.filter(p=>p.moves?.some(id=>[19,57].includes(id)))].map(encounterFingerprint))].slice(0,5)});
  return event('MAP_FIVE_ISLAND_WATER_LABYRINTH','FiveIsland_WaterLabyrinth_EventScript_EggGentleman');
 }
 if(id==='trainer-tower'){
  const records=m.postgameEvidence?.trainerTower,active=m.postgameEvidence?.trainerTowerChallenge;
  if(!Array.isArray(records)||records.length!==4)return stop('Trainer Tower’s four native records are unreadable.');
  if(records.every(r=>r.receivedPrize))return null;
  const lobby='MAP_TRAINER_TOWER_LOBBY',s=state.tower??={};
  const started=v[0x4082]===1,inside=here.startsWith('MAP_TRAINER_TOWER_');
  if(started&&inside){
   if(!Number.isInteger(active)||active<0||active>3)return stop('The active Trainer Tower mode is unreadable.');
   s.mode=active;
   if(records[active].receivedPrize||records[active].hasLost)return reach('MAP_SEVEN_ISLAND_TRAINER_TOWER');
  }else{
   const roster=towerRoster(o),atTargetLevel=party.every(p=>p.level>=Number(battleRoster.battleTeamTargetLevel));
   s.mode=records.findIndex((record,mode)=>!record.receivedPrize&&
    !(atTargetLevel&&roster&&[
     ...(s.defeats?.[mode]??[]),
     ...(s.defeat?.mode===mode?[s.defeat]:[]),
    ].some(defeat=>defeat.roster===roster)));
   if(s.mode<0)return stop('Trainer Tower defeated this same prepared team in every pending mode. Change its levels, moves, held items or members before retrying.');
  }
  if(!inside)return reach(lobby);
  const ready=party.filter(p=>p.validity==='valid'&&!p.isEgg&&p.hp>0&&p.hp>=p.maxHp*0.65&&p.pp?.some(n=>n>0));
  if(here===lobby){
   if(!partyFullyRestored(m,context.mechanics))return event(lobby,'TrainerTower_Lobby_EventScript_Nurse');
   if(started)return reach('MAP_TRAINER_TOWER_1F');
   if(ready.length<2)return stop('Trainer Tower needs at least two healthy battling Pokémon.');
   const trigger=maps.find(m=>m.id===lobby)?.coordEvents?.find(e=>e.script==='TrainerTower_Lobby_EventScript_EntryTrigger');
   return trigger?goal('choose-mode',{kind:'walk-to',map:lobby,x:trigger.x,y:trigger.y},{choiceByRows:{3:0,5:s.mode}}):stop('Trainer Tower’s entry trigger is missing.');
  }
  if(records[s.mode].floorsCleared<8&&ready.length<Math.min(4,party.filter(p=>!p.isEgg).length))
   return event(lobby,'TrainerTower_Lobby_EventScript_Nurse');
  if(here==='MAP_TRAINER_TOWER_ROOF')return event(here,'TrainerTower_EventScript_Owner');
  const floor=Number(/^MAP_TRAINER_TOWER_([1-8])F$/.exec(here)?.[1]);
  if(!floor)return reach('MAP_TRAINER_TOWER_ROOF');
  // A cleared floor is a safe return point: the lobby nurse restores HP, status
  // and PP without ending a live challenge. Do this before another floor battle.
  if(!o.emulator.inBattle&&records[s.mode].floorsCleared<8&&records[s.mode].floorsCleared>=floor-1&&
     !partyFullyRestored(m,context.mechanics))return event(lobby,'TrainerTower_Lobby_EventScript_Nurse');
  if(records[s.mode].floorsCleared>=floor)return reach(floor===8?'MAP_TRAINER_TOWER_ROOF':`MAP_TRAINER_TOWER_${floor+1}F`);
  const script=v[0x400e]===0?'TrainerTower_EventScript_SingleBattleTrigger':v[0x400f]===0?'TrainerTower_EventScript_DoubleBattleTriggerBottom':null;
  const trigger=maps.find(m=>m.id===here)?.coordEvents?.find(e=>e.script===script);
  return trigger?goal('battle-floor-'+floor,{kind:'walk-to',map:here,x:trigger.x,y:trigger.y},{importantBattle:true,battleCategory:'trainer-tower'}):stop('The current Tower floor has no verified active battle trigger.');
 }
 if(id==='memorial-pillar'){
  const lemonade=Object.values(t.bag??{}).flat().some(i=>i.itemId===28&&i.quantity>0);
  if(lemonade)return event('MAP_FIVE_ISLAND_MEMORIAL_PILLAR','FiveIsland_MemorialPillar_EventScript_Memorial','background');
  if(!(t.money>=350))return context.planner?.selectIncomePreparation(o)??stop('Lemonade costs ₽350 at the Celadon rooftop vending machine.');
  return event('MAP_CELADON_CITY_DEPARTMENT_STORE_ROOF','CeladonCity_DepartmentStore_Roof_EventScript_VendingMachine','background',{choiceByRows:{4:2}});
 }
 if(id==='dunsparce-tunnel')return event('MAP_THREE_ISLAND_DUNSPARCE_TUNNEL','ThreeIsland_DunsparceTunnel_EventScript_Prospector');
 return undefined;
}
