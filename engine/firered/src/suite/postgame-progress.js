import {nationalSpeciesId,nationalDexNumbers} from '../evidence/gen3-national-species.js';
import {recordComplete} from './postgame-records.js';
import {fameRosterRestorationComplete} from './postgame-collection-extras.js';
import fireRedCatchable from './firered-catchable.json' with {type:'json'};
const FIRERED_GOAL=fireRedCatchable.species.map(x=>x.id);

// HasAllMons in the original cartridge excludes these six entries, including
// Lugia and Ho-Oh. The user's complete collection still requires all 386.
const DIPLOMA_EXCEPTIONS=new Set([151,249,250,251,385,386]);
export const POSTGAME_PROGRESS_WATCH={
 flags:[142,147,497,566,673,679,680,724,725,726,728,730,732,733,738,739,756,1817,1818,2092,2112,2116,2121],
 variables:[0x4076,0x407f,0x4049,0x404a,0x404b],
};
export function missedLoreleiConversation(flags={}){
 return flags[724]===false&&flags[2116]===true?
  'Delivering the Sapphire returned Lorelei to the League; her optional house conversation was missed on this save.':null;
}
// ownedSpecies: the decoded Pokédex owned flags, already National Dex numbers.
export function nationalDexProgress(ownedSpecies) {
 const known=Array.isArray(ownedSpecies),owned=new Set(nationalDexNumbers(ownedSpecies));
 const missing=Array.from({length:386},(_,i)=>i+1).filter(id=>!owned.has(id));
 const diplomaMissing=missing.filter(id=>!DIPLOMA_EXCEPTIONS.has(id));
 return {known,caught:owned.size,total:386,complete:known&&!missing.length,missing,
  kanto:{caught:150-missing.filter(id=>id<=150).length,total:150,complete:known&&!missing.some(id=>id<=150)},
  diploma:{caught:380-diplomaMissing.length,total:380,complete:known&&!diplomaMissing.length,missing:diplomaMissing}};
}

