// Extra saves: species the main FireRed save can only get from ANOTHER FireRed
// save, because of a one-per-save choice (starter, Mt. Moon fossil, Dojo prize,
// and the roaming dog, which follows the starter). This module is pure: it
// describes saves, finds what the main save lacks and plans where each family
// comes from. Existing saves are reused first (a verified link-trade loan or
// registration round trip); only when no owned save can supply a family does
// the plan call for bounded helper work or a new helper FireRed save.
// Nothing here reads or writes game memory; inventories come from ordinary
// observations of each save.
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
import evolutionRules from './fire-red-evolution-rules.json' with {type:'json'};

// Story flags and VAR_STARTER_MON (0 Bulbasaur, 1 Squirtle, 2 Charmander; pret
// field_specials.c GetStarterSpeciesById falls back to Bulbasaur).
export const EXTRA_SAVE_WATCH=Object.freeze({flags:Object.freeze([2089,2092,2112,2116,562,626,627,632,748,749]),variables:Object.freeze([0x4031])});
const STARTER_BY_VARIABLE=['bulbasaur','squirtle','charmander'];
export const STARTERS=Object.freeze({
 bulbasaur:Object.freeze({species:1,family:Object.freeze([1,2,3]),roamer:244,label:'Bulbasaur'}),
 squirtle:Object.freeze({species:7,family:Object.freeze([7,8,9]),roamer:243,label:'Squirtle'}),
 charmander:Object.freeze({species:4,family:Object.freeze([4,5,6]),roamer:245,label:'Charmander'}),
});
// FLAG_GOT_*_FOSSIL, the revived-gift flags, the Mt. Moon B2F object index and
// the Cinnabar Lab's fossil number (gift-mission.js).
export const FOSSILS=Object.freeze({
 helix:Object.freeze({species:138,family:Object.freeze([138,139]),flag:627,revivedFlag:749,objectIndex:1,labFossil:1,label:'Helix Fossil'}),
 dome:Object.freeze({species:140,family:Object.freeze([140,141]),flag:626,revivedFlag:748,objectIndex:0,labFossil:2,label:'Dome Fossil'}),
});
export const LEGENDARY=new Set([144,145,146,150,243,244,245,249,250,377,378,379,380,381,382,383,384]);
export const MYTHICAL=new Set([151,251,385,386]);
const HM_MOVES=new Set([15,19,57,70,127,148,249,291]);
const TRADE_EVOLVERS=new Set(evolutionRules.rules.filter(r=>r.trigger==='trade').map(r=>r.fromSpecies));
const NAMES={1:'Bulbasaur',4:'Charmander',6:'Charizard',7:'Squirtle',9:'Blastoise',106:'Hitmonlee',107:'Hitmonchan',132:'Ditto',138:'Omanyte',140:'Kabuto',236:'Tyrogue',237:'Hitmontop',243:'Raikou',244:'Entei',245:'Suicune'};
const speciesName=id=>NAMES[id]??`#${id}`;

const need=(id,label,family,options)=>Object.freeze({id,label,family:Object.freeze(family),...options});
export const EXTRA_SAVE_NEEDS=Object.freeze([
 need('starter-bulbasaur','Bulbasaur line',[1,2,3],{parents:[1,2,3],breed:1,stage:'starter',goal:{kind:'starter',starter:'bulbasaur'},settings:{starter:'bulbasaur'}}),
 need('starter-charmander','Charmander line',[4,5,6],{parents:[4,5,6],breed:4,stage:'starter',goal:{kind:'starter',starter:'charmander'},settings:{starter:'charmander'}}),
 need('starter-squirtle','Squirtle line',[7,8,9],{parents:[7,8,9],breed:7,stage:'starter',goal:{kind:'starter',starter:'squirtle'},settings:{starter:'squirtle'}}),
 need('fossil-helix','Omanyte line',[138,139],{parents:[138,139],breed:138,stage:'fossil',goal:{kind:'fossil',fossil:'helix'},settings:{fossil:'helix'}}),
 need('fossil-dome','Kabuto line',[140,141],{parents:[140,141],breed:140,stage:'fossil',goal:{kind:'fossil',fossil:'dome'},settings:{fossil:'dome'}}),
 // Any Hitmon breeds Tyrogue with Ditto; Tyrogue's level-20 branch (Atk vs
 // Def) then gives each of the three. Tyrogue itself cannot breed.
 need('hitmon','Hitmonlee, Hitmonchan, Tyrogue and Hitmontop',[106,107,236,237],{parents:[106,107,237],breed:236,stage:'dojo',goal:{kind:'dojo-prize',prize:'either'},settings:{}}),
 need('roamer-raikou','Raikou',[243],{legendary:true,stage:'roamer',goal:{kind:'roamer',species:243},settings:{starter:'squirtle'}}),
 need('roamer-entei','Entei',[244],{legendary:true,stage:'roamer',goal:{kind:'roamer',species:244},settings:{starter:'bulbasaur'}}),
 need('roamer-suicune','Suicune',[245],{legendary:true,stage:'roamer',goal:{kind:'roamer',species:245},settings:{starter:'charmander'}}),
]);
const STAGE_ORDER={starter:0,fossil:1,dojo:2,roamer:3};

