import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createLocalEvolutionWorker} from '../src/suite/local-evolution-worker.js';
import {inspectFireRedPartnerReadiness} from '../src/suite/firered-partner.js';
import {partnerHoldings} from '../src/suite/local-evolution.js';
import {reserveExtraSaveTrade,emptyPartnerLedger} from '../src/suite/extra-save-exchange.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// An extra-save leg uses the same two-owner native link as trade evolutions:
// the source writes the only pair file, both owners authenticate, and each
// side offers exactly the individual the leg names. The lent Blastoise knows
// HMs, so it is never an ordinary placeholder, yet it is a valid loan subject.
const ivs={hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6};
const mon=(species,personality,extra={})=>({validity:'valid',species,personality,otId:10,shiny:false,isEgg:false,heldItem:0,level:30,moves:[33],ivs,...extra});
const fp=encounterFingerprint;
const blastoise=mon(9,501,{otId:2161188857,level:70,moves:[57,127]}),placeholder=mon(82,500,{otId:2161188857}),pidgey=mon(16,11,{level:3});
const CENTER='MAP_LAVENDER_TOWN_POKEMON_CENTER_1F';
const world={data:{maps:[{id:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F',objectEvents:[{script:'Common_EventScript_DirectCornerAttendant',x:10,y:2}]}]}};
const peripheral=()=>({status:()=>({attached:true,epoch:1,dropped:0,mode:0}),subscribe:()=>()=>{},receive(){}});
const session={readMemory:()=>Uint8Array.of(0),attachWireless:peripheral};
const inputs={runtime:{data:{symbols:{gWirelessCommType:{address:1},gReceivedRemoteLinkPlayers:{address:2}}}},world};
const offer={schema:'pokemon-suite/extra-save-offer/v1',exchangeId:'extra-save-starter-squirtle-100',mode:'loan',leg:'open',fingerprint:fp(blastoise),expectSource:fp(pidgey)};
const leg={requestId:'extra-save-starter-squirtle-100-open',kind:'extra-save',automatic:true,partnerOwner:'firered-partner',offer,phase:'waiting-for-transfer',tradePreparation:{pokemon:pidgey,center:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F'}};
const partnerTrainer={trainerId:8185,partyValidity:'valid',party:[blastoise,placeholder],storage:{validity:'valid',pokemon:[mon(143,700,{otId:2161188857})]}};
const preparation={requestId:leg.requestId,owner:'firered-partner',sourceOwner:'firered',phase:'ready-for-transfer',center:CENTER,trainerId:8185,pokedex:true,nationalDex:true,transferCandidate:blastoise,offer,holdings:partnerHoldings(partnerTrainer)};

function setup(t,{sourceState=null,partnerState=null,accepted=[]}={}){
 const directory=mkdtempSync(join(tmpdir(),'extra-save-worker-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const name of ['firered','firered-partner','core'])mkdirSync(join(directory,name));
 writeFileSync(join(directory,'core','build-manifest.json'),JSON.stringify({native_rfu:true}));
 const config={directory,games:{firered:{core:join(directory,'core')},'firered-partner':{title:'firered',role:'partner',core:join(directory,'core'),nativeRadio:{core:join(directory,'core')}}}};
 writeFileSync(join(directory,'firered-partner','status.json'),JSON.stringify({game:'firered',owner:'firered-partner',bot:{enabled:true,preparation}}));
 writeFileSync(join(directory,'firered','status.json'),JSON.stringify({game:'firered',owner:'firered',bot:{enabled:true}}));
 let release=null;
 const hooks=extra=>({enabled:()=>true,pause:async()=>{},persist(){},progress(){},startEngine(){},finishEngine(){release?.();release=null;},engine:()=>({execute:()=>new Promise(resolve=>{release=resolve;})}),...extra});
 const mainTrainer={trainerId:10933,partyValidity:'valid',party:[mon(3,1),pidgey],storage:{validity:'valid',pokemon:[]}};
 const source=createLocalEvolutionWorker({game:'firered',owner:'firered',role:'source',config,session,coreManifest:{native_rfu:true},inputs,state:sourceState,hooks:hooks({
  observe:()=>({playerMemory:{storyState:{flagIds:{2092:true,2112:true}},trainer:mainTrainer}}),
  fireRedState:()=>({acquisition:{kind:'extra-save',requestId:'extra-save-starter-squirtle-100'},preparation:leg}),
  acceptExtraSaveTrade:async(result,o)=>{accepted.push({result,o});}})});
 const partner=createLocalEvolutionWorker({game:'firered',owner:'firered-partner',role:'partner',config,session,coreManifest:{native_rfu:true},inputs,state:partnerState,hooks:hooks({
  observe:()=>({playerMemory:{trainer:partnerState?{...partnerTrainer,party:[pidgey,placeholder]}:partnerTrainer}}),companionState:()=>preparation,extraSaveLedger:()=>emptyPartnerLedger()})});
 t.after(async()=>{await source.stop('Test ended',{shutdown:true});await partner.stop('Test ended',{shutdown:true});});
 return {directory,source,partner};
}

test('the source reserves a single extra-save leg and the FireRed partner joins offering the named Blastoise',async t=>{
 const {directory,source,partner}=setup(t);
 await source.poll();
 assert.equal(source.state()?.phase,'connecting',source.state()?.reason);
 const pair=JSON.parse(readFileSync(join(directory,'evolution-pairs',`${leg.requestId}.json`)));
 assert.equal(pair.schema,'pokemon-suite/local-evolution-pair/v2');assert.equal(pair.reservation.method,'single');
 assert.deepEqual(pair.reservation.exchange,{exchangeId:offer.exchangeId,mode:'loan',leg:'open'});
 assert.equal(pair.reservation.sourceFingerprint,fp(pidgey));assert.equal(pair.reservation.partnerFingerprint,fp(blastoise));
 assert.deepEqual(pair.reservation.roles.partner,{owner:'firered-partner',title:'firered',trainerId:8185});
 assert.equal(pair.center,CENTER);
 await partner.poll();
 assert.equal(partner.state()?.phase,'connecting',partner.state()?.reason);assert.equal(partner.state().trade.role,'guest');
 for(let i=0;i<100&&source.state().phase!=='trading';i++){await sleep(10);await source.poll();}
 assert.equal(source.state().phase,'trading',source.state().reason+' partner:'+partner.state()?.phase+' '+partner.state()?.reason);
});

test('a partner that no longer holds the named individual never joins the leg',async t=>{
 const {source,partner}=setup(t);
 await source.poll();assert.equal(source.state()?.phase,'connecting');
 partnerTrainer.party.splice(0,1);t.after(()=>partnerTrainer.party.unshift(blastoise));
 await partner.poll();
 assert.equal(partner.state()?.phase??null,null,'the partner refuses to start the leg');
});

const receipt=(role,owner,pokemon,offered,sha)=>({requestId:leg.requestId,game:'firered',role,owner,leg:'outbound',pairId:'pair-1',pokemon,offeredFingerprint:offered,nativeSaveVerified:true,handshakeVerified:true,linkClosedVerified:true,savedSramSha256:sha});
test('after both native saves verify, the source hands the leg to its exchange and the partner proves its holdings',async t=>{
 const reservation=reserveExtraSaveTrade({leg,source:pidgey,partner:blastoise,sourceTrainerId:10933,partnerTrainerId:8185,partnerTitle:'firered',sourceFlags:{2092:true,2112:true},partnerReady:{pokedex:true,nationalDex:true}});
 const sourceReceipt=receipt('source','firered',blastoise,fp(pidgey),'a'.repeat(64)),partnerReceipt=receipt('partner','firered-partner',pidgey,fp(blastoise),'b'.repeat(64));
 const base={requestId:leg.requestId,reservation,pairId:'pair-1',leg:'outbound',phase:'waiting-for-peer-save'};
 const accepted=[];
 const {directory,source,partner}=setup(t,{sourceState:{...base,receipt:sourceReceipt},partnerState:{...base,receipt:partnerReceipt},accepted});
 mkdirSync(join(directory,'evolution-pairs'));
 const pair={schema:'pokemon-suite/local-evolution-pair/v2',requestId:leg.requestId,reservation,pairId:'pair-1',leg:'outbound',phase:'connecting',center:CENTER};
 writeFileSync(join(directory,'evolution-pairs',`${leg.requestId}.json`),JSON.stringify(pair));
 writeFileSync(join(directory,'firered-partner','status.json'),JSON.stringify({game:'firered',owner:'firered-partner',bot:{enabled:true,preparation},localEvolution:{requestId:leg.requestId,phase:'waiting-for-peer-save',receipt:partnerReceipt}}));
 await source.poll();
 assert.equal(source.state().phase,'complete',source.state().reason);
 assert.equal(accepted.length,1);assert.deepEqual(Object.keys(accepted[0].result.outbound).sort(),['partner','source']);
 const written=JSON.parse(readFileSync(join(directory,'evolution-pairs',`${leg.requestId}.json`)));
 assert.equal(written.phase,'complete','a single leg has no evolution or return leg');
 await partner.poll();
 assert.equal(partner.state().phase,'complete',partner.state().reason);
 assert.equal(partner.state().exchangeProof.leg,'open');assert.equal(partner.state().exchangeProof.lent,fp(blastoise));assert.equal(partner.state().exchangeProof.netZeroVerified,false);
});

const stable=(map,party,storage,flags={2092:true,2112:true})=>({phase:'stable',emulator:{mode:'overworld',callback2:'CB2_Overworld'},playerMemory:{map:{id:map},ui:{},storyState:{flagIds:flags},trainer:{trainerId:8185,partyValidity:'valid',party,storage:{validity:'valid',pokemon:storage}}}});
test('the FireRed partner readiness serves a named offer, and refuses other work while a loan is open',()=>{
 const map='MAP_LAVENDER_TOWN_POKEMON_CENTER_2F',party=[blastoise,placeholder],pc=[mon(143,700)];
 const args=(extra={})=>({live:stable(map,party,pc),saved:stable(map,party,pc),world,owner:'firered-partner',requestId:leg.requestId,sramSha256:'c'.repeat(64),...extra});
 const ready=inspectFireRedPartnerReadiness(args({offer,ledger:emptyPartnerLedger()}));
 assert.equal(ready.phase,'ready-for-transfer',ready.reason);assert.equal(ready.transferCandidate.personality,501);assert.deepEqual(ready.offer,offer);
 assert.equal(inspectFireRedPartnerReadiness(args()).transferCandidate.personality,500,'without an offer the ordinary placeholder is unchanged');
 const shiny={...offer,fingerprint:fp(mon(9,777,{otId:2161188857,shiny:true}))};
 assert.equal(inspectFireRedPartnerReadiness(args({offer:shiny,ledger:emptyPartnerLedger()})).phase,'waiting');
 const lending={...emptyPartnerLedger(),open:{exchangeId:'extra-save-other-1',mode:'loan',lent:fp(blastoise),received:fp(pidgey)}};
 const busy=inspectFireRedPartnerReadiness(args({ledger:lending}));
 assert.equal(busy.phase,'waiting');assert.match(busy.reason,/lending/);
});
