import test from 'node:test';
import assert from 'node:assert/strict';
import * as evolution from '../src/suite/local-evolution.js';
import * as tasks from '../src/suite/fire-red-evolution.js';
import * as agenda from '../src/suite/postgame-agenda.js';
import {FireRedNativeTradeHost} from '../src/suite/native-trade-host.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// A second FireRed owner serves trade evolutions as an invisible partner.
// Its placeholder is an ordinary Pokémon, each round trip is net zero for it,
// and both saves keep distinct trainer and RFU owner identities.
const ivs={hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6};
const mon=(species,personality,extra={})=>({validity:'valid',species,personality,otId:2161188857,shiny:false,isEgg:false,heldItem:0,level:70,moves:[84,161],ivs,...extra});
const FIRERED_PARTNER={available:true,partners:[{owner:'firered-partner',title:'firered',methods:['trade']}]};
const BOTH={available:true,partners:[{owner:'emerald',title:'emerald',methods:['trade','time','beauty']},{owner:'firered-partner',title:'firered',methods:['trade']}]};
const plan={permanentFamilies:[[66,67,68],[21,22]]};
const trainer=()=>({partyValidity:'valid',party:[mon(22,1,{otId:10}),mon(67,2,{otId:10,level:93})],storage:{validity:'valid',pokemon:[mon(133,7,{otId:10})]},pokedex:{ownedSpecies:[22,67,133]},bag:{}});
const partnerRoute=()=>tasks.selectTeamPartnerEvolution({trainer:trainer(),partnerAvailable:FIRERED_PARTNER,teamPlan:plan});
const reserve=(extra={})=>{
 const route=partnerRoute();
 return evolution.reserveLocalEvolution({evolution:{requestId:route.requestId,index:0,steps:route.steps},source:route.pokemon,partner:mon(82,500),sourceOwner:'firered',sourceTrainerId:10933,partnerTrainerId:8185,...extra});
};

test('the FireRed partner offers only an ordinary placeholder: never shiny, legendary, mythical, an egg or an item holder',()=>{
 const ordinary=mon(82,500);
 assert.equal(evolution.selectPartnerPlaceholder([mon(113,1,{shiny:true}),mon(150,2),mon(151,3),mon(82,4,{isEgg:true}),mon(82,5,{heldItem:13}),ordinary])?.personality,500);
 for(const unsafe of [{shiny:true},{species:150},{species:151},{species:144},{species:249},{isEgg:true},{heldItem:1},{moves:[57]},{species:64},{validity:'unknown'},{species:277}])
  assert.equal(evolution.selectPartnerPlaceholder([{...ordinary,...unsafe}]),null,JSON.stringify(unsafe));
});

test('only the FireRed partner is available: the team route trades to that owner with the trade method only',()=>{
 const route=partnerRoute();
 assert.equal(route?.request.speciesId,68);assert.equal(route.pokemon.personality,2);
 assert.deepEqual(route.steps.map(s=>[s.kind,s.fromGame??s.game,s.toGame??null,s.partner??null]),[['trade','firered','firered','firered-partner'],['trade','firered','firered','firered-partner'],['verify','firered',null,null]]);
 // The Emerald route and its steps stay byte-identical for legacy availability and when Emerald is also ready.
 const legacy=tasks.selectTeamPartnerEvolution({trainer:trainer(),partnerAvailable:true,teamPlan:plan});
 assert.deepEqual(tasks.selectTeamPartnerEvolution({trainer:trainer(),partnerAvailable:BOTH,teamPlan:plan}),legacy);
 assert.equal(JSON.stringify(legacy.steps),JSON.stringify([{kind:'trade',fromGame:'firered',toGame:'emerald',speciesId:67,evolution:legacy.steps[0].evolution},{kind:'trade',fromGame:'emerald',toGame:'firered',speciesId:68},{kind:'verify',game:'firered',speciesId:68}]));
 // Time and Beauty evolutions need Emerald; the FireRed partner never takes them.
 const t=trainer();t.pokedex.ownedSpecies.push(68);
 assert.equal(tasks.selectOwnedPartnerEvolution({trainer:t,partnerAvailable:FIRERED_PARTNER}),null);
 assert.equal(tasks.selectOwnedPartnerEvolution({trainer:t,partnerAvailable:true})?.request.speciesId,196);
 assert.deepEqual(tasks.availablePartners({available:false,partners:FIRERED_PARTNER.partners}),[]);
});

