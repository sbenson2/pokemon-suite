import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../src/suite/gift-mission.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const request={game:'firered',speciesId:133,quantity:1,locationId:'any',shiny:'required',natures:[],gender:'any',abilityId:null,ball:{id:'any',requirement:'required'},minIvs:{},minDvs:{},encounterLevel:{min:1,max:100},finalLevel:null,moves:[],heldItemId:null,limits:{maxEncounters:1000,maxMinutes:60,maxSpend:5000,minBalls:10}};
const route={method:'gift',speciesId:133,nativeSpecies:133,name:'Eevee',map:'MAP_CELADON_CITY_CONDOMINIUMS_ROOF_ROOM',index:1,flag:611,level:25,locationId:'10:763:18:'};
const original={validity:'valid',species:9,personality:11,otId:7,shiny:false,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}};
const eevee={...original,species:133,personality:22,shiny:true,level:25};
const o=(extra={})=>({frame:1,phase:'stable',emulator:{inBattle:false,mode:'overworld',inputReady:true},sram:{sha256:'before'},playerMemory:{map:{id:route.map},position:{x:7,y:4},storyState:{flagIds:{611:false}},trainer:{partyValidity:'valid',party:[original],money:5000,storage:{validity:'valid',boxCounts:Array(14).fill(0),pokemon:[]}},ui:{},gameStats:{savedGame:2},saveAttemptStatus:1},...extra});
function mission(){assert.equal(typeof mod.GiftMission,'function');return new mod.GiftMission({id:'gift',request,route});}
test('gift hunt saves its own current-game anchor and refuses an already consumed gift',()=>{
 const m=mission(),obs=o();m.initialize(obs);
 assert.equal(m.inspect(obs).objective.target.map,route.map);
 assert.equal(m.beforeInteraction(obs,{winner:{recommendation:{kind:'interact-with-object'}}}),true);
 const saved=o();saved.playerMemory.gameStats.savedGame=3;saved.sram.sha256='anchor';
 assert.equal(m.inspect(saved).kind,'anchor');
 const used=o();used.playerMemory.storyState.flagIds[611]=true;
 assert.throws(()=>mission().initialize(used),/already.*received/i);
});
test('Suite factory restores a gift mission through its gift adapter',async()=>{
 const {createSuiteMission}=await import('../src/suite/mission.js');
 const m=createSuiteMission({id:'gift',request,route});
 assert.ok(m instanceof mod.GiftMission);
 assert.ok(createSuiteMission({id:'gift',request,state:m.state}) instanceof mod.GiftMission);
});
test('gift timing approaches its target without skipping it when the unlocked field consumes several RNG calls per frame',()=>{
 const m=mission();assert.equal(typeof m.generationWaitFrames,'function');
 for(const stride of [1,2,4,8]){
  let remaining=128*stride,steps=0;
  while(remaining>0&&steps++<256){remaining-=m.generationWaitFrames(remaining)*stride;assert.ok(remaining>=0,'Skipped the attainable generation seed');}
  assert.equal(remaining,0);
 }
});
test('gift hunt resets an unmatched ordinary gift but protects a newly received shiny in PC storage',()=>{
 const m=mission(),obs=o();m.initialize(obs);m.state.phase='hunting';m.state.anchor={stateSha256:'anchor'};
 m.state.rng={phase:'encounter',target:{pokemon:{personality:eevee.personality}},lastResult:{matched:false}};
 const wrong=o();wrong.playerMemory.trainer.storage.pokemon=[{...eevee,shiny:false}];
 assert.equal(m.inspect(wrong).kind,'reset');
 const found=o();found.playerMemory.trainer.storage.pokemon=[eevee];
 assert.equal(m.inspect(found).kind,'gift-found');
 assert.equal(m.state.protected,true);
 assert.equal(m.state.rng.phase,'found');assert.equal(m.state.rng.lastResult.matched,true);
 assert.notEqual(m.inspect(wrong).kind,'reset');
});
test('receiving a gift is not complete until its exact identity has a verified in-game save',()=>{
 const m=mission();m.initialize(o());m.state.phase='hunting';
 const found=o();found.playerMemory.trainer.storage.pokemon=[eevee];m.inspect(found);
 const naming=structuredClone(found);naming.playerMemory.ui.choiceMenu={cursor:0};
 assert.equal(m.inspect(naming).recommendation.targetOption,'no');
 assert.equal(m.inspect(found).objective.target.kind,'save-game');
 const saved=structuredClone(found);saved.playerMemory.gameStats.savedGame=3;saved.sram.sha256='saved-gift';
 const done=m.inspect(saved);assert.equal(done.kind,'gift-saved');assert.equal(done.capture.nativeSaveVerified,true);assert.equal(done.capture.pokemon.personality,22);
 const missing=structuredClone(saved);missing.playerMemory.trainer.storage.pokemon=[];
 assert.equal(m.inspect(missing).kind,'stop');
});

