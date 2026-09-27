import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createLocalEvolutionWorker} from '../src/suite/local-evolution-worker.js';
import {createNativeLocalLink} from '../src/suite/native-local-link.js';
import {FireRedEvolutionTask,selectTeamPartnerEvolution} from '../src/suite/fire-red-evolution.js';
import {inspectFireRedPartnerReadiness} from '../src/suite/firered-partner.js';
import {partnerHoldings} from '../src/suite/local-evolution.js';

// Two FireRed owners pair through the same role-based coordinator as the
// Emerald companion: the source writes the only pair file, and both native
// links authenticate distinct RFU owner identities.
const ivs={hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6};
const mon=(species,personality,extra={})=>({validity:'valid',species,personality,otId:10,shiny:false,isEgg:false,heldItem:0,level:70,moves:[84],ivs,...extra});
const machoke=mon(67,2,{level:93}),placeholder=mon(82,500,{otId:2161188857}),blastoise=mon(9,501,{otId:2161188857,moves:[57]});
const CENTER='MAP_LAVENDER_TOWN_POKEMON_CENTER_1F';
const world={data:{maps:[{id:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F',objectEvents:[{script:'Common_EventScript_DirectCornerAttendant',x:10,y:2}]}]}};
const peripheral=()=>({status:()=>({attached:true,epoch:1,dropped:0,mode:0}),subscribe:()=>()=>{},receive(){}});
const session={readMemory:()=>Uint8Array.of(0),attachWireless:peripheral};
const inputs={runtime:{data:{symbols:{gWirelessCommType:{address:1},gReceivedRemoteLinkPlayers:{address:2}}}},world};

function setup(t,{partnerTrainerId=8185,liveShape=false}={}){
 const directory=mkdtempSync(join(tmpdir(),'firered-partner-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const name of ['firered','firered-partner','core','base-core'])mkdirSync(join(directory,name));
 writeFileSync(join(directory,'core','build-manifest.json'),JSON.stringify({native_rfu:true}));
 writeFileSync(join(directory,'base-core','build-manifest.json'),JSON.stringify({}));
 // The live partner entry mirrors FireRed's: a stock base core plus its native link pair.
 const partnerCfg=liveShape?{title:'firered',role:'partner',core:join(directory,'base-core'),nativeRadio:{core:join(directory,'core')}}:{title:'firered',role:'partner',core:join(directory,'core')};
 const config={directory,games:{firered:{core:join(directory,'core')},'firered-partner':partnerCfg}};
 const route=selectTeamPartnerEvolution({trainer:{partyValidity:'valid',party:[mon(22,1),machoke],storage:{validity:'valid',pokemon:[]},bag:{}},partnerAvailable:{available:true,partners:[{owner:'firered-partner',title:'firered'}]},teamPlan:{permanentFamilies:[[66,67,68],[21,22]]}});
 const evolution=new FireRedEvolutionTask(route).state;
 const partnerTrainer={trainerId:partnerTrainerId,partyValidity:'valid',party:[blastoise,placeholder],storage:{validity:'valid',pokemon:[]}};
 const preparation={requestId:route.requestId,owner:'firered-partner',sourceOwner:'firered',phase:'ready-for-transfer',center:CENTER,trainerId:partnerTrainerId,pokedex:true,nationalDex:true,transferCandidate:placeholder,holdings:partnerHoldings(partnerTrainer)};
 writeFileSync(join(directory,'firered-partner','status.json'),JSON.stringify({game:'firered',owner:'firered-partner',bot:{enabled:true,preparation}}));
 writeFileSync(join(directory,'firered','status.json'),JSON.stringify({game:'firered',owner:'firered',bot:{enabled:true}}));
 let release=null;
 const hooks=extra=>({enabled:()=>true,pause:async()=>{},persist(){},progress(){},startEngine(){},finishEngine(){release?.();release=null;},engine:()=>({execute:()=>new Promise(resolve=>{release=resolve;})}),...extra});
 const source=createLocalEvolutionWorker({game:'firered',owner:'firered',role:'source',config,session,coreManifest:{native_rfu:true},inputs,hooks:hooks({
  observe:()=>({playerMemory:{storyState:{flagIds:{2092:true,2112:true}},trainer:{trainerId:10933,partyValidity:'valid',party:[mon(22,1),machoke]}}}),
  fireRedState:()=>({dexEvolution:evolution,preparation:{phase:'waiting-for-transfer',tradePreparation:{pokemon:machoke,center:CENTER}}})})});
 const partner=createLocalEvolutionWorker({game:'firered',owner:'firered-partner',role:'partner',config,session,coreManifest:{native_rfu:true},inputs,hooks:hooks({
  observe:()=>({playerMemory:{trainer:partnerTrainer}}),companionState:()=>preparation})});
 t.after(async()=>{await source.stop('Test ended',{shutdown:true});await partner.stop('Test ended',{shutdown:true});});
 return {directory,route,source,partner};
}

test('a FireRed source reserves the FireRed partner with both owners and trainer IDs, and both links authenticate as distinct owners',async t=>{
 const {directory,route,source,partner}=setup(t);
 await source.poll();
 assert.equal(source.state()?.phase,'connecting',source.state()?.reason);
 const pair=JSON.parse(readFileSync(join(directory,'evolution-pairs',`${route.requestId}.json`)));
 assert.equal(pair.schema,'pokemon-suite/local-evolution-pair/v2');
 assert.deepEqual(pair.reservation.roles,{source:{owner:'firered',title:'firered',trainerId:10933},partner:{owner:'firered-partner',title:'firered',trainerId:8185}});
 assert.equal(pair.leaderTrainerId,10933);assert.ok(pair.port>0);
 // A legacy (title-only) guest cannot join the owner-authenticated leader.
 const legacy=await createNativeLocalLink({role:'guest',game:'firered',peerGame:'emerald',pairId:pair.pairId,token:pair.token,port:pair.port,peripheral:peripheral()});t.after(()=>legacy.close());
 for(let i=0;i<100&&!legacy.status().reason;i++)await sleep(10);
 assert.ok(legacy.status().reason,'the v1 hello is rejected');
 await partner.poll();
 assert.equal(partner.state()?.phase,'connecting',partner.state()?.reason);assert.equal(partner.state().trade.role,'guest');assert.equal(partner.state().trade.peerTrainerId,10933);
 for(let i=0;i<100&&source.state().phase!=='trading';i++){await sleep(10);await source.poll();}
 assert.equal(source.state().phase,'trading','the source authenticated the FireRed partner owner');
});

test('the source checks the FireRed partner\'s native link core, not its stock base core',async t=>{
 const {directory,route,source}=setup(t,{liveShape:true});
 await source.poll();
 assert.equal(source.state()?.phase,'connecting',source.state()?.reason);
 assert.ok(existsSync(join(directory,'evolution-pairs',`${route.requestId}.json`)));
});

test('a FireRed partner with the same trainer ID as the source is refused before any link opens',async t=>{
 const {directory,route,source}=setup(t,{partnerTrainerId:10933});
 await source.poll();
 assert.equal(source.state(),null);
 assert.equal(existsSync(join(directory,'evolution-pairs',`${route.requestId}.json`)),false);
});

const stable=(map,party,storage,flags={2092:true,2112:true},trainerId=8185)=>({phase:'stable',emulator:{mode:'overworld',callback2:'CB2_Overworld'},playerMemory:{map:{id:map},ui:{},storyState:{flagIds:flags},trainer:{trainerId,partyValidity:'valid',party,storage:{validity:'valid',pokemon:storage}}}});
test('the FireRed partner is ready only from its own Pokémon Center native save with an ordinary placeholder',()=>{
 const map='MAP_LAVENDER_TOWN_POKEMON_CENTER_2F',party=[blastoise,placeholder,mon(113,3,{shiny:true})],pc=[mon(150,9),mon(25,10)];
 const args=(live,saved=live)=>({live,saved,world,owner:'firered-partner',requestId:'team-partner-10-2-68',sramSha256:'c'.repeat(64)});
 const ready=inspectFireRedPartnerReadiness(args(stable(map,party,pc)));
 assert.equal(ready.phase,'ready-for-transfer',ready.reason);assert.equal(ready.transferCandidate.personality,500);assert.equal(ready.center,CENTER);
 assert.equal(ready.trainerId,8185);assert.equal(ready.pokedex,true);assert.equal(ready.nationalDex,true);assert.equal(ready.sourceOwner,'firered');
 assert.deepEqual(ready.holdings,partnerHoldings(stable(map,party,pc).playerMemory.trainer));
 for(const [label,value] of [
  ['outside a center',args(stable('MAP_LAVENDER_TOWN',party,pc))],
  ['unsaved party change',args(stable(map,party,pc),stable(map,[blastoise,mon(82,777,{otId:2161188857})],pc))],
  ['unsaved PC change',args(stable(map,party,pc),stable(map,party,[mon(150,9)]))],
  ['no Pokédex',args(stable(map,party,pc,{}))],
  ['no ordinary placeholder',args(stable(map,[blastoise,mon(113,3,{shiny:true}),mon(150,4)],pc))],
  ['busy UI',args({...stable(map,party,pc),playerMemory:{...stable(map,party,pc).playerMemory,ui:{startMenu:true}}})],
 ])assert.equal(inspectFireRedPartnerReadiness(value).phase,'waiting',label);
 assert.throws(()=>inspectFireRedPartnerReadiness({...args(stable(map,party,pc)),owner:'firered'}),/source/);
});