export function postgameProgress(o,agenda={}) {
 // Session telemetry exists before the user or campaign starts an agenda.
 agenda??={};
 const stable=o?.phase==='stable',m=stable?o.playerMemory??{}:{},f=m.storyState?.flagIds??{},v=m.storyState?.variableIds??{};
 const dex=nationalDexProgress(m.trainer?.pokedex?.ownedSpecies),e=m.postgameEvidence??{},stats=m.gameStats??{};
 // The owner's goal: the species FireRed can register by itself. One-per-save
 // choices another FireRed save must supply are planned (agenda.collection rows).
 const rows=Array.isArray(agenda.collection)&&agenda.collection.length===386?agenda.collection:null;
 const fireRed=dex.known?{caught:FIRERED_GOAL.filter(id=>!dex.missing.includes(id)).length,total:FIRERED_GOAL.length,
  planned:rows?rows.filter(r=>r.goal&&r.planned&&r.status!=='complete').length:null,otherGames:rows?rows.filter(r=>r.category==='other-games').length:null}:null;
 if(fireRed)dex.fireRed=fireRed;
 const compare=(value,target)=>Number.isFinite(value)?value>=target:undefined;
 const bool=value=>value===true?'complete':value===false?'pending':'unknown';
 const owned=id=>dex.known?!dex.missing.includes(id):undefined;
 const step=(id,label,detail,completion,value,extra={})=>({id,label,detail,completion,status:bool(value),...extra});
 const external=(id,label,detail,completion,value,dependency)=>step(id,label,detail,completion,value,{...(value===true?{}:{status:'external',dependency})});
 const flag=(id,label,detail,number,extra={})=>step(id,label,detail,'The cartridge records this event as complete.',f[number],extra);
 const chapters=[
  {id:'unlock',label:'National Pokédex and Sevii story',entries:[
   flag('league','Hall of Fame','Complete the first League run and its native save.',2092),
   step('dex-sixty','Register 60 species','Catch or evolve missing species to qualify for Oak’s upgrade.','At least 60 species are registered as caught.',dex.known?dex.caught>=60:undefined),
   flag('national-dex','Receive the National Pokédex','Visit Professor Oak and finish the upgrade conversation.',2112),
   flag('sevii-intro','Complete Bill’s island trip','Resolve Lostelle’s rescue, the Meteorite delivery and the return to Kanto.',673),
   step('ruby-request','Accept Celio’s Ruby request','Speak to Celio on One Island after the National Dex upgrade.','Celio’s quest has reached the Ruby search.',compare(v[0x4076],4)),
   step('ember-password','Hear the first Warehouse password','Approach the Mt. Ember Rockets and complete their scene.','The Mt. Ember password scene has advanced.',compare(v[0x407f],2)),
   flag('ember-grunt-one','Defeat the first Mt. Ember Rocket','Clear the entrance to the Ruby path.',1817),
   flag('ember-grunt-two','Defeat the second Mt. Ember Rocket','Finish clearing the Ruby path entrance.',1818),
   flag('ruby','Recover the Ruby','Solve the Strength route and collect the Ruby.',733),
   step('rainbow-pass','Deliver the Ruby and receive the Rainbow Pass','Return to Celio and unlock travel to Islands Four through Seven.','Celio’s quest has reached the Sapphire search.',compare(v[0x4076],5)),
   flag('waterfall','Collect HM07 Waterfall','Traverse Icefall Cave’s ice and ladder route.',497),
   flag('icefall-rockets','Help Lorelei in Icefall Cave','Use Waterfall to reach the back cave and defeat the Rockets.',142),
   flag('dotted-door','Open Dotted Hole','Use Cut on the braille door in Ruin Valley.',739),
   flag('sapphire-theft','Find the Sapphire and second password','Follow Dotted Hole’s holes and finish the theft scene.',728),
   flag('warehouse-door','Unlock the Rocket Warehouse','Present both passwords at the Five Island entrance.',726),
   flag('warehouse-rockets','Defeat the Warehouse admins','Clear the arrow-floor route and both admins.',725),
   flag('sapphire','Recover the Sapphire from Gideon','Win the scientist battle and finish the reward conversation.',732),
   flag('sevii-link','Restore Celio’s Network Machine','Deliver the Sapphire, finish the conversation and save.',2116),
  ]},
  {id:'islands',label:'Island side quests',entries:[
   flag('tanoby','Solve Tanoby Key','Push all seven boulders onto their native switch tiles.',2121),
   flag('selphy','Rescue Selphy','Follow the Lost Cave route, win her battle and escort her home.',147),
   flag('togepi-egg','Receive the Togepi Egg','Bring a lead Pokémon with friendship 255 and a free party slot to Water Labyrinth.',730),
   step('togepi-hatched','Hatch Togepi','Keep the Egg in the party and take safe in-game steps.','Togepi is registered as caught.',owned(175)),
   flag('memorial-pillar','Complete the Memorial Pillar tribute','Bring Lemonade and receive TM42.',566),
   flag('lorelei-visit','Visit Lorelei at home','Talk to Lorelei after clearing the Rocket Warehouse, before delivering the Sapphire.',724,
    missedLoreleiConversation(f)?{available:false,dependency:missedLoreleiConversation(f)}:{}),
   flag('dunsparce-tunnel','Collect the Three Island tunnel reward','Visit the completed tunnel after becoming Champion.',738),
  ]},
  {id:'collection',label:'Pokémon collection',entries:[
   flag('lapras','Receive Lapras','Collect the Silph Co. gift if it remains available.',582),
   flag('eevee','Receive Eevee','Collect the Celadon rooftop gift if it remains available.',611),
   flag('dojo-gift','Receive a Fighting Dojo Pokémon','Choose the missing Hitmonlee or Hitmonchan; the other needs breeding or a partner.',632),
   flag('old-amber','Collect Old Amber','Visit the scientist through the museum’s Cut entrance.',606),
   step('fossils','Revive this save’s fossils','Revive Old Amber and the fossil selected in Mt. Moon.','Every fossil collected in this save has been revived.',[606,626,627,748,749,750].every(id=>typeof f[id]==='boolean')?f[750]&&(!f[626]||f[748])&&(!f[627]||f[749]):undefined),
   step('snorlax','Acquire Snorlax','Use a remaining Poké Flute encounter or a legitimate family/trade source.','Snorlax is registered as caught.',owned(143)),
   ...[[144,'Articuno'],[145,'Zapdos'],[146,'Moltres'],[150,'Mewtwo']].map(([id,name])=>step(name.toLowerCase(),'Catch '+name,'Use the remaining native encounter and verify the catch and save.','The species is registered as caught.',owned(id))),
   step('roamer','Catch this save’s roaming legendary','Track the native roamer, retain its identity and finish a verified capture.','The roaming species is registered as caught.',e.roamer?.species?owned(nationalSpeciesId(e.roamer.species)):undefined),
   step('firered-catchable','Catch every Pokémon catchable in FireRed',fireRed?`${fireRed.caught} of ${fireRed.total} catchable in FireRed${fireRed.planned?`; ${fireRed.planned} planned through another FireRed save or a partner Pokémon`:''}${fireRed.otherGames!=null?`; ${fireRed.otherGames} more are only in other games or events`:''}.`:'Register every species FireRed itself can obtain.',
    'Every FireRed-catchable species is registered, except one-per-save choices planned through another FireRed save.',fireRed?fireRed.caught+(fireRed.planned??0)>=fireRed.total:undefined),
   step('kanto-dex','Complete the Kanto Pokédex','Acquire all 150 non-event Kanto entries, including starters, fossils and trade evolutions.','All 150 entries required by the cartridge are caught.',dex.known?dex.kanto.complete:undefined),
   step('national-diploma','Qualify for the National Dex diploma','Acquire the 380 entries checked by the original game.','The cartridge’s exact National Dex completion test passes.',dex.known?dex.diploma.complete:undefined),
   step('national-386','Collect all 386 National Dex species','Use native catches, gifts, breeding, evolutions and compatible partner games.','Every National Dex species, including the six diploma exceptions, is registered as caught.',dex.known?dex.complete:undefined),
   step('unown-forms','Collect all 28 Unown forms','Visit the seven Tanoby Chambers and retain each missing letter or symbol.','Current native storage contains all 28 forms.',e.unownForms?new Set(e.unownForms).size===28:undefined),
  ]},
  {id:'battles',label:'League and Trainer Tower',entries:[
   step('league-rematch','Win the stronger League rematch','Prepare the whole team, stock recovery items and finish all five battles.','A postgame League victory and save are verified.',Number.isInteger(stats.leagueEntries)?Boolean(f[2116]&&agenda.workflows?.league?.receipt?.nativeSaveVerified&&stats.leagueEntries>=agenda.workflows.league.receipt.leagueEntries&&stats.savedGame>=agenda.workflows.league.receipt.savedGame):undefined),
   ...['single','double','knockout','mixed'].map((mode,i)=>step('trainer-tower-'+mode,'Trainer Tower: '+mode,'Clear all eight floors, recover between battles and speak to the roof owner.','The cartridge records receipt of this mode’s prize.',e.trainerTower?.[i]?.receivedPrize)),
  ]},
  {id:'records',label:'Records and completion rewards',entries:[
   flag('oak-completion','Show Oak the completed Pokédex','Visit Oak after meeting the native completion requirement.',756),
   step('fame-checker','Complete the Fame Checker','Read all six information entries for each of the 16 people.','All 96 native information flags are set and the original roster is restored and saved.',e.fameChecker?.length===16?e.fameChecker.every(x=>x.entries===63)&&fameRosterRestorationComplete(agenda.workflows):undefined),
   step('hall-sticker','Earn the final Hall of Fame sticker','Complete 200 League entries and claim the sticker on Four Island.','The Hall of Fame sticker is at its maximum native level.',stable?recordComplete('hall-sticker',o,agenda.workflows):undefined),
   step('egg-sticker','Earn the final Egg sticker','Hatch 300 Eggs and claim the sticker on Four Island.','The Egg sticker is at its maximum native level.',stable?recordComplete('egg-sticker',o,agenda.workflows):undefined),
   external('link-sticker','Earn the final Link Battle sticker','Win 100 actual link battles and claim the sticker.','The Link Battle sticker is at its maximum native level.',compare(v[0x404b],4),'A compatible independently owned link-battle partner.'),
   external('wireless-minigames','Complete both wireless minigame records','Reach 200 consecutive Pokémon Jump jumps and 200 Dodrio berries.','Both native minigame records meet 200.',e.minigames?e.minigames.jumps>=200&&e.minigames.berries>=200:undefined,'Pokémon Jump needs at least two players; Dodrio Berry Picking needs at least three.'),
  ]},
  {id:'events',label:'Event and partner dependencies',entries:[
   ...[[249,'Lugia',680],[250,'Ho-Oh',680],[386,'Deoxys',679]].map(([id,name,ticket])=>external('event-'+id,'Acquire '+name,'Use a legitimately accessible event encounter or a compatible native trade.','The species is registered as caught.',owned(id),f[ticket]===true?'Event ticket present; encounter access and its remaining availability must verify.':'A legitimate event ticket or an independently acquired compatible trade source.')),
   ...[[151,'Mew'],[251,'Celebi'],[385,'Jirachi']].map(([id,name])=>external('event-'+id,'Acquire '+name,'Import through a real compatible trade from a legitimate source.','The species is registered as caught.',owned(id),'This species has no normal catch location in the original FireRed ROM.')),
  ]},
 ];
 const entries=chapters.flatMap(c=>c.entries),completed=entries.filter(e=>e.status==='complete').length;
 return {schema:'pokemon-suite/postgame-progress/v1',evidenceFrame:stable?o.frame:null,chapters,dex,species:agenda.collection??[],
  completed,total:entries.length,complete:entries.every(e=>e.status==='complete'),active:agenda.active??null,
  external:entries.filter(e=>e.status==='external').map(e=>({id:e.id,label:e.label,reason:e.dependency}))};
}
