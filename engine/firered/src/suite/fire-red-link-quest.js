// Authored against pret/pokefirered c75f3523 map scripts. Every transition is
// selected from cartridge flags/inventory, never elapsed time or button counts.
import {encounterFingerprint} from '../player/encounter-tracker.js';
import hmLearners from './firered-hm-learners.json' with {type:'json'};
export const SEAGALLOP_WATCH_VARIABLES=Object.freeze([0x4071,0x4076,0x8004,0x8005]);
export const LINK_QUEST_WATCH={flags:[140,142,724,725,726,728,732,733,739,1817,1818,1823,1824,1825,2053,2112,2116,2118,673],variables:[...SEAGALLOP_WATCH_VARIABLES,0x407f,0x4080,0x4088]};
const islandNames=['VERMILION_CITY','ONE_ISLAND','TWO_ISLAND','THREE_ISLAND','FOUR_ISLAND','FIVE_ISLAND','SIX_ISLAND','SEVEN_ISLAND'];
const RUBY_BOULDERS={
 MAP_MT_EMBER_RUBY_PATH_B2F:[{index:0,path:[[9,3],[10,3],[11,3]]},{index:1,path:[[12,5],[13,5]]},{index:2,path:[[12,2],[12,1]]}],
 MAP_MT_EMBER_RUBY_PATH_B3F:[{index:0,path:[[10,4],[11,4],[11,5]]},{index:9,path:Array.from({length:10},(_,i)=>[15-i,13])}],
};
export function fireRedIsland(map){
 if(String(map).startsWith('MAP_MT_EMBER'))return 1;
 if(String(map).startsWith('MAP_TRAINER_TOWER_'))return 7;
 return islandNames.findIndex((n,i)=>i>0&&String(map).startsWith('MAP_'+n))>0?islandNames.findIndex((n,i)=>i>0&&String(map).startsWith('MAP_'+n)):0;
}
// Seagallop landings (src/seagallop.c sSeag at the pinned revision): the first
// field position of any cross-island trip resolveFireRedTravel starts.
export function fireRedFerryArrival(map){
 const island=fireRedIsland(map);
 return island?{map:'MAP_'+islandNames[island]+'_HARBOR',position:{x:8,y:5}}:{map:'MAP_VERMILION_CITY',position:{x:23,y:32}};
}
export function fireRedPokemonCenter(map){const island=fireRedIsland(map);return island?'MAP_'+islandNames[island]+'_POKEMON_CENTER_1F':'MAP_CELADON_CITY_POKEMON_CENTER_1F';}
export function seagallopChoiceIndex({origin,page=0,destination,rainbow=false,kantoUnlocked=true}){
 if(!Number.isInteger(origin)||!Number.isInteger(destination)||destination===origin||destination<0||destination>7)return null;
 if(!rainbow){const choices=[...(kantoUnlocked?[0]:[]),1,2,3].filter(i=>i!==origin);const index=choices.indexOf(destination);return index<0?null:index;}
 const choices=(page===1?(origin<5?[5,6,7]:[4,5,6,7]):[0,1,2,3,4]).filter(i=>i!==origin).slice(0,page===1?3:4);
 const index=choices.indexOf(destination);return index<0?choices.length:index;
}
export function selectFireRedLinkQuest(o,state={},teamPlan=null){
 const m=o.playerMemory??{},f=m.storyState?.flagIds??{},v=m.storyState?.variableIds??{},party=m.trainer?.party??[];
 // The cartridge's offscreen object templates retain their original positions.
 // Remember observed passage completion only for this visit to the floor.
 if(m.map?.id&&state.map!==m.map.id){state.map=m.map.id;state.completedBoulders=[];state.iceSlide=0;}
 state.completedBoulders??=[];
 const item=id=>Object.values(m.trainer?.bag??{}).flat().some(i=>i.itemId===id&&i.quantity>0);
 const knows=id=>party.some(p=>p.moves?.includes(id));
 const withdrawMove=(moveId)=>{
  if(knows(moveId))return null;
  const member=m.trainer?.storage?.validity==='valid'&&m.trainer.storage.pokemon?.find(p=>p.validity==='valid'&&!p.isEgg&&p.moves?.includes(moveId));
  if(!member)return null;
  const center=fireRedPokemonCenter(m.map?.id);
  return {id:`sevii-withdraw-hm-${moveId}`,target:{kind:'party-roster',map:center,minimumPartySize:2,maximumPartySize:6,requiredFingerprints:[encounterFingerprint(member)],requiredFamilies:party.filter(p=>p.moves?.some(id=>[19,57,70,127].includes(id))).map(p=>[p.species])},dialogue:'advance',deferOptionalDetours:true};
 };
 const objective=(id,map,script,kind='object')=>({id:`sevii-${id}`,target:{kind,map,...(kind==='trigger'?{equivalentTriggers:true}:{})},script,dialogue:'advance',choice:'yes',deferOptionalDetours:true});
 const reachMap=map=>({id:`sevii-return-${map}`,target:{kind:'map',map},dialogue:'advance',choice:'yes',deferOptionalDetours:true});
 const celio=()=>objective('celio','MAP_ONE_ISLAND_POKEMON_CENTER_1F','OneIsland_PokemonCenter_1F_EventScript_Celio');
 if(f[2116]===true)return null;
 if(f[2112]!==true)return {id:'sevii-national-dex-required',target:{kind:'stop-for-review',reason:'Unlock the National Pokédex before Celio’s link quest.'}};
 if(f[733]===true&&Number(v[0x4076])<5&&m.map?.id?.startsWith('MAP_MT_EMBER_RUBY_PATH_')){
  const route=['B5F','B4F','B3F','B1F_STAIRS','B2F_STAIRS','1F'].map(n=>'MAP_MT_EMBER_RUBY_PATH_'+n),index=route.indexOf(m.map.id);
  if(m.map.id==='MAP_MT_EMBER_RUBY_PATH_B3F')for(const boulder of [{index:9,path:[[15,13],[16,13],[17,13],[18,13]]},{index:2,path:[[28,8],[29,8]]},{index:1,path:[[26,12],[25,12]]}]){
   if(state.completedBoulders.includes(boulder.index))continue;
   const position=(m.objectEvents??[]).find(e=>!e.player&&e.localId===boulder.index+1)?.current??(m.objectEventTemplates??[]).find(e=>e.localId===boulder.index+1)?.current;
   const [x,y]=boulder.path.at(-1);
   if(position?.x===x&&position?.y===y)state.completedBoulders.push(boulder.index);
   else return {id:`sevii-ruby-return-boulder-${boulder.index}`,target:{kind:'push-boulder',map:m.map.id,objectIndex:boulder.index,x,y},authoredBoulderPath:boulder.path.map(([x,y])=>({x,y})),dialogue:'advance',choice:'yes',deferOptionalDetours:true};
  }
  if(index>=0)return reachMap(route[index+1]??'MAP_MT_EMBER_EXTERIOR');
 }
 // Celio's Sapphire receipt hides Lorelei in her house permanently. Finish
 // her post-Warehouse conversation before handing the Sapphire over.
 if(f[732]===true&&f[724]===false&&f[140]!==true)return objective('lorelei-visit','MAP_FOUR_ISLAND_LORELEIS_HOUSE','FourIsland_LoreleisHouse_EventScript_Lorelei');
 if(f[732]===true||f[733]===true&&Number(v[0x4076])<5||Number(v[0x4076])<4)return celio();
 if(!f[733]){
  if(Number(v[0x407f])<2)return objective('hear-password','MAP_MT_EMBER_EXTERIOR','MtEmber_Exterior_EventScript_RocketPasswordScene','trigger');
  if(!f[1817])return objective('ember-grunt-one','MAP_MT_EMBER_EXTERIOR','MtEmber_Exterior_EventScript_Grunt1');
  if(!f[1818])return objective('ember-grunt-two','MAP_MT_EMBER_EXTERIOR','MtEmber_Exterior_EventScript_Grunt2');
  for(const boulder of RUBY_BOULDERS[m.map?.id]??[]){
   if(state.completedBoulders.includes(boulder.index))continue;
   const position=(m.objectEvents??[]).find(e=>!e.player&&e.localId===boulder.index+1)?.current??(m.objectEventTemplates??[]).find(e=>e.localId===boulder.index+1)?.current;
   const [x,y]=boulder.path.at(-1);
   if(position?.x===x&&position?.y===y){state.completedBoulders.push(boulder.index);continue;}
   if(!position)return {id:'sevii-read-ruby-boulder',target:{kind:'stop-for-review',reason:'The Ruby path boulder position is unavailable.'}};
   return {id:`sevii-ruby-boulder-${m.map.id}-${boulder.index}`,target:{kind:'push-boulder',map:m.map.id,objectIndex:boulder.index,x,y},authoredBoulderPath:boulder.path.map(([x,y])=>({x,y})),dialogue:'advance',choice:'yes',deferOptionalDetours:true};
  }
  const descent=['EXTERIOR','RUBY_PATH_1F','RUBY_PATH_B1F','RUBY_PATH_B2F','RUBY_PATH_B3F','RUBY_PATH_B4F','RUBY_PATH_B5F'].map(n=>'MAP_MT_EMBER_'+n),floor=descent.indexOf(m.map?.id);
  if(floor>=0&&floor<descent.length-1)return {id:`sevii-ruby-descend-${floor}`,target:{kind:'map',map:descent[floor+1]},dialogue:'advance',choice:'yes',deferOptionalDetours:true};
  return objective('ruby','MAP_MT_EMBER_RUBY_PATH_B5F','MtEmber_RubyPath_B5F_EventScript_Ruby');
 }
 if(!f[142]){
  const existing=withdrawMove(127);if(existing)return existing;
  if(!item(345)&&!knows(127)){
   const map=m.map?.id,p=m.position??{};
   const walk=(x,y)=>({id:`sevii-ice-${x}-${y}`,target:{kind:'walk-to',map,x,y},dialogue:'advance',deferOptionalDetours:true});
   const warp=index=>({id:`sevii-ice-ladder-${index}`,target:{kind:'warp',map,index},dialogue:'advance',deferOptionalDetours:true});
   if(map==='MAP_FOUR_ISLAND_ICEFALL_CAVE_1F'&&!(p.x>=11&&p.y>=15)){
    const [x,y,adjacentX]=p.x>=12?[16,9,17]:[8,3,7];
    return p.x===x&&p.y===y?walk(adjacentX,y):walk(x,y);
   }
   if(map==='MAP_FOUR_ISLAND_ICEFALL_CAVE_B1F'){
    if(p.x<14)return warp(p.y<=4?1:0);
    const landings=[[16,6],[19,6],[19,13],[17,13],[17,14]];
    while(state.iceSlide<landings.length&&p.x===landings[state.iceSlide][0]&&p.y===landings[state.iceSlide][1])state.iceSlide++;
    return state.iceSlide<landings.length?walk(...landings[state.iceSlide]):warp(2);
   }
   return objective('waterfall-hm','MAP_FOUR_ISLAND_ICEFALL_CAVE_1F','FourIsland_IcefallCave_1F_EventScript_ItemHM07');
  }
  if(!knows(127)){
   state.protectedSpecies??=teamPlan?[...(teamPlan.starterFamily??[]),...(teamPlan.permanentFamilies??[]).flat(),...(teamPlan.acquisitions??[]).filter(a=>a.permanentRoster!==false).flatMap(a=>a.family??[])]:party.map(p=>p.species);
   const eligible=p=>p.validity==='valid'&&!p.isEgg&&!p.shiny&&!state.protectedSpecies.includes(p.species)&&hmLearners.learners.HM07_WATERFALL.includes(p.species);
   const inParty=party.find(eligible),stored=m.trainer?.storage?.validity==='valid'?m.trainer.storage.pokemon?.find(eligible):null;
   const donor=inParty??stored;
   if(!donor)return {id:'sevii-waterfall-utility-required',target:{kind:'stop-for-review',reason:'Waterfall needs an ordinary compatible utility Pokémon. Main team members and shinies are protected.'}};
   state.utilitySpecies=[...new Set([...(state.utilitySpecies??[]),donor.species])];
   if(!inParty)return {id:'sevii-withdraw-waterfall-utility',target:{kind:'party-roster',map:fireRedPokemonCenter(m.map?.id),minimumPartySize:2,maximumPartySize:6,requiredFingerprints:[encounterFingerprint(donor)],requiredFamilies:party.filter(p=>p.moves?.some(id=>[19,57,70,15].includes(id))).map(p=>[p.species])},dialogue:'advance',deferOptionalDetours:true};
   return {id:'sevii-teach-waterfall',target:{kind:'teach-move',map:m.map.id,itemId:345,moveId:127,partySpecies:[donor.species]},dialogue:'advance',deferOptionalDetours:true};
  }
  const map=m.map?.id,y=m.position?.y;
  // Withdrawing or teaching a carrier can finish anywhere. Reach the base of
  // the waterfall before targeting Lorelei's disconnected upper chamber.
  const aboveWaterfall=map==='MAP_FOUR_ISLAND_ICEFALL_CAVE_BACK'||
   map==='MAP_FOUR_ISLAND_ICEFALL_CAVE_ENTRANCE'&&y<14||
   map==='MAP_FOUR_ISLAND_ICEFALL_CAVE_1F'&&y<9;
  if(!aboveWaterfall)return {id:'sevii-climb-waterfall',target:{kind:'field-move-at',map:'MAP_FOUR_ISLAND_ICEFALL_CAVE_ENTRANCE',x:17,y:21,direction:'north',moveId:127,move:'waterfall'},dialogue:'advance',choice:'yes',deferOptionalDetours:true};
  return objective('lorelei','MAP_FOUR_ISLAND_ICEFALL_CAVE_BACK','FourIsland_IcefallCave_Back_EventScript_LoreleiRocketsScene','trigger');
 }
 if(!f[739])return withdrawMove(15)??{id:'sevii-cut-braille-door',target:{kind:'field-move-at',map:'MAP_SIX_ISLAND_RUIN_VALLEY',x:24,y:25,direction:'north',moveId:15,move:'cut'},dialogue:'advance',choice:'yes',deferOptionalDetours:true};
 if(!f[728])return objective('sapphire-theft','MAP_SIX_ISLAND_DOTTED_HOLE_SAPPHIRE_ROOM','SixIsland_DottedHole_SapphireRoom_EventScript_Sapphire');
 if(!f[726])return objective('warehouse-password','MAP_FIVE_ISLAND_MEADOW','FiveIsland_Meadow_EventScript_WarehouseDoor','background');
 if(!f[725])return objective(f[1823]?'warehouse-admin-two':'warehouse-admin-one','MAP_FIVE_ISLAND_ROCKET_WAREHOUSE',f[1823]?'FiveIsland_RocketWarehouse_EventScript_Admin2':'FiveIsland_RocketWarehouse_EventScript_Admin1');
 return objective('recover-sapphire','MAP_FIVE_ISLAND_ROCKET_WAREHOUSE','FiveIsland_RocketWarehouse_EventScript_Gideon');
}

