import test from 'node:test';
import assert from 'node:assert/strict';
import * as coldBoot from '../src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

function fixture(){
 const eevee={validity:'valid',species:133,personality:904768199,otId:2161188857,ivs:{hp:30,attack:0,defense:8,speed:29,spAttack:22,spDefense:31}};
 const other={...eevee,species:18,personality:8};
 const o={playerMemory:{trainer:{partyValidity:'valid',party:[other,eevee]},gameStats:{savedGame:119}}};
 const preparation={phase:'ready',nativeSaveVerified:true,fingerprint:encounterFingerprint(eevee),saveBaseline:{counter:118}};
 const baseline={party:o.playerMemory.trainer.party.map(encounterFingerprint),savedGame:119,tradeCount:3};
 return {o,preparation,baseline};
}

test('a prepared evolution source survives a native SRAM cold boot with its whole party and counters',()=>{
 assert.equal(typeof coldBoot.validateNativeEvolutionContinuation,'function');
 const {o,preparation,baseline}=fixture();
 assert.equal(coldBoot.validateNativeEvolutionContinuation(o,{tradeCount:3},preparation,baseline),'ready-for-evolution-transfer');
});

test('cold boot refuses an unverified save, lost source, changed companion, or changed native counter',()=>{
 assert.equal(typeof coldBoot.validateNativeEvolutionContinuation,'function');
 for(const change of [f=>f.preparation.nativeSaveVerified=false,f=>f.o.playerMemory.trainer.party[1].ivs.hp=31,f=>f.o.playerMemory.trainer.party[0].personality=99,f=>f.o.playerMemory.gameStats.savedGame=118,f=>f.baseline.tradeCount=4]){
  const f=fixture();change(f);assert.throws(()=>coldBoot.validateNativeEvolutionContinuation(f.o,{tradeCount:3},f.preparation,f.baseline),/verified|party|counter|source|prepared/i);
 }
});
