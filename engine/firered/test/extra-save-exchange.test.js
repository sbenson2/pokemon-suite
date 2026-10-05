import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveExtraSaveTrade,selectExtraSaveOffer,verifyPartnerExchangeLeg,applyPartnerLegProof,emptyPartnerLedger,ExtraSaveExchangeTask,extraSaveLeg,selectExtraSaveObjective} from '../src/suite/extra-save-exchange.js';
import {createPostgameAcquisition} from '../src/suite/native-acquisition.js';
import {partnerHoldings} from '../src/suite/local-evolution.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

const ivs={hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6};
const mon=(species,personality,extra={})=>({validity:'valid',species,personality,otId:77,shiny:false,isEgg:false,heldItem:0,level:30,hp:50,maxHp:50,status1:0,moves:[33],pp:[35],ivs,...extra});
const fp=encounterFingerprint;
// Main: RED (10933) with its Ditto and two spare Pidgey; partner: RED (8185) with Blastoise.
const blastoise=mon(9,501,{otId:2161188857,level:70,moves:[57,127]}),pidgey=mon(16,11,{level:3}),pidgey2=mon(16,12,{level:4}),ditto=mon(132,13),venusaur=mon(3,14,{moves:[19]});
const offer=(leg,extra={})=>({schema:'pokemon-suite/extra-save-offer/v1',exchangeId:'extra-save-starter-squirtle-100',mode:'loan',leg,
 fingerprint:leg==='open'?fp(blastoise):fp(pidgey),expectSource:leg==='open'?fp(pidgey):fp(blastoise),...extra});
const leg=(o=offer('open'))=>({requestId:`extra-save-starter-squirtle-100-${o.leg}`,kind:'extra-save',partnerOwner:'firered-partner',offer:o,phase:'waiting-for-transfer',tradePreparation:{pokemon:o.leg==='open'?pidgey:blastoise,center:'MAP_CELADON_CITY_POKEMON_CENTER_1F'}});
const flags={2089:true,2092:true,2112:true};

test('a single leg reserves exactly the two named individuals between two distinct FireRed owners',()=>{
 const r=reserveExtraSaveTrade({leg:leg(),source:pidgey,partner:blastoise,sourceTrainerId:10933,partnerTrainerId:8185,partnerTitle:'firered',sourceFlags:flags,partnerReady:{pokedex:true,nationalDex:false}});
 assert.equal(r.method,'single');assert.equal(r.requestId,'extra-save-starter-squirtle-100-open');
 assert.deepEqual(r.roles,{source:{owner:'firered',title:'firered',trainerId:10933},partner:{owner:'firered-partner',title:'firered',trainerId:8185}});
 assert.deepEqual(r.exchange,{exchangeId:'extra-save-starter-squirtle-100',mode:'loan',leg:'open'});
 assert.equal(r.sourceFingerprint,fp(pidgey));assert.equal(r.partnerFingerprint,fp(blastoise));assert.equal(r.targetSpecies,16);
 const base={leg:leg(),source:pidgey,partner:blastoise,sourceTrainerId:10933,partnerTrainerId:8185,partnerTitle:'firered',sourceFlags:flags,partnerReady:{pokedex:true}};
 for(const [label,change] of [
  ['same trainer',x=>x.partnerTrainerId=10933],['emerald',x=>x.partnerTitle='emerald'],['same owner',x=>x.leg={...x.leg,partnerOwner:'firered'}],
  ['other partner individual',x=>x.partner=mon(9,999,{otId:2161188857})],['shiny',x=>{x.partner={...blastoise,shiny:true};}],
  ['held item',x=>{x.source={...pidgey,heldItem:4};x.leg={...x.leg,offer:{...x.leg.offer,expectSource:fp(x.source)}};}],
  ['no partner Pokédex',x=>x.partnerReady={pokedex:false}],['bad offer',x=>x.leg={...x.leg,offer:{...x.leg.offer,mode:'give'}}],
 ]){const value={...base};change(value);assert.throws(()=>reserveExtraSaveTrade(value),Error,label);}
 // A Johto or Hoenn species needs the National Pokédex on both saves.
 const tyrogue=mon(236,600,{otId:2161188857});
 const national={...base,partner:tyrogue,leg:leg(offer('open',{fingerprint:fp(tyrogue)}))};
 assert.throws(()=>reserveExtraSaveTrade(national),/National/);
 assert.equal(reserveExtraSaveTrade({...national,partnerReady:{pokedex:true,nationalDex:true}}).partnerFingerprint,fp(tyrogue));
});