export function resolveFireRedLinkQuest(world,o,state={},teamPlan=null){
 const selected=selectFireRedLinkQuest(o,state,teamPlan);if(!selected)return null;
 selected.identityEvolution=true;
 const maps=(world.data??world).maps,map=maps.find(m=>m.id===selected.target.map);
 if(selected.script){const events=selected.target.kind==='trigger'?map?.coordEvents:selected.target.kind==='background'?map?.backgroundEvents:map?.objectEvents;const index=events?.findIndex(e=>e.script===selected.script)??-1;if(index<0)throw Error(`The pinned world has no ${selected.script}.`);selected.target.index=index;}
 return resolveFireRedTravel(selected,o,world);
}

// Hunting and supply tasks use the same native ferry service as Celio's quest.
export function resolveFireRedTravel(selected,o,world=null){
 if(!selected?.target?.map||selected.target.kind==='seagallop-destination')return selected;
 const destination=fireRedIsland(selected.target.map),origin=fireRedIsland(o.playerMemory?.map?.id);
 if(destination!==origin){
  const harborTown='MAP_'+islandNames[origin],current=o.playerMemory?.map?.id;
  // Three Island reaches its harbor through a separate Port map. Read every
  // harbor's entrance from the cartridge so crossing it cannot send the bot
  // back to the town it just left.
  const harbor=(world?.data??world)?.maps?.find(m=>m.id===harborTown+'_HARBOR');
  const approaches=new Set([harborTown,harborTown+'_HARBOR',...(harbor?.warpEvents??[]).map(w=>w.dest_map)]);
  if(!approaches.has(current))return {id:`sevii-reach-harbor-${origin}`,target:{kind:'map',map:harborTown},dialogue:'advance',deferOptionalDetours:true,identityEvolution:true};
  return {id:`sevii-sail-${destination}`,target:{kind:'seagallop-destination',map:'MAP_'+islandNames[destination]},dialogue:'advance',choice:'yes',deferOptionalDetours:true,identityEvolution:true};
 }
 return selected;
}