export function centerWithLink(map,world){
 const floor=/^MAP_[A-Z0-9_]+_POKEMON_CENTER_(1F|2F)$/.exec(map??'');
 return Boolean(floor&&(world?.data??world)?.maps?.find(x=>x.id===map.replace(/_1F$/,'_2F'))?.objectEvents?.some(e=>e.script==='Common_EventScript_DirectCornerAttendant'));
}
const identified=p=>p?.validity==='valid'&&Number.isInteger(p.personality)&&Number.isInteger(p.otId)&&Boolean(encounterFingerprint(p));
const row=(p,where)=>({fingerprint:encounterFingerprint(p),species:nationalSpeciesId(p.species),level:p.level??null,shiny:p.shiny===true,isEgg:p.isEgg===true,heldItem:p.heldItem??null,
 moves:(p.moves??[]).map(m=>typeof m==='number'?m:m?.id).filter(Number.isInteger),where,identified:identified(p)});

// One save's holdings and choices, from an ordinary observation of that save
// (a live owner, or a cold boot of an archived profile's native save).
export function describeSaveInventory({observation:o,roamer=null,source,world}){
 const m=o?.playerMemory??{},t=m.trainer??{},f=m.storyState?.flagIds??{},v=m.storyState?.variableIds??{};
 const valid=t.partyValidity==='valid'&&t.storage?.validity==='valid'&&Array.isArray(t.party)&&Array.isArray(t.storage?.pokemon);
 const starterVariable=v[0x4031];
 const starter=Number.isInteger(starterVariable)?STARTER_BY_VARIABLE[starterVariable]??'bulbasaur':null;
 const fossil=f[626]===true?'dome':f[627]===true?'helix':f[562]===false?null:f[562]===true?'unknown':null;
 const roamerSpecies=Number.isInteger(roamer?.species)?roamer.species:null;
 const kind=source?.kind??'profile';
 return {schema:'pokemon-suite/extra-save-inventory/v1',
  source:{kind,owner:source?.owner??null,profileId:source?.profileId??null,label:source?.label??source?.owner??'FireRed save',saved:source?.saved!==false,
   ...(Array.isArray(source?.grants)?{grants:[...source.grants]}:{})},
  lineage:Number.isInteger(t.otId)?String(t.otId>>>0):null,trainerId:Number.isInteger(t.trainerId)?t.trainerId:null,
  map:m.map?.id??null,parked:Boolean(source?.saved!==false&&centerWithLink(m.map?.id,world)),savedGame:m.gameStats?.savedGame??null,
  starter,valid,
  flags:{pokedex:f[2089]===true||f[2092]===true,gameClear:f[2092]===true,nationalDex:f[2112]===true,sevii:f[2116]===true},
  choices:{starter,fossil,fossilRevived:fossil==='dome'?f[748]===true:fossil==='helix'?f[749]===true:null,dojoPrizeTaken:f[632]===true,
   roamer:{species:roamerSpecies,active:roamer?.active===true,used:Boolean(roamerSpecies&&roamer?.active!==true)}},
  pokedexOwned:[...(t.pokedex?.ownedSpecies??[])],
  pokemon:valid?[...t.party.map(p=>row(p,'party')),...t.storage.pokemon.map(p=>row(p,'pc'))]:[]};
}

// A lent individual goes to the main save and comes back. It must be ordinary:
// identified, never shiny, no Egg, no held item, no mythical, and no trade
// evolution (it would come back as another species). A legendary is only ever
// registered and returned, never kept or deposited at the Day Care.
export function eligibleLoanSubject(p,{mode='loan'}={}){
 const species=p?.species>0&&p.fingerprint!==undefined?p.species:nationalSpeciesId(p?.species);
 const known=p?.identified??identified(p);
 return Boolean(known&&p.shiny===false&&p.isEgg===false&&p.heldItem===0&&Number.isInteger(species)&&!MYTHICAL.has(species)&&
  (!LEGENDARY.has(species)||mode==='register')&&!TRADE_EVOLVERS.has(species));
}

