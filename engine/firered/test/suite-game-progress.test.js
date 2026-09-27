import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../src/suite/game-progress.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('FireRed readiness distinguishes an unavailable gift and unfinished link prerequisites from unreadable flags',()=>{
 assert.equal(typeof mod.fireRedProgress,'function');
 const o={frame:12,phase:'stable',playerMemory:{storyState:{flagIds:{611:false,2092:true,2112:true,2116:false}},trainer:{pokedex:{ownedSpecies:[9,34]}}}};
 // The static availability list is covered by goal-request-foundations.test.js.
 const {statics,...progress}=mod.fireRedProgress(o);assert.ok(Array.isArray(statics));
 assert.deepEqual(progress,{game:'firered',frame:12,leagueComplete:true,nationalDex:true,canLinkNationally:false,eeveeGiftAvailable:true,ownedSpecies:2});
 o.playerMemory.storyState.flagIds[611]=true;assert.equal(mod.fireRedProgress(o).eeveeGiftAvailable,false);
 o.phase='transition';assert.equal(mod.fireRedProgress(o).eeveeGiftAvailable,null);
 assert.equal(mod.fireRedProgress(null),null);
});
test('Emerald readiness reports the actual badges and game completion without borrowing FireRed progress',()=>{
 assert.equal(typeof mod.emeraldProgress,'function');
 const flags=new Set(['FLAG_BADGE01_GET','FLAG_BADGE02_GET']);
 const o={frame:77,player:{map:{id:'MAP_ROUTE110'},pokedex:{owned:3}},flag:n=>flags.has(n)};
 const p=mod.emeraldProgress(o);assert.equal(p.badges,2);assert.equal(p.leagueComplete,false);assert.equal(p.canLinkNationally,false);assert.equal(p.nationalDex,false);
 assert.equal(mod.emeraldProgress({frame:1,player:null}).leagueComplete,null);
});
