import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const mod=await import('../src/presentation/cartridge-display.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});

test('display counters decode unsigned encrypted native totals and preserve missing data',()=>{
 assert.equal(typeof mod.decodeGameCounters,'function');
 const b=new Uint8Array(64*4),v=new DataView(b.buffer),key=0xf1234567;
 for(let i=0;i<64;i++)v.setUint32(i*4,key,true);
 for(const [i,n] of [[0,8],[7,1209],[8,900],[9,309],[10,3],[11,117],[21,4]])v.setUint32(i*4,(n^key)>>>0,true);
 const s=mod.decodeGameCounters(b,0,key);assert.equal(s.battles,1209);assert.equal(s.captures,117);assert.equal(s.trades,4);assert.equal(s.leagueEntries,3);assert.equal(s.savedGame,8);
 assert.equal(mod.decodeGameCounters(b.slice(0,4),0,key).battles,undefined);
 assert.equal(mod.decodeGameCounters(b,0,null),null);
});
test('party display reads exact growth bounds from the cartridge and handles level 100',()=>{
 assert.equal(typeof mod.createPartyDisplayReader,'function');
 const species=new Uint8Array(28*20),xp=new Uint8Array(8*101*4);species[18*28+19]=3;
 const v=new DataView(xp.buffer);v.setUint32((3*101+67)*4,300000,true);v.setUint32((3*101+68)*4,315000,true);
 const read=mod.createPartyDisplayReader({symbols:{gSpeciesInfo:{address:0x8000000,size:species.length},gExperienceTables:{address:0x8100000,size:xp.length}},readMemory:(a,n)=>a===0x8000000?species:xp});
 assert.deepEqual(read({species:18,level:67,experience:303000}).experienceProgress,{current:303000,levelStart:300000,nextLevel:315000,remaining:12000,ratio:.2});
 assert.equal(read({species:18,level:100,experience:1059860}).experienceProgress.ratio,1);
 assert.equal(read({species:18,level:67,experience:2}).experienceProgress,undefined);
});
test('spectator publishes party slot, item, XP, shiny identity and lifetime counters',async()=>{
 const {createSpectatorStatus}=await import('../src/presentation/player-status.js');
 const result=createSpectatorStatus({observation:{playerMemory:{storyState:{flagIds:{2112:true,2092:true}},gameStats:{battles:1209,captures:117,trades:4},trainer:{party:[{slot:2,species:18,heldItem:197,shiny:true,level:67,hp:102,maxHp:204,experienceProgress:{remaining:12000,ratio:.2}}]}}},mechanics:{species:[{id:18,name:'SPECIES_PIDGEOT'}]}});
 assert.equal(result.party[0].slot,2);assert.equal(result.party[0].heldItem,197);assert.equal(result.party[0].shiny,true);assert.equal(result.party[0].experience.remaining,12000);assert.equal(result.progress.battles,1209);assert.equal(result.progress.captures,117);assert.equal(result.progress.targetSpecies,386);assert.equal(result.progress.leagueComplete,true);
});