export function saveFireRedLinkUnlock(o,state){return saveFireRedQuestMilestone(o,state,{flagId:2116,id:'sevii-save-link-unlock',label:'Celio’s completed link quest'});}

export function saveFireRedQuestMilestone(o,state,{flagId,variableId,minimumValue,id,label}){
 const m=o.playerMemory??{},ui=m.ui??{};
 const free=o.phase==='stable'&&o.emulator?.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(ui).some(Boolean);
 const policy=target=>({kind:'policy',objective:{id,target:{map:m.map.id,...target},dialogue:'advance',choice:'yes',identityEvolution:true,deferOptionalDetours:true}});
 const achieved=Number.isInteger(variableId)&&Number.isInteger(minimumValue)?m.storyState?.variableIds?.[variableId]>=minimumValue:m.storyState?.flagIds?.[flagId]===true;
 if(!achieved)return {kind:'stop',reason:`${label} is not verified.`};
 if(state.nativeLinkSave)return {kind:'ready',receipt:state.nativeLinkSave};
 if(!state.linkSave){
  if(!free)return policy({kind:'map'});
  if(!Number.isSafeInteger(m.gameStats?.savedGame)||!o.sram?.sha256)return {kind:'stop',reason:'The link preparation save baseline is unavailable.'};
  state.linkSave={counter:m.gameStats.savedGame,sha256:o.sram.sha256};
 }
 if(['error','saving-error'].includes(ui.saveDialog?.stage))return {kind:'stop',reason:'The link preparation native save did not verify.'};
 if(m.gameStats?.savedGame>state.linkSave.counter+1){
  // Older checkpoints could have two save owners. Do not accept the extra
  // saves as proof: require one fresh, fully observed native transaction.
  if(!free||m.saveAttemptStatus!==1||!o.sram?.sha256||o.sram.sha256===state.linkSave.sha256||state.linkSave.restarted)
   return {kind:'stop',reason:'The link preparation native save did not verify.'};
  state.linkSave={counter:m.gameStats.savedGame,sha256:o.sram.sha256,restarted:true};
 }
 const verified=m.saveAttemptStatus===1&&m.gameStats?.savedGame===state.linkSave.counter+1&&o.sram?.sha256!==state.linkSave.sha256;
 if(!verified||!free)return policy({kind:'save-game',saveVerified:verified});
 state.nativeLinkSave={nativeSaveVerified:true,savedSramSha256:o.sram.sha256,savedFrame:o.frame};
 return {kind:'ready',receipt:state.nativeLinkSave};
}