test('the partner offers only what the leg names: never a shiny, and a helper gives away only what it was granted',()=>{
 const party=[blastoise,mon(82,500,{otId:2161188857})],shinyLee=mon(106,700,{otId:2161188857,shiny:true});
 const trainer={partyValidity:'valid',party:[...party,shinyLee],storage:{validity:'valid',pokemon:[mon(143,701,{otId:2161188857})]}};
 assert.equal(selectExtraSaveOffer({trainer,offer:offer('open'),ledger:emptyPartnerLedger()}).pokemon,blastoise);
 assert.match(selectExtraSaveOffer({trainer,offer:offer('open',{fingerprint:fp(shinyLee)}),ledger:emptyPartnerLedger()}).reason,/non-shiny/);
 assert.match(selectExtraSaveOffer({trainer,offer:offer('open',{fingerprint:fp(trainer.storage.pokemon[0])}),ledger:emptyPartnerLedger()}).reason,/party/);
 assert.match(selectExtraSaveOffer({trainer,offer:offer('open',{mode:'keep'}),ledger:emptyPartnerLedger()}).reason,/keeps its own/);
 assert.equal(selectExtraSaveOffer({trainer,offer:offer('open',{mode:'keep'}),ledger:emptyPartnerLedger([fp(blastoise)])}).pokemon,blastoise);
 const lending={...emptyPartnerLedger(),open:{exchangeId:'extra-save-starter-squirtle-100',mode:'loan',lent:fp(blastoise),received:fp(pidgey)}};
 assert.match(selectExtraSaveOffer({trainer,offer:offer('open',{exchangeId:'another-100'}),ledger:lending}).reason,/lending/);
 const back={...trainer,party:[pidgey,...party.slice(1)]};
 assert.equal(selectExtraSaveOffer({trainer:back,offer:offer('close'),ledger:lending}).pokemon,pidgey);
 assert.match(selectExtraSaveOffer({trainer:back,offer:offer('close',{exchangeId:'another-100'}),ledger:lending}).reason,/no open loan/);
});

test('the partner proves each leg; after the return it holds exactly its original Pokémon',()=>{
 const other=mon(82,500,{otId:2161188857}),pc=[mon(143,701,{otId:2161188857})];
 const trainer=party=>({partyValidity:'valid',party,storage:{validity:'valid',pokemon:pc}});
 const before=partnerHoldings(trainer([blastoise,other]));
 const openReservation=reserveExtraSaveTrade({leg:leg(),source:pidgey,partner:blastoise,sourceTrainerId:10933,partnerTrainerId:8185,partnerTitle:'firered',sourceFlags:flags,partnerReady:{pokedex:true}});
 let ledger=emptyPartnerLedger();
 const opened=verifyPartnerExchangeLeg({preparation:{offer:offer('open'),holdings:before},reservation:openReservation,trainer:trainer([pidgey,other]),ledger});
 assert.equal(opened.netZeroVerified,false);assert.equal(opened.lent,fp(blastoise));assert.equal(opened.received,fp(pidgey));
 assert.throws(()=>verifyPartnerExchangeLeg({preparation:{offer:offer('open'),holdings:before},reservation:openReservation,trainer:trainer([pidgey]),ledger}),/preserved for review/);
 ledger=applyPartnerLegProof(ledger,opened);assert.equal(ledger.open.exchangeId,'extra-save-starter-squirtle-100');
 const closeReservation=reserveExtraSaveTrade({leg:leg(offer('close')),source:blastoise,partner:pidgey,sourceTrainerId:10933,partnerTrainerId:8185,partnerTitle:'firered',sourceFlags:flags,partnerReady:{pokedex:true}});
 const closed=verifyPartnerExchangeLeg({preparation:{offer:offer('close'),holdings:partnerHoldings(trainer([pidgey,other]))},reservation:closeReservation,trainer:trainer([blastoise,other]),ledger});
 assert.equal(closed.netZeroVerified,true);
 ledger=applyPartnerLegProof(ledger,closed);assert.equal(ledger.open,null);assert.equal(ledger.history.length,2);
});

