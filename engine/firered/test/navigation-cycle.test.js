import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../src/suite/navigation-cycle.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const goal={id:'hunt-stock-balls',target:{kind:'purchase-items',map:'MAP_VIRIDIAN_CITY_MART'}};
const at=map=>({phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:map},ui:{},trainer:{partyValidity:'valid',party:[{species:18,hp:42,level:67,pp:[12]}],storage:{validity:'valid',pokemon:[]},money:47196,bag:{pokeBalls:[]}},gameStats:{savedGame:1}}});
test('repeated island crossings without task progress are detected across checkpoint restoration',()=>{
 assert.equal(typeof mod.observeNavigationCycle,'function');let state={};let result;
 for(let i=0;i<12;i++){
  result=mod.observeNavigationCycle({observation:at(i%2?'PORT':'TOWN'),objective:goal,state,now:i*7000});
  if(i===5)state=JSON.parse(JSON.stringify(state));
 }
 assert.equal(result?.reason,'repeated-navigation-cycle');assert.deepEqual(new Set(result.pattern),new Set(['TOWN','PORT']));
});
test('normal travel, healing, supplies and changed objectives are progress rather than a loop',()=>{
 for(const mode of ['travel','healing','supplies','objective']){
  const state={};
  for(let i=0;i<16;i++){
   const o=at(mode==='travel'?`MAP_${i}`:i%2?'PORT':'TOWN');let objective=goal;
   if(mode==='healing'){objective={id:'restore-postgame-party',taskKind:'recovery',target:{kind:'object',map:'CENTER',index:0}};o.playerMemory.trainer.party[0].hp+=i;}
   if(mode==='supplies')o.playerMemory.trainer.bag.pokeBalls=[{itemId:4,quantity:i}];
   if(mode==='objective')objective={...goal,id:`task-${i}`};
   assert.equal(mod.observeNavigationCycle({observation:o,objective,state,now:i*10000}),null,mode);
  }
 }
});
test('battle, trade, menu, and transition observations cannot trigger field navigation recovery',()=>{
 for(const change of [{phase:'transition'},{emulator:{mode:'battle',inBattle:true}},{playerMemory:{...at('PORT').playerMemory,ui:{saveDialog:{stage:'writing'}}}}]){
  const state={};for(let i=0;i<20;i++)assert.equal(mod.observeNavigationCycle({observation:{...at(i%2?'PORT':'TOWN'),...change},objective:goal,state,now:i*10000}),null);
 }
});
test('restarting the planner or moving within a loop cannot claim recovery',()=>{
 const cycle={pattern:['TOWN','PORT'],progress:'old'};
 assert.equal(mod.navigationRecoveryProgress(cycle,{},at('PORT')),false);
 assert.equal(mod.navigationRecoveryProgress(cycle,{progress:'old'},at('PORT')),false);
 assert.equal(mod.navigationRecoveryProgress(cycle,{progress:'new'},at('PORT')),true);
 assert.equal(mod.navigationRecoveryProgress(cycle,{progress:'old'},at('HARBOR')),true);
});

test('a stationary field loop is detected across checkpoints and recovery requires displacement',()=>{
 let state={};const o=at('CAVE');o.playerMemory.position={x:11,y:15};
 for(let i=0;i<6;i++){
  assert.equal(mod.observeNavigationCycle({observation:o,objective:goal,state,now:i*10000}),null);
  state=JSON.parse(JSON.stringify(state));
 }
 const cycle=mod.observeNavigationCycle({observation:o,objective:goal,state,now:60000});
 assert.equal(cycle?.type,'stationary');
 assert.equal(mod.navigationRecoveryProgress(cycle,state,o),false);
 o.playerMemory.position={x:10,y:15};
 assert.equal(mod.navigationRecoveryProgress(cycle,state,o),true);
});

test('field motion and time spent in menus or battles do not count as a stationary navigation failure',()=>{
 for(const mode of ['motion','dialogue','battle']){
  const state={};const o=at('CAVE');o.playerMemory.position={x:1,y:1};
  mod.observeNavigationCycle({observation:o,objective:goal,state,now:0});
  if(mode==='motion')o.playerMemory.position.x=2;
  else if(mode==='dialogue')o.playerMemory.ui={fieldDialog:{active:true}};
  else o.emulator={mode:'battle',inBattle:true};
  assert.equal(mod.observeNavigationCycle({observation:o,objective:goal,state,now:59000}),null);
  o.emulator={mode:'overworld',inBattle:false};o.playerMemory.ui={};
  assert.equal(mod.observeNavigationCycle({observation:o,objective:goal,state,now:60001}),null,mode);
 }
});

test('incidental battle XP, damage, PP use and sightings cannot hide a repeated travel loop',()=>{
 let state={},result;
 const objective={id:'hunt-articuno',target:{kind:'object',map:'SEAFOAM_BOTTOM',index:2}};
 for(let i=0;i<12;i++){
  const o=at(i%2?'SEAFOAM_BOTTOM':'SEAFOAM_UPPER'),p=o.playerMemory.trainer.party[0];
  Object.assign(p,{level:80+i,experience:10000+i*500,hp:100-i,pp:[25-i]});
  o.playerMemory.trainer.pokedex={ownedSpecies:[22],seenSpecies:[22,86+i]};
  result=mod.observeNavigationCycle({observation:o,objective,state,now:i*7000});
  const battle=structuredClone(o);battle.emulator={mode:'battle',inBattle:true};
  assert.equal(mod.observeNavigationCycle({observation:battle,objective,state,now:i*7000+1000}),null);
  state=structuredClone(state);
 }
 assert.equal(result?.reason,'repeated-navigation-cycle');
 assert.deepEqual(new Set(result.pattern),new Set(['SEAFOAM_BOTTOM','SEAFOAM_UPPER']));
});

test('a native puzzle milestone counts as progress during travel',()=>{
 const state={},objective={id:'hunt-articuno',target:{kind:'object',map:'BOTTOM',index:2}};
 for(let i=0;i<9;i++){
  const o=at(i%2?'BOTTOM':'UPPER');o.playerMemory.storyState={flagIds:{723:i>=8}};
  assert.equal(mod.observeNavigationCycle({observation:o,objective,state,now:i*7000}),null);
 }
 const o=at('BOTTOM');o.playerMemory.storyState={flagIds:{723:true}};
 assert.equal(mod.observeNavigationCycle({observation:o,objective,state,now:63000}),null);
});