const heldBy=(inventory,species)=>inventory.pokemon.filter(p=>!p.isEgg&&species.includes(p.species));
const mainDitto=main=>main.pokemon.find(p=>p.species===132&&p.identified&&!p.shiny&&!p.isEgg)??null;

// Families the main save neither owns completely nor can finish from an
// individual it already holds (its own breeding and evolution handle those),
// nor from its own unused choice (its roaming dog, the fossil it took, its
// Dojo prize: the postgame checklist does those locally).
const ownChoice=(main,n)=>n.stage==='roamer'?STARTERS[main.starter]?.roamer===n.goal.species&&main.choices?.roamer?.used!==true:
 n.stage==='fossil'?main.choices?.fossil===n.goal.fossil&&main.choices.fossilRevived===false:
 n.stage==='dojo'?main.flags?.gameClear===true&&main.choices?.dojoPrizeTaken===false:false;
export function extraSaveNeeds(main){
 const owned=new Set(main.pokedexOwned??[]);
 return EXTRA_SAVE_NEEDS.flatMap(n=>{
  const missing=n.family.filter(id=>!owned.has(id));
  if(!missing.length||ownChoice(main,n))return [];
  const local=n.legendary?[]:heldBy(main,n.parents??n.family).filter(p=>p.identified);
  return local.length?[]:[{...n,missing}];
 });
}

const cost=inventory=>inventory.source.kind==='profile'?(inventory.parked?1:2):inventory.parked?0:2;
// A partner owner seeded from any owned FireRed save. Its archive stays
// immutable; one working copy per save lineage, so no save is ever copied twice.
function usableSources(main,sources){
 const live=new Set(sources.filter(s=>s.source.kind!=='profile'&&s.lineage).map(s=>s.lineage));
 const byLineage=new Map();
 for(const s of sources){
  if(!s?.valid||!s.lineage||s.lineage===main.lineage)continue;
  if(s.source.kind==='profile'&&(live.has(s.lineage)||s.source.saved!==true))continue;
  const previous=byLineage.get(s.lineage);
  if(!previous||s.source.kind!=='profile'&&previous.source.kind==='profile'||s.source.kind===previous.source.kind&&(s.savedGame??-1)>(previous.savedGame??-1))byLineage.set(s.lineage,s);
 }
 return [...byLineage.values()];
}
// What an existing save could still give without a new save.
function servesDirectly(s,n,main){
 const granted=new Set(s.source.grants??[]);
 const mode=n.legendary?'register':'loan';
 return heldBy(s,n.parents??n.family).filter(p=>eligibleLoanSubject(p,{mode})||granted.has(p.fingerprint)&&eligibleLoanSubject(p,{mode:'register'}));
}
function unusedChoice(s,n,main=null){
 if(n.stage==='dojo'){
  if(!s.flags.gameClear||s.choices.dojoPrizeTaken)return null;
  // The prize the main save has not registered (Hitmonlee when it has neither).
  const owned=new Set(main?.pokedexOwned??[]);
  return {kind:'dojo-prize',prize:'either',speciesId:owned.has(106)&&!owned.has(107)?107:106};
 }
 if(n.stage==='roamer'&&STARTERS[s.starter]?.roamer===n.goal.species&&!s.choices.roamer.used)return {kind:'roamer-capture',species:n.goal.species,initialized:s.choices.roamer.active};
 return null;
}
const sourceRef=s=>({kind:s.source.kind,owner:s.source.owner,profileId:s.source.profileId,label:s.source.label,lineage:s.lineage,trainerId:s.trainerId,
 ...(s.source.helperOwner?{helperOwner:s.source.helperOwner}:{})});
function prepFor(s,subject){
 const prep=[];
 if(s.source.kind==='profile')prep.push({kind:'seed-partner-owner',profileId:s.source.profileId});
 if(!s.parked||subject&&subject.where!=='party')prep.push({kind:'park',reason:!s.parked?'Save in a Pokémon Center with a Direct Corner.':'Withdraw the lent Pokémon into the party.'});
 return prep;
}
const statusOf=prep=>prep.some(p=>p.kind==='seed-partner-owner')?'needs-partner-owner':prep.some(p=>p.kind==='park')?'needs-park':'ready';