export function fieldMoveAtRecommendation(o,objective){
 const t=objective?.target,m=o.playerMemory??{},ui=m.ui??{};
 if(t?.kind!=='field-move-at'||m.map?.id!==t.map||m.position?.x!==t.x||m.position?.y!==t.y)return null;
 const member=m.trainer?.party?.find(p=>p.moves?.includes(t.moveId));
 if(!member)return {kind:'stop-for-review',reason:`The party needs ${t.move} for this route.`};
 if(ui.choiceMenu)return {kind:'choose-menu-option',targetOption:'yes'};
 if(ui.party?.stage==='selection-menu'){
  if(ui.party.selectedPartySlot!==member.slot)return {kind:'close-menu'};
  const index=ui.party.actions?.indexOf(t.move)??-1;
  return index>=0?{kind:'choose-party-action',targetAction:t.move,targetIndex:index}:{kind:'stop-for-review',reason:`The native ${t.move} action is unavailable here.`};
 }
 if(ui.party?.stage==='choose-pokemon')return {kind:'choose-party-member',targetPartySlot:member.slot,targetSpecies:member.species};
 if(ui.startMenu){const index=ui.startMenu.order?.indexOf('pokemon')??-1;return index>=0?{kind:'choose-start-menu-item',targetItem:'pokemon',targetIndex:index}:null;}
 if(ui.bag)return {kind:'close-menu'};
 if(o.emulator?.mode==='overworld'&&!ui.fieldDialog){
  if(m.avatar?.facing!==t.direction)return {kind:'face-direction',direction:t.direction};
  return {kind:'open-start-menu'};
 }
 return null;
}
