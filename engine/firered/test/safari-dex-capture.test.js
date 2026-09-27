import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSuiteMission} from '../src/suite/mission.js';
import * as capture from '../src/rng/safari-capture-plan.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// Live September 24 stop (build 108): the National Dex checklist hunted Nidoran♂ in the
// Safari Zone Center. The RNG plan produced the exact target (non-shiny, request shiny
// "any"), the hunt protected it, and the protected Safari capture refused it as
// "The protected encounter is unreadable" because it admitted only shinies.
const request={schema:'pokemon-suite/farming-request/v1',game:'firered',speciesId:32,quantity:1,locationId:'any',shiny:'any',natures:[],gender:'any',abilityId:null,
 ball:{id:'any',requirement:'preferred'},minIvs:{},minDvs:{},encounterLevel:{min:1,max:100},finalLevel:null,moves:[],heldItemId:null,
 limits:{maxEncounters:10000,maxMinutes:120,minBalls:10,maxSpend:999999},afterCompletion:'stop-save'};
const route={speciesId:32,nativeSpecies:32,map:'MAP_SAFARI_ZONE_CENTER',method:'safari-land',share:20,weight:420,here:false,name:'nidoran_m'};
const mechanics={data:{species:[{id:32,name:'SPECIES_NIDORAN_M',genderRatio:'MON_MALE',abilities:['ABILITY_POISON_POINT','ABILITY_NONE']},{id:102,name:'SPECIES_EXEGGCUTE',abilities:['ABILITY_CHLOROPHYLL','ABILITY_NONE']}]}};
const world={data:{wildEncounters:[{map:'MAP_SAFARI_ZONE_CENTER',base_label:'sSafariZone_Center_FireRed',land_mons:{mons:[{species:'SPECIES_NIDORAN_M',min_level:22,max_level:22},{species:'SPECIES_EXEGGCUTE',min_level:24,max_level:24}]}}]}};
const nidoran={validity:'valid',species:32,level:22,shiny:false,shinyValue:41276,isEgg:false,personality:2363122411,otId:1706568373,
 ivs:{hp:6,attack:14,defense:25,speed:31,spAttack:28,spDefense:30},nature:{id:11,name:'Hasty'},abilityNum:0};
const fingerprint=encounterFingerprint(nidoran);
const anchor={stateSha256:'4aa4de3a',sramSha256:'be464c4a'};
const mission=(stateDelta={},requestDelta={})=>{
 const m=createSuiteMission({id:'postgame-national-collection-3542a201',request:{...request,...requestDelta},route,world,mechanics});
 Object.assign(m.state,{phase:'capturing',encounters:1,recent:[fingerprint],protected:true,inEncounter:true,foundSpecies:32,postgameObjective:'national-collection',
  protectedAnchor:anchor,status:'blocked',reason:'The protected encounter is unreadable'},stateDelta);
 return m;
};
const observation=({pokemon=nidoran,flags=132,inBattle=true,sram=anchor.sramSha256,phase='transition',validity='valid',owned=[]}={})=>({
 phase,sram:{sha256:sram},emulator:{inBattle,mode:inBattle?'battle':'overworld',inputReady:true},
 playerMemory:{map:{id:'MAP_SAFARI_ZONE_CENTER'},battleTypeFlags:inBattle?flags:0,encounter:inBattle?{kind:'wild',validity,pokemon}:null,
  safari:{validity:'valid',balls:30,steps:595,rocks:0,bait:0,escapeFactor:3,catchFactor:18},
  trainer:{partyValidity:'valid',party:[],storage:{validity:'valid',boxCounts:Array(14).fill(0),pokemon:owned}}}});
const args=(m,o=observation(),evidence=null)=>({observation:o,state:m.state,request:m.request,matches:p=>m.matches(p),evidence});

test('a readable, requested non-shiny Safari target is admitted to the qualified Safari capture',()=>{
 const m=mission();
 assert.equal(m.matches(nidoran),true,'the live Nidoran♂ is the hunt target');
 assert.equal(m.captureRequirements().safari,true);
 assert.equal(capture.requestedSafariTarget(args(m)),true);
});

test('the requested-target admission keeps every other Safari encounter out',()=>{
 const m=mission();
 const refused=[
  ['a shiny-required request',args(mission({},{shiny:'required'}))],
  ['another species',args(m,observation({pokemon:{...nidoran,species:102,personality:5}}))],
  ['an unprotected hunt',args(mission({protected:false}))],
  ['a Sweet Scent utility capture',args(mission({utilityCapture:true}))],
  ['a wild-land hunt',{...args(m),state:{...m.state,method:'wild-land'}}],
  ['an ordinary battle (not Safari)',args(m,observation({flags:4}))],
  ['outside battle',args(m,observation({inBattle:false}))],
  ['an unreadable encounter',args(m,observation({validity:'unknown'}))],
  ['an unreadable individual',args(m,observation({pokemon:{...nidoran,validity:'unknown'}}))],
  ['an unknown shiny state',args(m,observation({pokemon:{...nidoran,shiny:undefined}}))],
  ['an Egg',args(m,observation({pokemon:{...nidoran,isEgg:true}}))],
  // Shinies keep their own, unchanged admission (pokemon.shiny); they are not "ordinary".
  ['a shiny',args(m,observation({pokemon:{...nidoran,shiny:true}}))],
  ['a missing identity matcher',{...args(m),matches:undefined}],
 ];
 for(const [label,value] of refused)assert.equal(capture.requestedSafariTarget(value),false,label);
 // The predicate's own guards hold even if an identity matcher were too permissive.
 const any=()=>true,required=mission({},{shiny:'required'});
 assert.equal(capture.requestedSafariTarget({...args(required),matches:any}),false,'a shiny-required request, permissive matcher');
 assert.equal(capture.requestedSafariTarget({...args(m,observation({pokemon:{...nidoran,isEgg:true}})),matches:any}),false,'an Egg, permissive matcher');
 assert.equal(capture.requestedSafariTarget({...args(m),matches:()=>'yes'}),false,'only an explicit true match admits');
});