export function planExtraSaves({main,sources=[]}){
 const needs=extraSaveNeeds(main),usable=usableSources(main,sources),ditto=mainDitto(main);
 // A source that can serve more of the needs is preferred when costs tie, so
 // one seeded save serves several families.
 const coverage=new Map(usable.map(s=>[s,needs.filter(n=>servesDirectly(s,n,main).length||unusedChoice(s,n,main)).length]));
 const chosen=new Set();
 const rank=list=>[...list].sort((a,b)=>cost(a)-cost(b)||(chosen.has(b.lineage)?1:0)-(chosen.has(a.lineage)?1:0)||coverage.get(b)-coverage.get(a)||String(a.source.label).localeCompare(String(b.source.label)));
 const routes=[],newSaveNeeds=[];
 for(const n of needs){
  const holders=rank(usable.filter(s=>servesDirectly(s,n,main).length));
  if(holders.length){
   const s=holders[0],granted=new Set(s.source.grants??[]);chosen.add(s.lineage);
   const subject=[...servesDirectly(s,n,main)].sort((a,b)=>(a.where==='party'?0:1)-(b.where==='party'?0:1)||(b.level??0)-(a.level??0))[0];
   // A helper-obtained legendary is registered and returned like any legendary.
   const keep=granted.has(subject.fingerprint)&&!n.legendary;
   const mode=keep?'keep':n.legendary?'register':ditto&&n.breed?'loan':'register';
   const prep=prepFor(s,subject);
   routes.push({needId:n.id,label:n.label,missing:n.missing,mode,source:sourceRef(s),
    subject:{fingerprint:subject.fingerprint,species:subject.species,level:subject.level,where:subject.where},
    ...(mode==='loan'?{breed:{speciesId:n.breed,dittoFingerprint:ditto.fingerprint}}:{}),
    delivers:mode==='register'?[subject.species]:[...n.family],returns:mode!=='keep',prep,status:statusOf(prep),runtime:'short',
    reason:mode==='loan'?`Borrow ${speciesName(subject.species)} from ${s.source.label}, breed a ${speciesName(n.breed)} Egg with the main save's Ditto at the Four Island Day Care, then return it.`:
     mode==='keep'?`${s.source.label} obtained ${speciesName(subject.species)} for the main save; trade it for an ordinary duplicate.`:
     `Register ${speciesName(subject.species)} by trade and return it.${n.breed&&!ditto?' The main save holds no Ditto for a Day Care Egg.':''}`});
   continue;
  }
  // build 126: a helper task runs in an archived save's helper owner before that
  // save becomes a partner (one working copy per lineage), so only archived
  // profiles take tasks. A long roaming-dog task prefers a save no short route
  // waits on, so a loan from the same save is not held up for hours.
  const candidates=usable.filter(s=>unusedChoice(s,n,main)&&s.source.kind==='profile');
  const choice=(n.stage==='roamer'?[...candidates].sort((a,b)=>cost(a)-cost(b)||(chosen.has(a.lineage)?1:0)-(chosen.has(b.lineage)?1:0)||String(a.source.label).localeCompare(String(b.source.label))):rank(candidates))[0];
  if(choice){chosen.add(choice.lineage);
   const task=unusedChoice(choice,n,main),prep=prepFor(choice,null);
   const long=task.kind==='roamer-capture';
   prep.splice(prep.findIndex(p=>p.kind==='park')>=0?prep.findIndex(p=>p.kind==='park'):prep.length,0,{kind:'helper-task',task:task.kind});
   routes.push({needId:n.id,label:n.label,missing:n.missing,mode:'keep',source:sourceRef(choice),
    helper:{kind:task.kind,...(task.prize?{prize:task.prize}:{}),...(task.speciesId?{speciesId:task.speciesId}:{}),lineage:choice.lineage,label:choice.source.label},
    delivers:[...n.family],returns:false,prep,status:long?'planned-long':'needs-helper-task',runtime:long?'long':'short',
    reason:task.kind==='dojo-prize'?`${choice.source.label} never took its Fighting Dojo prize: take it, then trade it to the main save for an ordinary duplicate.`:
     `${speciesName(n.goal.species)}: ${choice.source.label} ${choice.flags.nationalDex?'must catch its roaming':'must reach the National Pokédex and link with Celio before it can catch its roaming'} ${speciesName(n.goal.species)}.`});
   continue;
  }
  newSaveNeeds.push(n);
 }
 // New helper saves: one starter per save; a roamer follows its save's
 // starter; a fossil or Dojo stage joins any planned save.
 const helperSaves=[];
 const saveFor=n=>{
  const starter=n.settings.starter;
  let save=starter?helperSaves.find(s=>s.settings.starter===starter)??helperSaves.find(s=>!s.settings.starter):
   n.stage==='fossil'?helperSaves.find(s=>!s.settings.fossil):helperSaves.find(s=>!s.stages.some(x=>x.stage===n.stage));
  if(!save){save={id:`helper-${helperSaves.length+1}`,settings:{},stages:[]};helperSaves.push(save);}
  Object.assign(save.settings,n.settings);return save;
 };
 const ordered=[...newSaveNeeds].sort((a,b)=>(a.settings.starter?0:1)-(b.settings.starter?0:1)||(a.stage==='roamer'?0:1)-(b.stage==='roamer'?0:1));
 for(const n of ordered){
  const save=saveFor(n),long=['roamer','dojo'].includes(n.stage);
  save.stages.push({needId:n.id,stage:n.stage,goal:structuredClone(n.goal),runtime:long?'long':'medium'});
  const alternatives=n.stage==='roamer'?usable.filter(s=>s.source.kind==='partner-owner'&&unusedChoice(s,n,main)).map(s=>({kind:'roamer-capture',owner:s.source.owner,approval:'owner',
   reason:`The FireRed partner still has ${speciesName(n.goal.species)} roaming, but the partner is never given tasks without your approval.`})):[];
  routes.push({needId:n.id,label:n.label,missing:n.missing,mode:'keep',helper:{kind:'new-save',saveId:save.id},delivers:[...n.family],returns:false,
   prep:[{kind:'helper-save',saveId:save.id}],status:long?'planned-long':'needs-helper-save',runtime:long?'long':'medium',
   ...(alternatives.length?{alternatives}:{}),
   reason:n.stage==='starter'?`No owned save chose ${STARTERS[n.goal.starter].label}: start a helper FireRed save with it and trade it to the main save.`:
    n.stage==='fossil'?`Every owned save took the other Mt. Moon fossil: a helper FireRed save takes the ${FOSSILS[n.goal.fossil].label} and revives it at the Cinnabar Lab.`:
    n.stage==='dojo'?'No owned save can still take a Fighting Dojo prize: a helper save must reach Saffron City (long).':
    `${speciesName(n.goal.species)} roams only in a ${STARTERS[n.settings.starter].label} save after the National Pokédex and Celio's link (long).`});
 }
 for(const save of helperSaves){
  save.settings={...(save.settings.starter?{starter:save.settings.starter}:{}),...(save.settings.fossil?{fossil:save.settings.fossil}:{}),afterCampaign:'wait'};
  save.stages.sort((a,b)=>STAGE_ORDER[a.stage]-STAGE_ORDER[b.stage]);
  save.label=`Helper save ${save.id.split('-')[1]} (${[save.settings.starter&&STARTERS[save.settings.starter].label,save.settings.fossil&&FOSSILS[save.settings.fossil].label].filter(Boolean).join(', ')||'story'})`;
 }
 const order=new Map(EXTRA_SAVE_NEEDS.map((n,i)=>[n.id,i]));
 routes.sort((a,b)=>order.get(a.needId)-order.get(b.needId));
 return {schema:'pokemon-suite/extra-save-plan/v1',mainLineage:main.lineage,routes,helperSaves};
}