// A small native-shaped world: Celadon and Four Island Centers with nurses,
// the Day Care house and the Day Care man.
const world={data:{maps:[
 {id:'MAP_CELADON_CITY_POKEMON_CENTER_1F',objectEvents:[{script:'CeladonCity_PokemonCenter_1F_EventScript_Nurse'}]},
 {id:'MAP_FOUR_ISLAND_POKEMON_CENTER_1F',objectEvents:[{script:'FourIsland_PokemonCenter_1F_EventScript_Nurse'}]},
 {id:'MAP_FOUR_ISLAND_POKEMON_DAY_CARE',objectEvents:[{script:'FourIsland_PokemonDayCare_EventScript_DaycareWoman'}]},
 {id:'MAP_FOUR_ISLAND',objectEvents:[{script:'FourIsland_EventScript_DaycareMan'}]},
]}};
const facts=(id,groups,gender=50)=>({id,eggGroups:groups.map(g=>'EGG_GROUP_'+g),genderRatio:typeof gender==='number'?{call:'PERCENT_FEMALE',args:[gender]}:gender});
const mechanics={data:{species:[facts(9,['MONSTER','WATER_1'],12.5),facts(132,['DITTO'],'MON_GENDERLESS'),facts(16,['FLYING']),facts(3,['MONSTER','GRASS'],12.5)],moves:[{id:33,pp:35},{id:19,pp:15}]}};
const route={needId:'starter-squirtle',mode:'loan',partnerOwner:'firered-partner',sourceLabel:'RED (partner)',subject:{fingerprint:fp(blastoise),species:9,level:70,where:'party'},breed:{speciesId:7,dittoFingerprint:fp(ditto)}};
function mainObservation(){
 return {phase:'stable',frame:1000,emulator:{mode:'overworld',inputReady:true,inBattle:false},sram:{sha256:'a'.repeat(64)},saveAttemptStatus:0,
  playerMemory:{map:{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F'},position:{x:7,y:8},ui:{},gameStats:{savedGame:40},saveAttemptStatus:0,
   storyState:{flagIds:flags},
   trainer:{trainerId:10933,partyValidity:'valid',party:[{...venusaur,slot:0,hp:10}],storage:{validity:'valid',pokemon:[ditto,pidgey,pidgey2],boxCounts:[3,...Array(13).fill(0)]},pokedex:{ownedSpecies:[1,2,3,16,132]},bag:{},money:50000},
   postgameEvidence:{acquisition:{prompt:null,withdrawalCost:100,selectedParent:0,daycare:{validity:'valid',parents:[],pendingEgg:false,menuCursor:null}}}}};
}
const verifiedSave=(o,sha)=>{o.playerMemory.gameStats.savedGame++;o.playerMemory.saveAttemptStatus=1;o.sram.sha256=sha;};
const receipt=(role,owner,legName,pokemon,offered,sha)=>({requestId:`extra-save-starter-squirtle-100-${legName}`,game:'firered',role,owner,leg:'outbound',pairId:'pair-'+legName,pokemon,offeredFingerprint:offered,nativeSaveVerified:true,handshakeVerified:true,linkClosedVerified:true,savedSramSha256:sha});

test('the main save borrows Blastoise, breeds a Squirtle Egg with its own Ditto, returns Blastoise, then hatches and saves',()=>{
 const create=state=>createPostgameAcquisition({kind:'extra-save',requestId:'extra-save-starter-squirtle-100',route,world,mechanics,planner:null,state});
 let task=create();assert.ok(task instanceof ExtraSaveExchangeTask);
 const o=mainObservation(),m=o.playerMemory,t=m.trainer,dc=m.postgameEvidence.acquisition.daycare;
 // Opening leg: the lowest ordinary PC duplicate is withdrawn, the party healed and saved at the Center.
 assert.equal(task.inspect(o).objective.target.kind,'party-roster');
 assert.equal(task.state.placeholder.fingerprint,fp(pidgey));assert.equal(task.state.dirty,false);
 t.party.push({...t.storage.pokemon.splice(1,1)[0],slot:1});
 assert.equal(task.inspect(o).objective.target.kind,'object','heal at the nurse');
 t.party[0].hp=50;task=create(task.state);
 const saving=task.inspect(o);assert.equal(saving.objective.target.kind,'save-game');
 verifiedSave(o,'b'.repeat(64));
 const open=task.inspect(o);
 assert.equal(open.kind,'transfer');assert.equal(open.requestId,'extra-save-starter-squirtle-100-open');assert.equal(open.partnerOwner,'firered-partner');
 assert.deepEqual(open.offer,{schema:'pokemon-suite/extra-save-offer/v1',exchangeId:'extra-save-starter-squirtle-100',mode:'loan',leg:'open',fingerprint:fp(blastoise),expectSource:fp(pidgey)});
 assert.equal(open.tradePreparation.pokemon.personality,pidgey.personality);
 assert.equal(extraSaveLeg({acquisition:task.state,preparation:{...open,kind:'extra-save',phase:'waiting-for-transfer'}})?.partnerOwner,'firered-partner');
 // The link trade: both saves verified. Blastoise registers in the Pokédex.
 const r1=reserveExtraSaveTrade({leg:{...open,kind:'extra-save'},source:open.tradePreparation.pokemon,partner:blastoise,sourceTrainerId:10933,partnerTrainerId:8185,partnerTitle:'firered',sourceFlags:flags,partnerReady:{pokedex:true}});
 t.party[1]={...blastoise,slot:1};t.pokedex.ownedSpecies.push(9);o.sram.sha256='c'.repeat(64);
 const result=sha=>({reservation:r1,outbound:{source:receipt('source','firered','open',t.party[1],fp(pidgey),sha),partner:receipt('partner','firered-partner','open',pidgey,fp(blastoise),'d'.repeat(64))}});
 assert.throws(()=>create(task.state).acceptTrade(result('e'.repeat(64)),o),/current native save/,'the receipt must match the current native save');
 task=create(task.state);task.acceptTrade(result('c'.repeat(64)),o);
 assert.equal(task.state.phase,'daycare');assert.equal(task.state.dirty,true,'a borrowed Pokémon never lets the checklist drop this task');
 // Day Care: deposit Blastoise and the main save's Ditto, receive the Egg, pay both withdrawals.
 m.map.id='MAP_FOUR_ISLAND_POKEMON_DAY_CARE';
 assert.equal(task.inspect(o).objective.target.kind,'party-roster','withdraw the Ditto to deposit both parents');
 t.party.push({...t.storage.pokemon.shift(),slot:2});
 assert.equal(task.inspect(o).objective.target.kind,'object');
 dc.parents=[{...t.party.splice(1,1)[0],slot:0},{...t.party.splice(1,1)[0],slot:1}];task.inspect(o);
 dc.pendingEgg=true;m.map.id='MAP_FOUR_ISLAND';m.ui.choiceMenu={cursor:0,maxCursor:1};m.postgameEvidence.acquisition.prompt='DayCare_Text_DoYouWantEgg';
 assert.equal(task.inspect(o).recommendation?.targetOption,'yes');
 const egg=mon(7,900,{isEgg:true,slot:1});t.party.push(egg);dc.pendingEgg=false;m.ui={};task.inspect(o);task=create(task.state);
 m.map.id='MAP_FOUR_ISLAND_POKEMON_DAY_CARE';const a=m.postgameEvidence.acquisition;
 // Native run 1 (Sept 28): the Day Care's own list menu is not a stable field
 // frame. The Day Care task answers it; the exchange must not wait it out.
 o.phase='transition';dc.menuCursor=1;
 assert.deepEqual(task.inspect(o).action?.buttons,['up'],'the exchange lets the Day Care task answer its withdrawal menu');
 o.phase='stable';dc.menuCursor=null;m.ui.choiceMenu={cursor:0,maxCursor:1};
 a.prompt='DayCare_Text_ItWillCostX';assert.equal(task.inspect(o).recommendation?.targetOption,'yes');
 t.party.push({...dc.parents.shift(),slot:2});t.money-=100;m.ui={};task.inspect(o);
 m.ui.choiceMenu={cursor:0,maxCursor:1};assert.equal(task.inspect(o).recommendation?.targetOption,'yes');
 t.party.push({...dc.parents.shift(),slot:3});t.money-=100;m.ui={};
 // The Egg is secured: Blastoise goes back before the Egg hatches.
 assert.equal(task.inspect(o).kind,'wait');assert.equal(task.state.phase,'closing');assert.equal(task.state.egg,fp(egg));
 m.map.id='MAP_FOUR_ISLAND_POKEMON_CENTER_1F';task=create(task.state);t.party[0].hp=20;
 assert.equal(task.inspect(o).objective.target.kind,'object','heal before the return trade');
 t.party[0].hp=50;task=create(task.state);assert.equal(task.inspect(o).objective.target.kind,'save-game');verifiedSave(o,'f'.repeat(64));
 const close=task.inspect(o);
 assert.equal(close.kind,'transfer');assert.equal(close.requestId,'extra-save-starter-squirtle-100-close');
 assert.deepEqual([close.offer.leg,close.offer.fingerprint,close.offer.expectSource],['close',fp(pidgey),fp(blastoise)]);
 const r2=reserveExtraSaveTrade({leg:{...close,kind:'extra-save'},source:close.tradePreparation.pokemon,partner:pidgey,sourceTrainerId:10933,partnerTrainerId:8185,partnerTitle:'firered',sourceFlags:flags,partnerReady:{pokedex:true}});
 const slot=t.party.findIndex(p=>p.species===9);t.party[slot]={...pidgey,slot};o.sram.sha256='1'.repeat(64);
 task.acceptTrade({reservation:r2,outbound:{source:receipt('source','firered','close',pidgey,fp(blastoise),'1'.repeat(64)),partner:receipt('partner','firered-partner','close',blastoise,fp(pidgey),'2'.repeat(64))}},o);
 assert.equal(task.state.phase,'hatching');
 assert.equal(task.inspect(o).objective.target.kind,'friendship-walk');
 const hatched=t.party.find(p=>p.personality===900);hatched.isEgg=false;t.pokedex.ownedSpecies.push(7);
 // The team the exchange found returns to the party before the final save.
 task=create(task.state);const restore=task.inspect(o);
 assert.equal(restore.objective.target.kind,'party-roster');assert.deepEqual(restore.objective.target.requiredFingerprints,[fp(venusaur)]);
 // Native resume run (Sept 28): inside the PC the frames are not a stable field;
 // the team restore keeps its own objective instead of waiting or draining.
 o.phase='transition';m.ui.storage={stage:'storage-main'};
 const inPc=create(task.state).inspect(o);
 assert.equal(inPc.kind,'policy','the restore keeps driving the PC');assert.equal(inPc.objective.target.kind,'party-roster');
 o.phase='stable';m.ui={};
 const pc=t.storage.pokemon;for(const p of t.party.splice(1))pc.push(p);
 task=create(task.state);assert.equal(task.inspect(o).objective.target.kind,'save-game');
 verifiedSave(o,'3'.repeat(64));
 const done=task.inspect(o);
 assert.equal(done.kind,'complete');assert.deepEqual(done.receipt.registered,[9,7]);assert.equal(done.receipt.nativeSaveVerified,true);
 assert.deepEqual(done.receipt.legs.map(l=>l.leg),['open','close']);assert.equal(task.state.dirty,false);
});

test('nothing leaves the main save unless the Day Care, Ditto, fees and a duplicate are verified first',()=>{
 const create=()=>createPostgameAcquisition({kind:'extra-save',requestId:'extra-save-starter-squirtle-100',route,world,mechanics,planner:null});
 for(const [label,change,reason] of [
  ['daycare occupied',o=>o.playerMemory.postgameEvidence.acquisition.daycare.parents=[mon(19,5)],/Day Care must be empty/],
  ['no fees',o=>o.playerMemory.trainer.money=100,/20,000/],
  ['no ditto',o=>o.playerMemory.trainer.storage.pokemon.shift(),/Ditto/],
  ['no duplicate',o=>o.playerMemory.trainer.storage.pokemon.pop(),/duplicate/],
 ]){const o=mainObservation();change(o);const d=create().inspect(o);assert.equal(d.kind,'stop',label);assert.match(d.reason,reason,label);}
});

test('while the lent Blastoise is in the main save the plan keeps its exchange and names what it is doing',()=>{
 const o=mainObservation();o.playerMemory.trainer.otId=1706568373;
 o.playerMemory.trainer.party.push({...blastoise,slot:1});o.playerMemory.trainer.pokedex.ownedSpecies.push(9);
 const partner={schema:'pokemon-suite/extra-save-inventory/v1',source:{kind:'partner-owner',owner:'firered-partner',label:'RED (partner)',saved:true},lineage:'2161188857',trainerId:8185,map:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F',parked:true,valid:true,starter:'squirtle',
  flags:{pokedex:true,gameClear:true,nationalDex:true,sevii:true},choices:{starter:'squirtle',fossil:'helix',dojoPrizeTaken:true,roamer:{species:243,active:true,used:false}},pokedexOwned:[7,8,9],pokemon:[]};
 const workflow={active:{needId:'starter-squirtle',phase:'daycare',reason:null,borrowed:fp(blastoise)}};
 selectExtraSaveObjective({o,sources:{checkedAt:1,sources:[partner]},available:null,workflow,world});
 const row=workflow.presentation.find(r=>r.needId==='starter-squirtle');
 assert.ok(row,'a borrowed Blastoise is not the main save\'s own Squirtle line');
 assert.match(row.doing,/Day Care/);
});

test('the main save selects an exchange only for a ready route whose partner owner is available',()=>{
 const o=mainObservation();
 const partner={schema:'pokemon-suite/extra-save-inventory/v1',source:{kind:'partner-owner',owner:'firered-partner',label:'RED (partner)',saved:true},lineage:'2161188857',trainerId:8185,map:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F',parked:true,valid:true,starter:'squirtle',
  flags:{pokedex:true,gameClear:true,nationalDex:true,sevii:true},choices:{starter:'squirtle',fossil:'helix',dojoPrizeTaken:true,roamer:{species:243,active:true,used:false}},pokedexOwned:[7,8,9],
  pokemon:[{fingerprint:fp(blastoise),species:9,level:70,shiny:false,isEgg:false,heldItem:0,moves:[57],where:'party',identified:true}]};
 o.playerMemory.trainer.otId=1706568373;
 const workflow={};
 assert.equal(selectExtraSaveObjective({o,sources:{sources:[partner]},available:{available:true,partners:[]},workflow,world}),null,'the partner is not available');
 assert.equal(workflow.presentation.find(r=>r.needId==='starter-squirtle').status,'ready');
 const selected=selectExtraSaveObjective({o,sources:{sources:[partner]},available:{available:true,partners:[{owner:'firered-partner',title:'firered'}]},workflow,world});
 assert.equal(selected.target.kind,'postgame-acquire');assert.equal(selected.acquisition.kind,'extra-save');
 assert.deepEqual(selected.acquisition.route,{needId:'starter-squirtle',mode:'loan',partnerOwner:'firered-partner',sourceLabel:'RED (partner)',subject:{fingerprint:fp(blastoise),species:9,level:70,where:'party'},breed:{speciesId:7,dittoFingerprint:fp(ditto)}});
 workflow.deferred={'starter-squirtle':{retryAt:Date.now()+60000}};
 assert.equal(selectExtraSaveObjective({o,sources:{sources:[partner]},available:{available:true,partners:[{owner:'firered-partner',title:'firered'}]},workflow,world}),null,'a deferred family waits');
});
