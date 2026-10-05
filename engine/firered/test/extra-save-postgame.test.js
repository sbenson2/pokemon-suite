import test from 'node:test';
import assert from 'node:assert/strict';
import * as postgame from '../src/suite/postgame.js';
import {postgameChecklist} from '../src/suite/postgame-agenda.js';
import {reserveExtraSaveTrade} from '../src/suite/extra-save-exchange.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// The postgame owns the exchange as an acquisition: a leg waits as a partner
// transfer (the host prepares the named partner), a verified leg resumes the
// checklist, a clean opening leg defers only its family, and a borrowed
// Pokémon never lets the exchange be dropped.
const ivs={hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6};
const mon=(species,personality,extra={})=>({slot:0,validity:'valid',species,personality,otId:77,shiny:false,isEgg:false,heldItem:0,level:30,hp:50,maxHp:50,status1:0,friendship:70,moves:[33],pp:[35],ivs,...extra});
const fp=encounterFingerprint;
const blastoise=mon(9,501,{otId:2161188857,level:70}),pidgey=mon(16,11,{level:3}),pidgey2=mon(16,12,{level:4}),ditto=mon(132,13),venusaur=mon(3,14,{moves:[19],pp:[15]});
const world={data:{maps:[{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F',objectEvents:[{script:'CeladonCity_PokemonCenter_1F_EventScript_Nurse'}]}]}};
const args={world,story:{data:{scripts:[]}},mechanics:{data:{species:[],moves:[{id:33,pp:35},{id:19,pp:15}]}}};
const route={needId:'starter-squirtle',mode:'loan',partnerOwner:'firered-partner',sourceLabel:'RED (partner)',subject:{fingerprint:fp(blastoise),species:9,level:70,where:'party'},breed:{speciesId:7,dittoFingerprint:fp(ditto)}};
const o=()=>({phase:'stable',frame:100,emulator:{mode:'overworld',inBattle:false,inputReady:true,callback2:'CB2_Overworld'},sram:{sha256:'a'.repeat(64)},
 playerMemory:{map:{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F'},ui:{},saveAttemptStatus:1,storyState:{flagIds:{2089:true,2092:true,2112:true,2116:true}},gameStats:{savedGame:10},
  trainer:{trainerId:10933,otId:1706568373,partyValidity:'valid',party:[venusaur,{...pidgey,slot:1}],pokedex:{ownedSpecies:[1,2,3,16,132]},storage:{validity:'valid',pokemon:[ditto,pidgey2],boxCounts:[2,...Array(13).fill(0)]},money:50000,bag:{}},
  postgameEvidence:{acquisition:{prompt:null,daycare:{validity:'valid',parents:[],pendingEgg:false,menuCursor:null}}}}});
const offer={schema:'pokemon-suite/extra-save-offer/v1',exchangeId:'extra-save-starter-squirtle-100',mode:'loan',leg:'open',fingerprint:fp(blastoise),expectSource:fp(pidgey)};
// The exchange has saved at the Center and its opening leg is ready for the partner.
const readyTask=()=>({schema:'pokemon-suite/native-acquisition/v1',kind:'extra-save',requestId:'extra-save-starter-squirtle-100',route,phase:'opening',protectedFingerprints:[],
 placeholder:{fingerprint:fp(pidgey),species:16,pokemon:pidgey},transfer:{requestId:'extra-save-starter-squirtle-100-open',fingerprint:fp(pidgey),center:'MAP_CELADON_CITY_POKEMON_CENTER_1F',nurseIndex:0,phase:'ready',saveBaseline:{counter:9,sha256:'9'.repeat(64)},pokemon:{...pidgey,slot:1},nativeSaveVerified:true},
 pendingLeg:{requestId:'extra-save-starter-squirtle-100-open',leg:'open',expectSource:fp(pidgey),expectPartner:fp(blastoise)},legs:[],daycare:null,egg:null,daycareSkipped:null,dirty:false,receipt:null});

test('an extra-save leg waits as a named partner transfer, and the verified leg resumes the exchange',()=>{
 let c=postgame.createPostgameController({...args,state:{schema:'pokemon-suite/postgame/v1',acquisition:readyTask()}});
 const obs=o(),d=c.decide(obs);
 assert.equal(d.kind,'blocked',d.reason);
 const p=c.state().preparation;
 assert.deepEqual([p.kind,p.phase,p.automatic,p.partnerOwner,p.requestId],['extra-save','waiting-for-transfer',true,'firered-partner','extra-save-starter-squirtle-100-open']);
 assert.deepEqual(p.offer,offer);assert.equal(p.tradePreparation.pokemon.personality,pidgey.personality);
 assert.equal(c.state().agenda.workflows?.extraSaves?.active?.needId,'starter-squirtle');
 c=postgame.createPostgameController({...args,state:JSON.parse(JSON.stringify(c.state()))});
 const r=reserveExtraSaveTrade({leg:p,source:p.tradePreparation.pokemon,partner:blastoise,sourceTrainerId:10933,partnerTrainerId:8185,partnerTitle:'firered',sourceFlags:obs.playerMemory.storyState.flagIds,partnerReady:{pokedex:true}});
 const receipt=(role,owner,pokemon,offered,sha)=>({requestId:p.requestId,game:'firered',role,owner,leg:'outbound',pairId:'pair-1',pokemon,offeredFingerprint:offered,nativeSaveVerified:true,handshakeVerified:true,linkClosedVerified:true,savedSramSha256:sha});
 obs.playerMemory.trainer.party[1]={...blastoise,slot:1};obs.playerMemory.trainer.pokedex.ownedSpecies.push(9);obs.sram.sha256='c'.repeat(64);
 c.acceptExtraSaveTrade({reservation:r,outbound:{source:receipt('source','firered',blastoise,fp(pidgey),'c'.repeat(64)),partner:receipt('partner','firered-partner',pidgey,fp(blastoise),'d'.repeat(64))}},obs);
 assert.equal(c.state().acquisition.phase,'daycare');assert.equal(c.state().acquisition.dirty,true);
 assert.deepEqual(c.state().preparation,{kind:'postgame',phase:'complete'});assert.notEqual(c.state().status,'waiting');
 assert.equal(c.canYield(obs),false,'a borrowed Pokémon holds the checklist until it returns');
});

test('a partner that is unavailable for a clean opening leg defers only that family; a borrowed Pokémon keeps waiting',()=>{
 let c=postgame.createPostgameController({...args,clock:()=>1000,state:{schema:'pokemon-suite/postgame/v1',acquisition:readyTask()}});
 c.decide(o());
 c.deferExtraSave('The FireRed partner was stopped.');
 assert.equal(c.state().acquisition,null);assert.deepEqual(c.state().preparation,{kind:'postgame',phase:'complete'});
 assert.equal(c.state().agenda.workflows.extraSaves.deferred['starter-squirtle'].retryAt,301000);
 const borrowed={...readyTask(),phase:'closing',dirty:true,pendingLeg:{...readyTask().pendingLeg,requestId:'extra-save-starter-squirtle-100-close',leg:'close',expectSource:fp(blastoise),expectPartner:fp(pidgey)},
  transfer:{...readyTask().transfer,requestId:'extra-save-starter-squirtle-100-close',fingerprint:fp(blastoise),pokemon:{...blastoise,slot:1}}};
 c=postgame.createPostgameController({...args,clock:()=>1000,state:{schema:'pokemon-suite/postgame/v1',acquisition:borrowed}});
 const obs=o();obs.playerMemory.trainer.party[1]={...blastoise,slot:1};
 assert.equal(c.decide(obs).kind,'blocked');
 c.deferExtraSave('The FireRed partner was stopped.');
 assert.equal(c.state().acquisition.phase,'closing','the return is never abandoned');
 assert.equal(c.state().preparation.phase,'waiting-for-transfer');assert.match(c.state().preparation.reason,/stopped/);
});

test('a clean exchange that cannot start is dropped and deferred without stopping the checklist',()=>{
 const task={...readyTask(),phase:'preparing',placeholder:null,transfer:null,pendingLeg:null};
 const c=postgame.createPostgameController({...args,clock:()=>1000,state:{schema:'pokemon-suite/postgame/v1',agenda:{enabled:true,active:null,entries:[],failures:{}},acquisition:task}});
 const obs=o();obs.playerMemory.trainer.storage.pokemon.pop();obs.playerMemory.trainer.party.pop();// no duplicate left to offer
 assert.equal(c.decide(obs).kind,'resample');
 assert.equal(c.state().acquisition,null);assert.notEqual(c.state().status,'waiting');
 assert.match(c.state().agenda.workflows.extraSaves.deferred['starter-squirtle'].reason,/duplicate/);
});

test('with no local work selectable, the postgame asks the extra-save plan and starts the ready exchange',()=>{
 const partner={schema:'pokemon-suite/extra-save-inventory/v1',source:{kind:'partner-owner',owner:'firered-partner',label:'RED (partner)',saved:true},lineage:'2161188857',trainerId:8185,map:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F',parked:true,valid:true,starter:'squirtle',
  flags:{pokedex:true,gameClear:true,nationalDex:true,sevii:true},choices:{starter:'squirtle',fossil:'helix',dojoPrizeTaken:true,roamer:{species:243,active:true,used:false}},pokedexOwned:[7,8,9],
  pokemon:[{fingerprint:fp(blastoise),species:9,level:70,shiny:false,isEgg:false,heldItem:0,moves:[57],where:'party',identified:true}]};
 // Every local checklist entry is waiting on a retry, so nothing local is selectable.
 const failures=Object.fromEntries(postgameChecklist(o(),{},null).map(e=>[e.id,{retryAt:Date.now()+3600000,reason:'Waiting in this test.'}]));
 const c=postgame.createPostgameController({...args,state:{schema:'pokemon-suite/postgame/v1',agenda:{enabled:true,active:null,entries:[],failures},preparation:{kind:'postgame',phase:'complete'}}});
 c.setExtraSaveSources({schema:'pokemon-suite/extra-save-sources/v1',checkedAt:1,sources:[partner],helpers:[]});
 c.setPartnerAvailability({available:true,partners:[{owner:'firered-partner',title:'firered'}]});
 const obs=o();
 let d;for(let i=0;i<4&&d?.kind!=='postgame-acquisition-started';i++)d=c.decide(obs);
 assert.equal(d.kind,'postgame-acquisition-started',d.reason);
 assert.equal(c.state().acquisition.kind,'extra-save');assert.equal(c.state().acquisition.route.needId,'starter-squirtle');
 assert.ok(c.state().agenda.workflows.extraSaves.presentation.some(r=>r.needId==='starter-squirtle'&&r.status==='ready'));
});