const PHASE_TEXT={preparing:'Checking the Day Care, fees, Ditto and an ordinary duplicate to offer.',opening:'Saving the offered duplicate at a Pokémon Center with a Direct Corner.',
 daycare:'Breeding at the Four Island Day Care with the main save\'s Ditto.',closing:'Returning the borrowed Pokémon at a Pokémon Center.',hatching:'Hatching the Egg.',restoring:'Restoring the team and saving.',complete:'Done.'};
// Host and Bank rows: which save supplies each family, what it is doing, and
// an unknown ETA (story, Egg and roaming times are not predictable).
export function presentExtraSavePlan(plan,{active=null,helpers=[]}={}){
 return (plan?.routes??[]).map(r=>{
  const save=r.helper?.kind==='new-save'?plan.helperSaves.find(s=>s.id===r.helper.saveId)?.label??'Helper save':r.source?.label??'Another FireRed save';
  const helper=r.helper?.saveId?helpers.find(h=>h.saveId===r.helper.saveId):null;
  const doing=active?.needId===r.needId?active.reason??PHASE_TEXT[active.phase]??active.phase:
   helper?`Playing the story: ${helper.objective??helper.status??'starting'}`:
   r.source?.helperOwner?`${r.source.label} is being prepared by its helper: its tasks, then a save in a Pokémon Center.`:
   r.status==='ready'?'Ready: waits for the partner game and the main save to be free.':
   r.status==='needs-partner-owner'?`Waiting to set up ${r.source.label} as a trade partner.`:
   r.status==='needs-park'?`${r.source.label} must first save in a Pokémon Center with a Direct Corner.`:
   r.status==='needs-helper-task'?`${r.source.label} must first take its ${r.helper.kind==='dojo-prize'?'Fighting Dojo prize':'task'}.`:
   r.status==='needs-helper-save'?'Waiting for a new helper FireRed save.':'Planned; long-running.';
  const via=r.mode==='loan'?'borrow and return':r.mode==='register'?'register and return':'keep';
  const helperSave=r.helper?.kind==='new-save'?plan.helperSaves.find(s=>s.id===r.helper.saveId):null;
  // build 126: which save serves the row, the individual it lends or hands
  // over, a helper task on an archived save, and the host action that starts it.
  const task=['dojo-prize','roamer-capture'].includes(r.helper?.kind)&&r.source?.kind==='profile'?
   {kind:r.helper.kind,speciesId:r.helper.kind==='dojo-prize'?r.helper.speciesId:r.delivers[0],profileId:r.source.profileId,lineage:r.source.lineage}:null;
  const start=helperSave?{action:'start-helper',saveId:helperSave.id}:task?{action:'start-helper',needId:r.needId}:
   r.source?.kind==='profile'&&['needs-partner-owner','needs-park'].includes(r.status)?{action:'seed-partner',profileId:r.source.profileId}:null;
  return {needId:r.needId,label:r.label,species:r.delivers,route:`${r.label}: ${r.reason}`,save,mode:via,status:r.status,doing,eta:'unknown',runtime:r.runtime,
   ...(r.source?{source:structuredClone(r.source)}:{}),...(r.subject?{subject:structuredClone(r.subject)}:{}),...(task?{task}:{}),...(start?{start}:{}),
   ...(helperSave?{helper:{saveId:helperSave.id,settings:structuredClone(helperSave.settings),goal:structuredClone(helperSave.stages.find(x=>x.needId===r.needId)?.goal??null)}}:{}),
   ...(r.alternatives?{alternatives:r.alternatives}:{})};
 });
}