test('the retained build-108 stop is resumable only at its exact, unsaved, uncaught protected encounter',()=>{
 const m=mission();
 assert.equal(capture.resumableSafariTargetStop(args(m)),true,'the live checkpoint (battle intro fade) is resumable');
 assert.equal(capture.resumableSafariTargetStop(args(m,observation({phase:'stable'}))),true);
 const refused=[
  ['a running mission',args(mission({status:'running'}))],
  ['a different stop reason',args(mission({reason:'No first-ball timing passed qualification; the protected encounter is preserved'}))],
  ['a failed capture replay',args(mission({reason:'The capture replay did not verify the protected Pokémon. Its checkpoint is preserved.'}))],
  ['a completed capture plan',args(mission({capturePlan:{completed:true}}))],
  ['a changed native save',args(m,observation({sram:'another-save'}))],
  ['no protected anchor',args(mission({protectedAnchor:null}))],
  ['another individual of the species',args(m,observation({pokemon:{...nidoran,personality:7}}))],
  ['an owned copy',args(m,observation({owned:[nidoran]}))],
  ['unknown storage',{...args(m),observation:{...observation(),playerMemory:{...observation().playerMemory,trainer:{partyValidity:'valid',party:[],storage:{validity:'unknown'}}}}}],
  ['a caught receipt',args(m,observation(),{fingerprint,caught:true})],
  ['a post-catch receipt',args(m,observation(),{fingerprint,postCatch:true})],
  ['a saved receipt',args(m,observation(),{fingerprint,nativeSaveVerified:true})],
  ['outside the Safari battle',args(m,observation({inBattle:false}))],
  ['a shiny-required request',args(mission({},{shiny:'required'}))],
  ['an unreadable encounter',args(m,observation({validity:'unknown'}))],
 ];
 for(const [label,value] of refused)assert.equal(capture.resumableSafariTargetStop(value),false,label);
});

// The session worker is a process entry point; its wiring is checked on the source and
// behaviorally by the native case postgame-safari-dex-capture.
const worker=readFileSync(new URL('../src/suite/session-worker.js',import.meta.url),'utf8');
test('the protected Safari capture admits the requested target beside the unchanged shiny and roamer admissions',()=>{
 const body=worker.slice(worker.indexOf('async function runSuiteProtectedCapture('),worker.indexOf('async function beginEvolution('));
 assert.match(body,/const ordinarySafariTarget=safari&&requestedSafariTarget\(\{observation:before,state:mission\.state,request:mission\.request,matches:p=>mission\.matches\(p\)\}\);/);
 assert.match(body,/if\(before\.playerMemory\.encounter\?\.validity!=='valid'\|\|!\(before\.playerMemory\.encounter\.pokemon\.shiny\|\|ordinaryRoamer\|\|ordinarySafariTarget\)\)throw new Error\('The protected encounter is unreadable'\);/);
 assert.match(body,/const ordinaryRoamer=!safari&&mission\.state\.method==='roamer'&&mission\.state\.protected&&mission\.matches\(before\.playerMemory\.encounter\?\.pokemon\)&&before\.playerMemory\.encounter\?\.pokemon\?\.shiny===false;/);
 // Only the qualified, independently replayed Safari plan may act on the owner.
 assert.match(body,/const build=safari\?buildSafariCapturePlan:buildProtectedCapturePlan,replay=safari\?executeSafariCapturePlan:executeProtectedCapturePlan;/);
});
test('a restarted owner resumes the retained Safari target stop like an interrupted hunt, only when automation is on',()=>{
 // Between the owner's first observation at startup and the import of saved receipts.
 const at=worker.indexOf("if(updateHold)emulator.pause('Verifying updated game worker.');\nlastObservation=observe();");
 assert.ok(at>0);
 const block=worker.slice(at,worker.indexOf('// Import saved capture receipts',at));
 assert.match(block,/resumableSafariTargetStop\(\{observation:lastObservation,state:mission\.state,request:mission\.request,matches:p=>mission\.matches\(p\),evidence:captureEvidence\}\)/);
 assert.match(block,/mission\.state\.status='paused';mission\.state\.reason='Session resumed from its saved checkpoint\. Resume the hunt to continue\.';/);
 assert.match(block,/resumeActiveTask=canAutomate\(botPolicy\)&&!resume\?\.postgame&&interruptedRecovery\?\.huntId!==mission\.state\.id;/);
});
