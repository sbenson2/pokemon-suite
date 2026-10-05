import test from 'node:test';
import assert from 'node:assert/strict';
import {nationalDexSources,nationalCollectionSummary} from '../src/suite/national-dex-agenda.js';

// Live September 28 (build 123): the collection listed 96 "local evolutions",
// eight "local" Altering Cave catches and a Wynaut "breeding dependency", yet the
// owner found nothing to do. Each row must say what this save can really do.
const slots=(n,fill,at={})=>Array.from({length:n},(_,i)=>({species:at[i]??fill,min_level:5,max_level:15}));
const cave=(label,species)=>({map:'MAP_SIX_ISLAND_ALTERING_CAVE',base_label:label,land_mons:{encounter_rate:7,mons:slots(12,species)}});
const world={data:{maps:[{id:'MAP_ROUTE1'},{id:'MAP_ROUTE12'},{id:'MAP_FIVE_ISLAND_MEADOW'},{id:'MAP_SIX_ISLAND_ALTERING_CAVE'}],wildEncounters:[
 {map:'MAP_ROUTE1',base_label:'sRoute1_FireRed',land_mons:{encounter_rate:20,mons:slots(12,'SPECIES_RATTATA')}},
 // FireRed fishing tables: slots 0-1 Old Rod, 2-4 Good Rod, 5-9 Super Rod.
 {map:'MAP_ROUTE12',base_label:'sRoute12_FireRed',fishing_mons:{encounter_rate:60,mons:slots(10,'SPECIES_MAGIKARP',{4:'SPECIES_KRABBY'})}},
 {map:'MAP_FIVE_ISLAND_MEADOW',base_label:'sFiveIslandMeadow_FireRed',fishing_mons:{encounter_rate:20,mons:slots(10,'SPECIES_MAGIKARP',{6:'SPECIES_QWILFISH'})}},
 cave('sSixIslandAlteringCave_FireRed','SPECIES_ZUBAT'),cave('sSixIslandAlteringCave_2_FireRed','SPECIES_MAREEP'),cave('sSixIslandAlteringCave_3_FireRed','SPECIES_PINECO'),
]}};
const pct=n=>({call:'PERCENT_FEMALE',args:[n]});
const facts=[[19,'RATTATA',['FIELD'],pct(50)],[41,'ZUBAT',['FLYING'],pct(50)],[129,'MAGIKARP',['WATER_2','DRAGON'],pct(50)],[98,'KRABBY',['WATER_3'],pct(50)],[99,'KINGLER',['WATER_3'],pct(50)],
 [211,'QWILFISH',['WATER_2'],pct(50)],[179,'MAREEP',['MONSTER','FIELD'],pct(50)],[180,'FLAAFFY',['MONSTER','FIELD'],pct(50)],[204,'PINECO',['BUG'],pct(50)],[205,'FORRETRESS',['BUG'],pct(50)],
 [133,'EEVEE',['FIELD'],pct(12.5)],[134,'VAPOREON',['FIELD'],pct(12.5)],[138,'OMANYTE',['WATER_1','WATER_3'],pct(12.5)],[139,'OMASTAR',['WATER_1','WATER_3'],pct(12.5)],
 [132,'DITTO',['DITTO'],'MON_GENDERLESS'],[202,'WOBBUFFET',['AMORPHOUS'],pct(50)],[360,'WYNAUT',['UNDISCOVERED'],pct(50)],[183,'MARILL',['WATER_1','FAIRY'],pct(50)],[298,'AZURILL',['UNDISCOVERED'],pct(75)],
 [4,'CHARMANDER',['MONSTER','DRAGON'],pct(12.5)],[5,'CHARMELEON',['MONSTER','DRAGON'],pct(12.5)],[140,'KABUTO',['WATER_1','WATER_3'],pct(12.5)],[141,'KABUTOPS',['WATER_1','WATER_3'],pct(12.5)],
 [106,'HITMONLEE',['HUMAN_LIKE'],'MON_MALE'],[107,'HITMONCHAN',['HUMAN_LIKE'],'MON_MALE'],[236,'TYROGUE',['UNDISCOVERED'],'MON_MALE'],[151,'MEW',['UNDISCOVERED'],'MON_GENDERLESS']];