test('the same saved-gift workflow supports Lapras and reserves a party slot without releasing Pokémon',()=>{
 assert.equal(typeof mod.giftRoute,'function');
 const selected=mod.giftRoute(131),m=new mod.GiftMission({id:'lapras',request:{...request,speciesId:131},route:selected});
 const obs=o();obs.playerMemory.storyState.flagIds[582]=false;obs.playerMemory.trainer.party=Array.from({length:6},(_,slot)=>({...original,slot,personality:slot+10,moves:slot===0?[57]:[]}));
 m.initialize(obs);assert.equal(m.inspect(obs).objective.target.kind,'party-roster');
 assert.equal(m.inspect(obs).objective.target.maximumPartySize,5);
 obs.playerMemory.trainer.party.pop();obs.playerMemory.map.id=selected.map;
 assert.equal(m.inspect(obs).objective.target.index,1);
 m.state.phase='hunting';obs.playerMemory.trainer.party.push({...eevee,species:131});
 assert.equal(m.inspect(obs).kind,'gift-found');
});

test('a dojo gift accepts the initial Pokémon offer and preserves a shiny before the nickname question',()=>{
 assert.equal(typeof mod.giftRoute,'function');
 const route=mod.giftRoute(106),m=new mod.GiftMission({id:'hitmonlee',request:{...request,speciesId:106},route}),obs=o();obs.playerMemory.storyState.flagIds[632]=false;
 m.initialize(obs);assert.equal(m.inspect(obs).objective.choice,'yes');
 m.state.phase='hunting';obs.playerMemory.map.id=route.map;obs.playerMemory.ui.choiceMenu={cursor:0};
 assert.equal(m.generationTrigger(obs,{action:{buttons:['a']},winner:{recommendation:{kind:'choose-menu-option',targetOption:'yes'}}}),true);
 obs.playerMemory.trainer.party.push({...eevee,species:106});assert.equal(m.inspect(obs).kind,'gift-found');
 assert.equal(m.inspect(obs).recommendation.targetOption,'no');
});

test('a fossil is handed in and walked out before saving the untouched level-five revival',()=>{
 const route=mod.giftRoute(142);assert.ok(route);
 const m=new mod.GiftMission({id:'amber',request:{...request,speciesId:142},route}),obs=o();
 obs.playerMemory.storyState.flagIds[750]=false;obs.playerMemory.storyState.flagIds[606]=true;
 obs.playerMemory.storyState.variableIds={16489:0,16490:0};obs.playerMemory.map.id=route.map;
 m.initialize(obs);assert.equal(m.inspect(obs).objective.choice,'yes');
 assert.equal(m.beforeInteraction(obs,{winner:{recommendation:{kind:'interact-with-object'}}}),false);
 obs.playerMemory.storyState.variableIds[16489]=3;obs.playerMemory.storyState.variableIds[16490]=1;
 assert.equal(m.inspect(obs).objective.target.map,'MAP_CINNABAR_ISLAND_POKEMON_LAB_ENTRANCE');
 obs.playerMemory.storyState.variableIds[16490]=2;
 assert.equal(m.beforeInteraction(obs,{winner:{recommendation:{kind:'interact-with-object'}}}),true);
 assert.equal(m.inspect(obs).objective.target.kind,'save-game');
});

test('an incidental saved shiny invalidates every pre-capture gift reset anchor',()=>{
 const m=mission();m.initialize(o());m.state.anchor={stateSha256:'old'};m.state.rng={anchor:{stateSha256:'old-rng'}};m.state.protected=true;
 assert.throws(()=>m.acceptSavedCapture({nativeSaveVerified:false}),/saved|verified/);
 m.acceptSavedCapture({nativeSaveVerified:true});assert.equal(m.state.anchor,null);assert.equal(m.state.rng,null);
});
