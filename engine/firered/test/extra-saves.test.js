import test from 'node:test';
import assert from 'node:assert/strict';
import {describeSaveInventory,extraSaveNeeds,planExtraSaves,presentExtraSavePlan,selectMainPlaceholder,selectMainDitto,eligibleLoanSubject,EXTRA_SAVE_WATCH} from '../src/suite/extra-saves.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// The facts below were decoded read-only from copies of the owner's saves on
// 2026-09-28 (see .private/extra-saves-20260928/NOTES.md): the FireRed partner
// (TID 8185, Squirtle start) holds a non-shiny Blastoise in its party but its
// Hitmonlee is shiny; the archived OMI profile's Suicune is shiny; every save
// took the Helix Fossil; FIRE (TID 32589) is a post-League Charmander save that
// never took its Dojo prize.
const ivs={hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6};
let serial=100;
const mon=(species,extra={})=>({validity:'valid',species,personality:serial++,otId:1,shiny:false,isEgg:false,heldItem:0,level:30,moves:[33],ivs,...extra});
const world={data:{maps:[
 {id:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F',objectEvents:[{script:'Common_EventScript_DirectCornerAttendant'}]},
 {id:'MAP_VIRIDIAN_CITY_POKEMON_CENTER_2F',objectEvents:[{script:'Common_EventScript_DirectCornerAttendant'}]},
 {id:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F',objectEvents:[]},
]}};
const observation=({map,otId,trainerId,party,pc=[],owned=[],flags={},starter=0})=>({phase:'stable',playerMemory:{map:{id:map},
 storyState:{flagIds:{2089:true,2092:true,...flags},variableIds:{0x4031:starter}},
 trainer:{otId,trainerId,partyValidity:'valid',party,storage:{validity:'valid',pokemon:pc},pokedex:{ownedSpecies:owned}}}});
const range=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i);

function fixture(){
 serial=100;
 const ditto=mon(132,{otId:1706568373}),omanyte=mon(138,{otId:1706568373}),spare=[mon(19,{otId:1706568373,level:3}),mon(19,{otId:1706568373,level:4}),mon(16,{otId:1706568373,level:5})];
 const mainOwned=[...range(1,3),...range(10,105),106,108,...range(110,135),138,142,143,144,244];
 const main=describeSaveInventory({world,source:{kind:'main',owner:'firered',label:'RED'},
  observation:observation({map:'MAP_CELADON_CITY',otId:1706568373,trainerId:10933,party:[mon(3,{otId:1706568373})],pc:[ditto,omanyte,...spare],owned:mainOwned,flags:{2112:true,2116:true,562:true,627:true,632:true},starter:0}),
  roamer:{species:244,active:false}});
 const blastoise=mon(9,{otId:2161188857,level:70,moves:[57,127]}),partnerHitmonlee=mon(106,{otId:2161188857,shiny:true}),partnerUmbreon=mon(197,{otId:2161188857,shiny:true});
 const partnerObservation=observation({map:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F',otId:2161188857,trainerId:8185,party:[blastoise,mon(82,{otId:2161188857})],pc:[partnerHitmonlee,partnerUmbreon,mon(132,{otId:2161188857})],owned:[7,8,9,106,197],flags:{2112:true,562:true,627:true,632:true},starter:1});
 const partner=describeSaveInventory({world,observation:partnerObservation,source:{kind:'partner-owner',owner:'firered-partner',label:'RED (partner)'},roamer:{species:243,active:true}});
 // An archived copy of the partner's lineage never becomes a second working copy.
 const partnerArchive=describeSaveInventory({world,observation:partnerObservation,source:{kind:'profile',profileId:'6949870e-ca5c-4d45-adcd-8f4bda36d93e',label:'RED archive',saved:true},roamer:{species:243,active:true}});
 const omiCharizard=mon(6,{otId:3465800771,level:69}),omiSuicune=mon(245,{otId:3465800771,shiny:true,level:50});
 const omi=describeSaveInventory({world,source:{kind:'profile',profileId:'abc6db80-ebbb-4083-8ac3-fd55e181b075',label:'OMI',saved:true},
  observation:observation({map:'MAP_ROUTE1',otId:3465800771,trainerId:60483,party:[omiCharizard],pc:[omiSuicune],owned:[4,5,6,245],flags:{2112:true,562:true,627:true,632:false},starter:2}),roamer:{species:245,active:false}});
 const fireCharizard=mon(6,{otId:2739568461,level:66});
 const fire=describeSaveInventory({world,source:{kind:'profile',profileId:'08b8c4c8-5802-4f2f-9aa1-5521fa723563',label:'FIRE',saved:true},
  observation:observation({map:'MAP_PALLET_TOWN',otId:2739568461,trainerId:32589,party:[fireCharizard],owned:[4,5,6],flags:{2112:false,562:true,627:true,632:false},starter:2}),roamer:{species:0,active:false}});
 const stateOnly=describeSaveInventory({world,source:{kind:'profile',profileId:'a0bddebc-a515-4491-b036-01f6df65dcd3',label:'RED (3958)',saved:false},
  observation:observation({map:'MAP_ROUTE22',otId:2544045942,trainerId:3958,party:[mon(4,{otId:2544045942})],owned:[4],flags:{2092:false},starter:2})});
 return {main,partner,partnerArchive,omi,fire,stateOnly,blastoise,partnerHitmonlee,omiSuicune,fireCharizard,omiCharizard,ditto,spare};
}
const route=(plan,id)=>plan.routes.find(r=>r.needId===id);

test('the inventory records the one-per-save choices, lineage and a parked Pokémon Center with a Direct Corner',()=>{
 const {partner,fire,omi}=fixture();
 assert.equal(partner.schema,'pokemon-suite/extra-save-inventory/v1');
 assert.equal(partner.lineage,'2161188857');assert.equal(partner.trainerId,8185);
 assert.equal(partner.starter,'squirtle');assert.equal(fire.starter,'charmander');
 assert.deepEqual(partner.choices,{starter:'squirtle',fossil:'helix',fossilRevived:false,dojoPrizeTaken:true,roamer:{species:243,active:true,used:false}});
 assert.equal(partner.parked,true,'a save in a Center whose 2F has the Direct Corner is parked');
 assert.equal(fire.parked,false);assert.equal(omi.parked,false);
 assert.deepEqual(omi.choices.roamer,{species:245,active:false,used:true},'caught (or fainted): no longer available in that save');
 const blastoise=partner.pokemon.find(p=>p.species===9);
 assert.deepEqual([blastoise.where,blastoise.shiny,blastoise.level],['party',false,70]);
 assert.ok(EXTRA_SAVE_WATCH.flags.includes(632)&&EXTRA_SAVE_WATCH.variables.includes(0x4031));
});

test('needs are families the main save neither owns nor can produce from an individual it holds',()=>{
 const {main}=fixture();
 const needs=extraSaveNeeds(main);
 assert.deepEqual(needs.map(n=>n.id).sort(),['fossil-dome','hitmon','roamer-raikou','roamer-suicune','starter-charmander','starter-squirtle']);
 assert.deepEqual(needs.find(n=>n.id==='hitmon').missing,[107,236,237],'Hitmonlee is registered but no Hitmon individual is held');
 assert.ok(!needs.some(n=>n.id==='fossil-helix'),'held Omanyte covers Omastar locally');
 assert.ok(!needs.some(n=>n.id==='roamer-entei'),'Entei is owned');
});

test('the main save\'s own unused choices stay local: its roaming dog, its unrevived fossil and its Dojo prize',()=>{
 const {main}=fixture();
 const fresh={...main,pokedexOwned:main.pokedexOwned.filter(id=>id!==244),choices:{...main.choices,fossilRevived:false,dojoPrizeTaken:false,roamer:{species:0,active:false,used:false}},
  pokemon:main.pokemon.filter(p=>p.species!==138)};
 const ids=extraSaveNeeds(fresh).map(n=>n.id);
 assert.ok(!ids.includes('roamer-entei'),'a Bulbasaur save catches its own Entei');
 assert.ok(!ids.includes('fossil-helix'),'the Helix Fossil it took is revived locally');
 assert.ok(!ids.includes('hitmon'),'its own Dojo prize is still available');
 assert.ok(ids.includes('fossil-dome')&&ids.includes('roamer-raikou'));
});

test('existing saves are reused first: the partner Blastoise is lent for a Squirtle Egg with the main save\'s Ditto',()=>{
 const f=fixture(),plan=planExtraSaves({main:f.main,sources:[f.partner,f.partnerArchive,f.omi,f.fire,f.stateOnly]});
 const squirtle=route(plan,'starter-squirtle');
 assert.equal(squirtle.mode,'loan');assert.equal(squirtle.status,'ready');
 assert.equal(squirtle.source.owner,'firered-partner');assert.equal(squirtle.subject.fingerprint,encounterFingerprint(f.blastoise));
 assert.deepEqual(squirtle.breed,{speciesId:7,dittoFingerprint:encounterFingerprint(f.ditto)});
 assert.deepEqual(squirtle.delivers,[7,8,9]);assert.equal(squirtle.runtime,'short');
 assert.equal(squirtle.returns,true,'a lent individual always goes back: the partner stays net zero');
});

test('an archived save lends through a seeded partner owner, parked first; a lineage with a live owner is never copied again',()=>{
 const f=fixture(),plan=planExtraSaves({main:f.main,sources:[f.partner,f.partnerArchive,f.omi,f.fire,f.stateOnly]});
 const charmander=route(plan,'starter-charmander');
 assert.equal(charmander.mode,'loan');assert.equal(charmander.source.profileId,'08b8c4c8-5802-4f2f-9aa1-5521fa723563','FIRE also serves the Dojo prize and its future Suicune');
 assert.deepEqual(charmander.prep.map(p=>p.kind),['seed-partner-owner','park']);
 assert.equal(charmander.status,'needs-partner-owner');
 assert.ok(!plan.routes.some(r=>r.source?.profileId==='6949870e-ca5c-4d45-adcd-8f4bda36d93e'),'the archive of the live partner lineage is ignored');
 assert.ok(!plan.routes.some(r=>r.source?.profileId==='a0bddebc-a515-4491-b036-01f6df65dcd3'),'a save with no native save cannot be seeded');
});

test('shinies are never offered, so the Hitmon family and Suicune come from bounded helper work',()=>{
 const f=fixture(),plan=planExtraSaves({main:f.main,sources:[f.partner,f.omi,f.fire]});
 assert.equal(eligibleLoanSubject(f.partnerHitmonlee),false);assert.equal(eligibleLoanSubject(f.omiSuicune,{mode:'register'}),false);
 const hitmon=route(plan,'hitmon');
 assert.equal(hitmon.mode,'keep');assert.equal(hitmon.status,'needs-helper-task');
 assert.deepEqual(hitmon.helper,{kind:'dojo-prize',prize:'either',speciesId:107,lineage:'2739568461',label:'FIRE'});
 assert.deepEqual(hitmon.delivers,[106,107,236,237]);
 const suicune=route(plan,'roamer-suicune');
 assert.equal(suicune.status,'planned-long');assert.equal(suicune.runtime,'long');
 assert.equal(suicune.helper.kind,'roamer-capture');assert.equal(suicune.helper.lineage,'2739568461');
 assert.match(suicune.reason,/National Pokédex/);
});

test('without a save holding the choice, a new helper save is planned; the partner is never tasked without the owner',()=>{
 const f=fixture(),plan=planExtraSaves({main:f.main,sources:[f.partner,f.omi,f.fire]});
 const dome=route(plan,'fossil-dome'),raikou=route(plan,'roamer-raikou');
 assert.equal(dome.mode,'keep');assert.equal(dome.status,'needs-helper-save');
 assert.equal(dome.helper.kind,'new-save');
 assert.equal(raikou.helper.kind,'new-save');assert.equal(raikou.runtime,'long');
 assert.equal(dome.helper.saveId,raikou.helper.saveId,'one helper save serves compatible choices');
 const save=plan.helperSaves.find(s=>s.id===dome.helper.saveId);
 assert.deepEqual(save.settings,{starter:'squirtle',fossil:'dome',afterCampaign:'wait'});
 assert.deepEqual(save.stages.map(s=>s.needId),['fossil-dome','roamer-raikou']);
 assert.deepEqual(raikou.alternatives,[{kind:'roamer-capture',owner:'firered-partner',approval:'owner',reason:'The FireRed partner still has Raikou roaming, but the partner is never given tasks without your approval.'}]);
});

test('one seeded save serves several families, and a roaming dog comes from an archived save before a new one',()=>{
 const f=fixture();
 // Another archived save, Squirtle start, whose roaming Raikou was never released yet (no National Pokédex).
 const engine50=describeSaveInventory({world,source:{kind:'profile',profileId:'f11f3c5c-b545-40ac-a768-b9c2e121b027',label:'Engine 50',saved:true},
  observation:observation({map:'MAP_PALLET_TOWN',otId:2544045942,trainerId:3958,party:[mon(9,{otId:2544045942,level:56})],owned:[7,8,9],flags:{2112:false,562:true,627:true,632:false},starter:1}),roamer:{species:0,active:false}});
 const plan=planExtraSaves({main:f.main,sources:[f.partner,f.omi,f.fire,engine50]});
 assert.equal(route(plan,'starter-charmander').source.label,'FIRE');
 assert.equal(route(plan,'hitmon').helper.lineage,'2739568461','the Dojo prize comes from the save already seeded for the Charmander line');
 const raikou=route(plan,'roamer-raikou');
 assert.equal(raikou.helper.kind,'roamer-capture');assert.equal(raikou.helper.lineage,'2544045942','an archived Squirtle save, not the live partner');
 assert.equal(raikou.status,'planned-long');
 assert.ok(!plan.helperSaves.some(s=>s.stages.some(x=>x.needId==='roamer-raikou')),'no new save is planned for Raikou');
});

test('helper saves are planned for every missing starter when no save holds one',()=>{
 const {main}=fixture(),plan=planExtraSaves({main,sources:[]});
 assert.equal(route(plan,'starter-squirtle').status,'needs-helper-save');
 const charmander=route(plan,'starter-charmander'),squirtle=route(plan,'starter-squirtle');
 assert.notEqual(charmander.helper.saveId,squirtle.helper.saveId,'one starter per save');
 const save=plan.helperSaves.find(s=>s.id===charmander.helper.saveId);
 assert.equal(save.settings.starter,'charmander');
 assert.deepEqual(save.stages[0].goal,{kind:'starter',starter:'charmander'});
});

test('without a Ditto the lent individual is only registered and returned',()=>{
 const f=fixture();
 const main={...f.main,pokemon:f.main.pokemon.filter(p=>p.species!==132)};
 const squirtle=route(planExtraSaves({main,sources:[f.partner]}),'starter-squirtle');
 assert.equal(squirtle.mode,'register');assert.deepEqual(squirtle.delivers,[9]);assert.match(squirtle.reason,/Ditto/);
});

test('the main placeholder is an ordinary PC duplicate the partner can receive; the Ditto is the main save\'s own',()=>{
 const f=fixture();
 const trainer={partyValidity:'valid',party:[mon(3)],storage:{validity:'valid',pokemon:[f.ditto,...f.spare,mon(150,{level:2}),mon(64,{level:2}),mon(64,{level:2}),mon(19,{shiny:true,level:1}),mon(19,{heldItem:4,level:1}),mon(277,{level:1}),mon(277,{level:1})]}};
 const p=selectMainPlaceholder({trainer});
 assert.equal(p.species,19);assert.equal(p.level,3,'the lowest-level ordinary duplicate');
 assert.equal(selectMainPlaceholder({trainer,protectedFingerprints:f.spare.slice(0,2).map(encounterFingerprint)}),null,'protected duplicates are never offered');
 assert.equal(selectMainDitto({trainer}).species,132);
 assert.equal(selectMainDitto({trainer,protectedFingerprints:[encounterFingerprint(f.ditto)]}),null);
});

test('the presentation names the helper save, what it is doing and an unknown ETA',()=>{
 const f=fixture(),plan=planExtraSaves({main:f.main,sources:[f.partner,f.omi,f.fire]});
 const rows=presentExtraSavePlan(plan,{active:{needId:'starter-squirtle',phase:'daycare',reason:'Waiting for the Day Care Egg.'},helpers:[{saveId:plan.routes.find(r=>r.needId==='fossil-dome').helper.saveId,owner:'firered-helper-1',objective:'badge-boulder',status:'running'}]});
 const squirtle=rows.find(r=>r.needId==='starter-squirtle'),dome=rows.find(r=>r.needId==='fossil-dome');
 assert.equal(squirtle.save,'RED (partner)');assert.equal(squirtle.doing,'Waiting for the Day Care Egg.');assert.equal(squirtle.eta,'unknown');
 assert.match(dome.save,/Helper save/);assert.equal(dome.doing,'Playing the story: badge-boulder');assert.equal(dome.eta,'unknown');
 assert.deepEqual(dome.helper,{saveId:'helper-1',settings:{starter:'squirtle',fossil:'dome',afterCampaign:'wait'},goal:{kind:'fossil',fossil:'dome'}},'the host can start this helper save from its row');
 assert.match(rows.find(r=>r.needId==='roamer-suicune').route,/Suicune/);
});

// build 126: helper tasks. A task runs in an archived save's helper owner
// before that save becomes a partner (one working copy per lineage), so tasks
// are planned only on archived profiles. The Dojo task names the prize the
// main save still lacks; a long roaming-dog task prefers a save that no short
// route waits on; a helper-obtained legendary is registered and returned.
test('the Dojo task takes the prize the main save has not registered, on an archived save',()=>{
 const f=fixture(),plan=planExtraSaves({main:f.main,sources:[f.partner,f.omi,f.fire]});
 const hitmon=route(plan,'hitmon');
 assert.equal(hitmon.helper.speciesId,107,'Hitmonlee is registered, so the helper takes Hitmonchan');
 const lee=planExtraSaves({main:{...f.main,pokedexOwned:f.main.pokedexOwned.filter(id=>id!==106).concat(107)},sources:[f.fire]});
 assert.equal(route(lee,'hitmon').helper.speciesId,106);
 // A save already serving as a partner owner keeps its Dojo prize: no task runs there.
 const seeded={...f.fire,source:{kind:'partner-owner',owner:'firered-partner-2',label:'FIRE'}};
 const elsewhere=planExtraSaves({main:f.main,sources:[f.partner,seeded]});
 assert.notEqual(route(elsewhere,'hitmon').source?.owner,'firered-partner-2');
 assert.equal(route(elsewhere,'hitmon').helper.kind,'new-save');
});

test('a long roaming-dog task prefers an archived save no short route is waiting on',()=>{
 const f=fixture();
 const engine59=describeSaveInventory({world,source:{kind:'profile',profileId:'6545b63e-6a1c-4e46-9f1e-d0e01b3a3f59',label:'Engine 59',saved:true},
  observation:observation({map:'MAP_PALLET_TOWN',otId:3933765571,trainerId:32707,party:[mon(6,{otId:3933765571,level:64})],owned:[4,5,6],flags:{2112:false,562:true,627:true,632:false},starter:2}),roamer:{species:0,active:false}});
 const plan=planExtraSaves({main:f.main,sources:[f.partner,f.omi,f.fire,engine59]});
 // Two archived Charmander saves can each lend a Charizard and take a Dojo prize.
 const loan=route(plan,'starter-charmander').source.label;
 assert.ok(['FIRE','Engine 59'].includes(loan));
 assert.equal(route(plan,'hitmon').source.label,loan,'the short Dojo task joins the save already serving the loan');
 const suicune=route(plan,'roamer-suicune');
 assert.notEqual(suicune.source.label,loan,'Suicune does not make the Charizard loan wait');
 assert.ok(['FIRE','Engine 59'].includes(suicune.source.label));
 assert.equal(suicune.helper.kind,'roamer-capture');
 // With only one Charmander save, that save carries every task.
 const single=planExtraSaves({main:f.main,sources:[f.partner,f.fire]});
 assert.equal(route(single,'roamer-suicune').source.label,'FIRE');
});

test('a helper-obtained legendary is registered and returned, never kept',()=>{
 const f=fixture(),raikou=mon(243,{otId:2544045942,level:50});
 const seeded=describeSaveInventory({world,source:{kind:'partner-owner',owner:'firered-partner-3',label:'Engine 50',grants:[encounterFingerprint(raikou)]},
  observation:observation({map:'MAP_VIRIDIAN_CITY_POKEMON_CENTER_2F',otId:2544045942,trainerId:3958,party:[mon(9,{otId:2544045942,level:56}),raikou],owned:[7,8,9,243],flags:{2112:true,2116:true,562:true,627:true,632:true},starter:1}),roamer:{species:243,active:false}});
 const r=route(planExtraSaves({main:f.main,sources:[f.partner,seeded]}),'roamer-raikou');
 assert.equal(r.mode,'register');assert.equal(r.returns,true);assert.equal(r.status,'ready');
 assert.equal(r.subject.fingerprint,encounterFingerprint(raikou));
});

test('rows name their source, subject and the host action that starts them',()=>{
 const f=fixture(),plan=planExtraSaves({main:f.main,sources:[f.partner,f.omi,f.fire]});
 const rows=presentExtraSavePlan(plan);
 const charmander=rows.find(r=>r.needId==='starter-charmander'),hitmon=rows.find(r=>r.needId==='hitmon'),suicune=rows.find(r=>r.needId==='roamer-suicune'),dome=rows.find(r=>r.needId==='fossil-dome');
 assert.deepEqual(charmander.source,{kind:'profile',owner:null,profileId:'08b8c4c8-5802-4f2f-9aa1-5521fa723563',label:'FIRE',lineage:'2739568461',trainerId:32589});
 assert.equal(charmander.subject.fingerprint,encounterFingerprint(f.fireCharizard));
 assert.deepEqual(charmander.start,{action:'seed-partner',profileId:'08b8c4c8-5802-4f2f-9aa1-5521fa723563'});
 assert.deepEqual(hitmon.task,{kind:'dojo-prize',speciesId:107,profileId:'08b8c4c8-5802-4f2f-9aa1-5521fa723563',lineage:'2739568461'});
 assert.deepEqual(hitmon.start,{action:'start-helper',needId:'hitmon'});
 assert.deepEqual(suicune.task,{kind:'roamer-capture',speciesId:245,profileId:'08b8c4c8-5802-4f2f-9aa1-5521fa723563',lineage:'2739568461'});
 assert.deepEqual(dome.start,{action:'start-helper',saveId:'helper-1'});
 assert.equal(rows.find(r=>r.needId==='starter-squirtle').start,undefined,'a ready route needs no action');
});

test('an archive its helper is preparing keeps its rows, which say so',()=>{
 const f=fixture(),preparing={...f.fire,source:{...f.fire.source,helperOwner:'firered-helper-1'}};
 const plan=planExtraSaves({main:f.main,sources:[f.partner,f.omi,preparing]});
 assert.equal(route(plan,'starter-charmander').source.helperOwner,'firered-helper-1');
 const rows=presentExtraSavePlan(plan),charmander=rows.find(r=>r.needId==='starter-charmander'),hitmon=rows.find(r=>r.needId==='hitmon');
 assert.match(charmander.doing,/helper/);assert.match(hitmon.doing,/helper/);
 assert.deepEqual(hitmon.start,{action:'start-helper',needId:'hitmon'},'starting again resumes the same helper');
});