// The main save's ordinary duplicate offered in its place: never a teammate,
// shiny, Egg, item holder, legendary, HM carrier or trade evolver, always from
// the PC, and only while another of that species stays in the main save. It
// stays within #1–151 so a partner without the National Pokédex can receive it.
export function selectMainPlaceholder({trainer,protectedFingerprints=[]}){
 if(trainer?.partyValidity!=='valid'||trainer.storage?.validity!=='valid')return null;
 const blocked=new Set(protectedFingerprints),all=[...trainer.party,...trainer.storage.pokemon].filter(p=>p?.validity==='valid'&&!p.isEgg);
 const count=species=>all.filter(p=>nationalSpeciesId(p.species)===species).length;
 return trainer.storage.pokemon.filter(p=>{
  const species=nationalSpeciesId(p?.species);
  return identified(p)&&p.shiny===false&&p.isEgg===false&&p.heldItem===0&&Number.isInteger(species)&&species<=151&&!LEGENDARY.has(species)&&!MYTHICAL.has(species)&&
   !TRADE_EVOLVERS.has(species)&&!(p.moves??[]).some(m=>HM_MOVES.has(typeof m==='number'?m:m?.id))&&!blocked.has(encounterFingerprint(p))&&count(species)>=2;
 }).sort((a,b)=>(a.level??0)-(b.level??0)||encounterFingerprint(a).localeCompare(encounterFingerprint(b)))[0]??null;
}
export function selectMainDitto({trainer,protectedFingerprints=[]}){
 if(trainer?.partyValidity!=='valid'||trainer.storage?.validity!=='valid')return null;
 const blocked=new Set(protectedFingerprints);
 return [...trainer.storage.pokemon,...trainer.party].filter(p=>identified(p)&&nationalSpeciesId(p.species)===132&&p.shiny===false&&!p.isEgg&&!blocked.has(encounterFingerprint(p)))
  .sort((a,b)=>(a.heldItem?1:0)-(b.heldItem?1:0))[0]??null;
}