test('a FireRed partner reservation carries both roles and owners and refuses shared identities',()=>{
 const r=reserve();
 assert.equal(r.method,'trade');assert.equal(r.targetSpecies,68);
 assert.deepEqual(r.roles,{source:{owner:'firered',title:'firered',trainerId:10933},partner:{owner:'firered-partner',title:'firered',trainerId:8185}});
 assert.throws(()=>reserve({partnerTrainerId:10933}),/trainer/i);
 assert.throws(()=>reserve({partnerTrainerId:null}),/trainer/i);
 assert.throws(()=>reserve({sourceOwner:'firered-partner'}),/owner/i);
 assert.throws(()=>reserve({partner:mon(82,500,{shiny:true})}),/partner/i);
 assert.throws(()=>reserve({partner:mon(150,500)}),/partner/i);
 assert.throws(()=>reserve({partner:mon(82,500,{heldItem:13})}),/partner/i);
 // Legacy Emerald reservations keep their fixed roles.
 const legacy=tasks.selectTeamPartnerEvolution({trainer:trainer(),partnerAvailable:true,teamPlan:plan});
 const e=evolution.reserveLocalEvolution({evolution:{requestId:legacy.requestId,index:0,steps:legacy.steps},source:legacy.pokemon,partner:mon(82,500,{heldItem:13})});
 assert.deepEqual(e.roles,{source:{owner:'firered',title:'firered',trainerId:null},partner:{owner:'emerald',title:'emerald',trainerId:null}});
});

const receipt=(r,role,leg,pokemon,extra={})=>({requestId:r.requestId,game:'firered',role,owner:r.roles[role].owner,leg,nativeSaveVerified:true,handshakeVerified:true,linkClosedVerified:true,savedSramSha256:'a'.repeat(64),pokemon,
 offeredFingerprint:role==='source'?(leg==='outbound'?r.sourceFingerprint:r.partnerFingerprint):(leg==='outbound'?r.partnerFingerprint:encounterFingerprint({...r.source,species:68})),...extra});
test('both FireRed receipts are keyed by role and bound to their owners',()=>{
 const r=reserve(),machamp={...r.source,species:68};
 const out={source:receipt(r,'source','outbound',r.partner),partner:receipt(r,'partner','outbound',machamp)};
 assert.equal(evolution.verifyLocalEvolutionExchange(r,'outbound',out).species,68);
 const back={source:receipt(r,'source','return',machamp),partner:receipt(r,'partner','return',r.partner)};
 assert.equal(evolution.verifyLocalEvolutionExchange(r,'return',back).species,68);
 for(const change of [x=>x.partner.owner='firered',x=>{x.firered=x.source;delete x.source;},x=>x.partner.role='source',x=>x.source.game='emerald',x=>x.partner.linkClosedVerified=false])
  {const invalid=structuredClone(back);change(invalid);assert.throws(()=>evolution.verifyLocalEvolutionExchange(r,'return',invalid),/verified|request|owner|role/i);}
 // A restart needs both FireRed owners' proofs, keyed by role.
 const pair={requestId:r.requestId,pairId:'pair-one',leg:'outbound',restarts:0,reservation:r};
 const proof=role=>({requestId:r.requestId,pairId:'pair-one',leg:'outbound',game:'firered',role,owner:r.roles[role].owner,outcome:'not-committed',nativeSaveVerified:true,savedSramSha256:'b'.repeat(64)});
 assert.equal(evolution.verifyLocalTradeRestart(pair,{source:proof('source'),partner:proof('partner')}),true);
 assert.throws(()=>evolution.verifyLocalTradeRestart(pair,{source:proof('source'),partner:{...proof('partner'),owner:'firered'}}),/both/i);
 assert.throws(()=>evolution.verifyLocalTradeRestart(pair,{firered:proof('source'),partner:proof('partner')}),/both/i);
});

test('the partner round trip is net zero: exactly its original party and PC individuals afterwards',()=>{
 const party=[mon(9,1),mon(82,500),mon(113,3,{shiny:true})],storage=[mon(150,9),mon(25,10)];
 const before=evolution.partnerHoldings({partyValidity:'valid',party,storage:{validity:'valid',pokemon:storage}});
 assert.equal(before.party.length,3);assert.equal(before.storage.length,2);
 const reordered={partyValidity:'valid',party:[party[1],party[0],party[2]],storage:{validity:'valid',pokemon:[...storage].reverse()}};
 assert.equal(evolution.verifyPartnerNetZero(before,reordered),true);
 const kept={partyValidity:'valid',party:[party[0],{...mon(67,2,{otId:10}),species:68},party[2]],storage:{validity:'valid',pokemon:storage}};
 assert.throws(()=>evolution.verifyPartnerNetZero(before,kept),/net|original/i);
 assert.throws(()=>evolution.verifyPartnerNetZero(before,{...reordered,storage:{validity:'unknown',pokemon:[]}}),/verif/i);
 assert.throws(()=>evolution.partnerHoldings({partyValidity:'unknown',party:[]}),/verif/i);
});