const mechanics={data:{species:facts.map(([id,name,groups,genderRatio])=>({id,name:'SPECIES_'+name,eggGroups:groups.map(g=>'EGG_GROUP_'+g),genderRatio,growthRate:'GROWTH_MEDIUM_FAST'}))}};
const mon=(species,personality,more={})=>({species,personality,otId:77,validity:'valid',isEgg:false,shiny:false,level:30,experience:27000,heldItem:0,moves:[33],ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},...more});
function observation(){
 return {phase:'stable',frame:1,emulator:{mode:'overworld'},playerMemory:{map:{id:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F'},
  storyState:{flagIds:{2092:true,2112:true,2116:true,2121:true,576:false,580:false,597:true,505:false,506:false,486:false,626:false,627:true,748:false,749:true,750:true,611:true,582:true,730:true,632:true},variableIds:{[0x4024]:0}},
  trainer:{partyValidity:'valid',party:[mon(19,1,{slot:0})],storage:{validity:'valid',boxCounts:Array(14).fill(0),pokemon:[
   mon(133,255,{shiny:true,level:25,experience:15625}),mon(138,3,{shiny:true,level:5,experience:125}),mon(132,4),mon(202,5)]},
   bag:{keyItems:[{itemId:264,quantity:1}],items:[]},pokedex:{ownedSpecies:[19,41,129,133,138,132,202,106]}}}};
}
const rowsFor=o=>{const rows=nationalDexSources({o,world,mechanics});return id=>rows.find(r=>r.speciesId===id);};

test('fishing species are local catches with the rod each table needs, and their evolutions follow',()=>{
 const row=rowsFor(observation());
 assert.equal(row(98).status,'local');assert.equal(row(98).method,'fishing');
 assert.deepEqual(row(98).locations,[{map:'MAP_ROUTE12',method:'fishing',rodItemId:263}],'Krabby occupies a Good Rod slot');
 assert.match(row(98).reason,/Good Rod/);
 assert.equal(row(211).status,'local');assert.deepEqual(row(211).locations.map(l=>l.rodItemId),[264],'Qwilfish is a Super Rod catch');
 assert.equal(row(99).status,'local','Kingler evolves from a catchable Krabby');
});

// VAR_ALTERING_CAVE_WILD_SET (0x4024) is changed only by the Mystery Event
// script (pokefirered data/mystery_event_msg.s:327); src/event_data.c:162 sets 0.
test('Altering Cave species outside the active table are event-only, and so are their evolutions',()=>{
 const row=rowsFor(observation());
 for(const id of [179,204]){
  assert.equal(row(id).status,'external',id);assert.equal(row(id).category,'other-games',id);assert.equal(row(id).origin,'event',id);assert.match(row(id).reason,/Mystery Gift/);
  assert.equal(row(id).goal,false,'outside the FireRed goal');
 }
 for(const id of [180,205]){assert.equal(row(id).status,'external',id);assert.equal(row(id).category,'other-games',id);}
 const o=observation();o.playerMemory.storyState.variableIds[0x4024]=1;
 assert.equal(rowsFor(o)(179).status,'local','the event-selected table makes Mareep a native catch');
 assert.equal(rowsFor(o)(204).category,'other-games');
});

test('an evolution is only local when its earlier form is',()=>{
 const row=rowsFor(observation());
 assert.equal(row(4).status,'external');assert.equal(row(4).category,'another-firered-save','another FireRed save chooses the other starters');
 assert.equal(row(4).planned,true);assert.equal(row(4).goal,true);
 assert.equal(row(5).status,'external');assert.equal(row(5).category,'another-firered-save');assert.match(row(5).reason,/Charmander/i);
 assert.equal(row(183).status,'external');assert.equal(row(183).category,'other-games','Marill is not in FireRed');assert.equal(row(183).goal,false);
});

test('a base form owned only as a shiny is bred into a plain copy before evolving',()=>{
 const row=rowsFor(observation());
 assert.equal(row(134).status,'local');assert.match(row(134).reason,/breed/i);assert.match(row(134).reason,/shiny/i);
 assert.equal(row(139).status,'local');assert.match(row(139).reason,/breed/i);
 const o=observation();o.playerMemory.trainer.storage.pokemon=o.playerMemory.trainer.storage.pokemon.filter(p=>p.species!==132);
 assert.equal(rowsFor(o)(134).status,'external','without Ditto nothing can breed a male shiny Eevee');
});

test('fossils follow the Mt. Moon choice and the Dojo gift follows the individual still owned',()=>{
 const row=rowsFor(observation());
 assert.equal(row(140).status,'external','the Helix Fossil was taken, so no Dome Fossil exists in this save');
 assert.equal(row(140).category,'another-firered-save');assert.match(row(140).reason,/Dome Fossil/);
 assert.equal(row(141).status,'external');
 assert.equal(row(236).status,'external','Hitmonlee is registered, but no Hitmon individual remains to breed Tyrogue');
 assert.equal(row(236).category,'partner-borrow');assert.equal(row(236).planned,true);
 assert.equal(row(107).status,'external');assert.equal(row(107).category,'partner-borrow');
});

// Lax Incense and Sea Incense are cartridge item balls (pokefirered
// data/maps/FiveIsland_LostCave_Room11/map.json, Room12/map.json).
test('Wynaut breeds from an owned Wobbuffet with the Lost Cave Lax Incense; Azurill needs a Marill',()=>{
 const row=rowsFor(observation());
 assert.equal(row(360).status,'local');assert.match(row(360).reason,/Lax Incense/);
 const o=observation();o.playerMemory.storyState.flagIds[505]=true;
 assert.equal(rowsFor(o)(360).status,'external','a collected and spent incense leaves no source');assert.equal(rowsFor(o)(360).category,'spent-here');
 o.playerMemory.trainer.bag.items=[{itemId:221,quantity:1}];
 assert.equal(rowsFor(o)(360).status,'local','the incense in the Bag still breeds Wynaut');
 assert.equal(row(298).status,'external');
});

test('the summary counts the FireRed goal, its planned work and the entries only in other games',()=>{
 const rows=nationalDexSources({o:observation(),world,mechanics}),summary=nationalCollectionSummary(rows);
 assert.equal(summary.total,386);assert.equal(summary.owned,8);
 assert.equal(summary.owned+summary.local+summary.dependency+summary.external,386);
 assert.equal(summary.external,Object.values(summary.categories).reduce((a,b)=>a+b,0));
 assert.equal(summary.fireRed.total,189,'the FireRed goal set');
 assert.equal(summary.fireRed.owned,rows.filter(r=>r.goal&&r.status==='complete').length);
 assert.ok(summary.categories['other-games']>=190&&summary.categories['another-firered-save']>=6&&summary.categories['partner-borrow']>=2);
 for(const r of rows)if(r.status==='external')assert.ok(['other-games','another-firered-save','partner-borrow','spent-here'].includes(r.category),r.speciesId+' '+r.name);
 for(const r of rows)assert.equal(r.category==='other-games',r.status==='external'&&!r.goal,r.speciesId+' '+r.name);
 assert.equal(row151(rows).category,'other-games');assert.equal(row151(rows).origin,'event');
});
const row151=rows=>rows.find(r=>r.speciesId===151);
