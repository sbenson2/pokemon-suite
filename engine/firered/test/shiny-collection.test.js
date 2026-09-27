import test from 'node:test';
import assert from 'node:assert/strict';
import * as collection from '../src/suite/shiny-collection.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';
const pokemon={validity:'valid',species:113,personality:123,otId:456,ivs:{hp:31},shiny:true,box:2,slot:4};
const capture={pokemon,fingerprint:encounterFingerprint(pokemon),nativeSaveVerified:true,savedSramSha256:'save'};
const observation=(mons=[pokemon])=>({playerMemory:{trainer:{partyValidity:'valid',party:[],storage:{validity:'valid',pokemon:mons}}}});
test('the shiny collection requires native-save evidence and retains history after trading',()=>{
 const args={game:'firered',observation:observation(),requestId:'hunt',capture};
 assert.equal(collection.updateShinyCollection({...args,capture:{...capture,nativeSaveVerified:false}}).length,0);
 let records=collection.updateShinyCollection(args);assert.equal(records.length,1);assert.equal(records[0].location,'Box 3, slot 5');
 records=collection.updateShinyCollection({...args,records});assert.equal(records.length,1);
 records=collection.updateShinyCollection({...args,records,observation:observation([]),trade:{fingerprint:capture.fingerprint,completion:{nativeSaveVerified:true}}});
 assert.equal(records[0].state,'traded');assert.equal(records[0].owned,false);
});
test('trade selection resolves an owned saved individual and never substitutes the same species',()=>{
 const records=collection.updateShinyCollection({game:'firered',observation:observation(),requestId:'hunt',capture});
 assert.equal(collection.selectShinyForTrade({records,id:records[0].id,observation:observation()}).fingerprint,capture.fingerprint);
 for(const change of [{id:'other'},{observation:observation([{...pokemon,personality:789}])},{observation:observation([pokemon,pokemon])},{trade:{exchangeStarted:true}},{records:[{...records[0],nativeSaveVerified:false}]}])
  assert.throws(()=>collection.selectShinyForTrade({records,id:records[0].id,observation:observation(),...change}));
});
test('an evolved shiny keeps its capture identity but cannot trade until its new native save is verified',()=>{
 const eevee={...pokemon,species:133,ivs:{hp:30,attack:0,defense:8,speed:29,spAttack:22,spDefense:31}};
 const c={...capture,pokemon:eevee,fingerprint:encounterFingerprint(eevee)};
 let records=collection.updateShinyCollection({game:'firered',capture:c,requestId:'umbreon-source',observation:observation([eevee])});
 const id=records[0].id,umbreon={...eevee,species:197};
 const o=observation([umbreon]);o.playerMemory.gameStats={savedGame:20};o.sram={sha256:'before'};
 records=collection.updateShinyCollection({game:'firered',capture:c,records,observation:o});
 assert.equal(records.length,1);assert.equal(records[0].id,id);assert.equal(records[0].pokemon.species,197);
 assert.equal(records[0].owned,true);assert.equal(records[0].nativeSaveVerified,false);
 assert.throws(()=>collection.selectShinyForTrade({records,id,observation:o}),/saved shiny/);
 o.playerMemory.gameStats.savedGame=21;o.playerMemory.saveAttemptStatus=1;o.sram.sha256='after';
 records=collection.updateShinyCollection({game:'firered',capture:c,records,observation:o});
 assert.equal(records.length,1);assert.equal(records[0].nativeSaveVerified,true);
 assert.equal(records[0].evolution.fromSpecies,133);
 assert.equal(collection.selectShinyForTrade({records,id,observation:o}).pokemon.species,197);
});
test('Shedinja and Ninjask are two native species with one lineage, not a duplicate Eevee-style identity',()=>{
 const p={...pokemon,species:301,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}};
 const c={...capture,pokemon:p,fingerprint:encounterFingerprint(p)};
 let records=collection.updateShinyCollection({game:'firered',capture:c,requestId:'shedinja-source',observation:observation([p])});
 const o=observation([{...p,species:302},{...p,species:303,slot:5}]);o.playerMemory.gameStats={savedGame:4};o.sram={sha256:'before'};
 records=collection.updateShinyCollection({game:'firered',capture:c,records,observation:o});
 assert.equal(records.length,2);assert.deepEqual(records.map(r=>r.pokemon.species).sort(),[302,303]);
 assert.deepEqual(records.map(r=>r.nationalSpeciesId).sort(),[291,292]);
 assert.ok(records.every(r=>r.owned&&!r.nativeSaveVerified));
});