const world={data:{maps:[{id:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F',objectEvents:[{script:'Common_EventScript_DirectCornerAttendant',x:10,y:2}]}]}};
const fingerprint=encounterFingerprint(mon(82,500));
const guest=()=>new FireRedNativeTradeHost({world,center:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F',fingerprint,game:'firered',role:'guest',peerTrainerId:10933});
test('FireRed can join its reserved FireRed leader as a guest and acknowledges its own trade evolution text',()=>{
 assert.throws(()=>new FireRedNativeTradeHost({world,center:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F',fingerprint,game:'firered',role:'guest'}),/participant/);
 const task=guest(),o={phase:'stable',emulator:{mode:'overworld'},playerMemory:{map:{id:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F'},position:{x:10,y:4},trainer:{partyValidity:'valid',party:[mon(9,1),mon(82,500)]},ui:{choiceMenu:{maxCursor:3,cursor:0}}}};
 const w={validity:'valid',wirelessCommType:1,remotePlayers:0},radio={available:true,adapter:{mode:0},link:{session:'pair'}};
 task.inspect(o,w,radio);o.playerMemory.ui.choiceMenu=null;task.inspect(o,w,radio);o.playerMemory.ui.choiceMenu={maxCursor:2,cursor:0};
 assert.deepEqual(task.inspect(o,w,radio).action?.buttons,['a']);assert.equal(task.state.role,'guest');
 w.guest={state:3,cursor:0,leaders:[{index:0,trainerId:8185,version:4,active:true},{index:1,trainerId:10933,version:4,active:true}]};
 assert.deepEqual(task.inspect(o,w,radio).action?.buttons,['down']);w.guest.cursor=1;assert.deepEqual(task.inspect(o,w,radio).action?.buttons,['a']);
 // The received Machoke evolves in the partner; only message pages are acknowledged.
 const e=guest(),scene={phase:'stable',emulator:{mode:'overworld'},playerMemory:{map:{id:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F'},trainer:{partyValidity:'valid',party:[mon(9,1),mon(82,500)]},ui:{}}};
 e.inspect(scene,{tradeCount:8});e.state.exchangeStarted=true;
 scene.playerMemory.trainer.party[1]={...mon(67,2,{otId:10}),species:68};scene.emulator.callback2='CB2_TradeEvolutionSceneUpdate';
 const printing={tradeCount:8,evolutionScene:{state:13,textPrinter:{active:true,state:1}}};
 assert.deepEqual(e.inspect(scene,printing,{available:true}).action?.buttons,['a']);
 assert.equal(e.inspect(scene,{...printing,evolutionScene:{state:20,textPrinter:{active:true,state:1}}},{available:true}).action,undefined,'a move replacement is never chosen');
 assert.equal(e.inspect(scene,{...printing,evolutionScene:{state:13,textPrinter:{active:true,state:0}}},{available:true}).action,undefined);
 // The FireRed leader keeps its existing behavior.
 const leader=new FireRedNativeTradeHost({world,center:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F',fingerprint});
 leader.inspect(scene,{tradeCount:8});leader.state.exchangeStarted=true;scene.playerMemory.trainer.party[1]=mon(82,500);
 assert.equal(leader.state.role,'leader');
});

test('pair-dependent prerequisites: FireRed partners need the Pokédex, plus the National Dex only above #151',()=>{
 const machoke={kind:'trade',fromGame:'firered',toGame:'firered',partner:'firered-partner',speciesId:67,evolution:{fromSpecies:67,speciesId:68}};
 const scizor={...machoke,speciesId:123,evolution:{fromSpecies:123,speciesId:212}};
 const emerald={kind:'trade',fromGame:'firered',toGame:'emerald',speciesId:67,evolution:{fromSpecies:67,speciesId:68}};
 assert.equal(tasks.partnerTradeReady({2092:true},machoke),true,'the League implies the Pokédex');
 assert.equal(tasks.partnerTradeReady({2089:true},machoke),true);
 assert.equal(tasks.partnerTradeReady({},machoke),false);
 assert.equal(tasks.partnerTradeReady({2089:true},scizor),false);
 assert.equal(tasks.partnerTradeReady({2089:true,2112:true},scizor),true);
 assert.equal(tasks.partnerTradeReady({2092:true,2112:true},emerald),false,'Emerald keeps its Sevii link requirement');
 assert.equal(tasks.partnerTradeReady({2092:true,2112:true,2116:true},emerald),true);
 assert.equal(agenda.postgameEntryNeedsLink('team-evolution',{partnerAvailable:true}),true);
 assert.equal(agenda.postgameEntryNeedsLink('team-evolution',{partnerAvailable:FIRERED_PARTNER}),false);
 assert.equal(agenda.postgameEntryNeedsLink('mewtwo',{partnerAvailable:FIRERED_PARTNER}),true);
 assert.equal(agenda.postgameEntryNeedsLink('lapras',{}),false);
});
