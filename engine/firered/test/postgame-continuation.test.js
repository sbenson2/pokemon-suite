import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgameController} from '../src/suite/postgame.js';
const continuation=await import('../src/suite/campaign-continuation.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const progress=await import('../src/suite/postgame-progress.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const completed=()=>({status:'complete',completion:{playablePostgame:true,sramSha256:'a'.repeat(64),nativeHallOfFame:{nativeSaveVerified:true,savedSramSha256:'a'.repeat(64)}}});

test('a saved Hall of Fame hands off to postgame without replacing the committed campaign',()=>{
 const record={id:'run-example',settings:{},commitment:'unchanged'},state=completed(),before=structuredClone({record,state});
 assert.equal(typeof continuation.campaignPostgameHandoff,'function');
 const result=continuation.campaignPostgameHandoff({record,state,policy:{enabled:true,awaitingCommand:false}});
 assert.equal(result.campaignId,record.id);assert.equal(result.goal,'complete-firered');
 assert.equal(result.campaignCommitment,'unchanged');assert.equal(result.leagueSaveSha256,'a'.repeat(64));
 assert.deepEqual({record,state},before);
});

test('continuation respects stop, explicit wait, and incomplete native saves',()=>{
 assert.equal(typeof continuation.campaignPostgameHandoff,'function');
 const args={record:{id:'run-example',settings:{}},state:completed(),policy:{enabled:true,awaitingCommand:false}};
 for(const changed of [{policy:{enabled:false}},{policy:{enabled:true,awaitingCommand:true}},{record:{...args.record,settings:{afterCampaign:'wait'}}},{state:{...args.state,status:'finishing'}},{state:{...args.state,completion:{...args.state.completion,nativeHallOfFame:{nativeSaveVerified:false}}}}])assert.equal(continuation.campaignPostgameHandoff({...args,...changed}),null);
});

test('postgame begins with observed National Dex and link prerequisites, and retains them after restart',()=>{
 const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
 const controller=createPostgameController(args);controller.beginAdventure();
 assert.equal(controller.state().preparation?.kind,'postgame');
 const restored=createPostgameController({...args,state:controller.state()});
 assert.deepEqual(restored.state().preparation,controller.state().preparation);
 assert.equal(restored.state().agenda.enabled,true);
});

test('National Dex completion distinguishes the cartridge diploma from all 386 species',()=>{
 assert.equal(typeof progress.nationalDexProgress,'function');
 // The observer's owned list is the Pokédex flag bits, already National Dex
 // numbers (fire-red-observer.js decodePokedex); internal ids 252–276 are unused
 // only in party/PC records, never in the Pokédex (Castform is #351, not #325).
 const national=Array.from({length:386},(_,i)=>i+1);
 const full=progress.nationalDexProgress(national);
 assert.equal(full.caught,386);assert.equal(full.total,386);assert.equal(full.complete,true);assert.equal(full.diploma.total,380);
 const missingEvents=national.filter(id=>![151,249,250,251,385,386].includes(id));
 const partial=progress.nationalDexProgress(missingEvents);
 assert.equal(partial.complete,false);assert.equal(partial.caught,380);assert.equal(partial.diploma.complete,true);
 assert.deepEqual(partial.missing,[151,249,250,251,385,386]);
 assert.equal(progress.nationalDexProgress(null).known,false);
 assert.equal(progress.nationalDexProgress([...national,999,277]).caught,386);
});

test('unknown or partner-gated checkpoints never become completed by exhausting local work',()=>{
 assert.equal(typeof progress.postgameProgress,'function');
 const o={phase:'stable',frame:100,playerMemory:{storyState:{flagIds:{2092:true,2112:true,2116:true}},trainer:{pokedex:{ownedSpecies:[1,2,3]}}}};
 const result=progress.postgameProgress(o,{enabled:true,active:null});
 assert.equal(result.complete,false);assert.ok(result.chapters.length>=5);
 const rows=result.chapters.flatMap(c=>c.entries);
 assert.equal(rows.find(e=>e.id==='national-386').status,'pending');
 assert.equal(rows.find(e=>e.id==='wireless-minigames').status,'external');
 assert.equal(rows.find(e=>e.id==='trainer-tower-single').status,'unknown');
 assert.ok(rows.every(e=>e.label&&e.detail&&e.completion));
});

test('Waterfall and Eevee use their distinct native flags, and postgame watches each checkpoint',()=>{
 const o={phase:'stable',playerMemory:{storyState:{flagIds:{611:true,497:false}},trainer:{pokedex:{ownedSpecies:[]}}}};
 let entries=progress.postgameProgress(o).chapters.flatMap(c=>c.entries);
 assert.equal(entries.find(e=>e.id==='waterfall').status,'pending');
 o.playerMemory.storyState.flagIds[497]=true;
 entries=progress.postgameProgress(o).chapters.flatMap(c=>c.entries);
 assert.equal(entries.find(e=>e.id==='waterfall').status,'complete');
 const p=createPostgameController({world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}});
 for(const id of [497,673,738,756,679,680])assert.ok(p.storyWatch().flags.includes(id),`watch ${id}`);
 for(const id of [0x4076,0x407f,0x4049,0x404a,0x404b])assert.ok(p.storyWatch().variables.includes(id),`watch ${id}`);
});

test('the progress ledger explains a missed Lorelei visit without certifying it as complete',()=>{
 const o={phase:'stable',frame:100,playerMemory:{storyState:{flagIds:{724:false,2116:true}},trainer:{pokedex:{ownedSpecies:[]}}}};
 const entry=progress.postgameProgress(o).chapters.flatMap(c=>c.entries).find(e=>e.id==='lorelei-visit');
 assert.equal(entry.status,'pending');assert.equal(entry.available,false);assert.match(entry.dependency,/conversation was missed/);
 o.playerMemory.storyState.flagIds[724]=true;
 const completed=progress.postgameProgress(o).chapters.flatMap(c=>c.entries).find(e=>e.id==='lorelei-visit');
 assert.equal(completed.status,'complete');assert.equal(completed.dependency,undefined);
});
