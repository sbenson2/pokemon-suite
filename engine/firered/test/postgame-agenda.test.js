import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignNavigationRecommendation} from '../src/player/campaign.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';
const agenda=await import('../src/suite/postgame-agenda.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const storage=await import('../src/suite/storage-capacity.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const trainer=()=>({partyValidity:'valid',party:Array.from({length:6},(_,slot)=>({slot,validity:'valid',species:9,moves:[57,70,19],shiny:false})),storage:{validity:'valid',boxCounts:[30,30,30,30,30,0,0,0,0,0,0,0,0,0],pokemon:[],unknownSlots:0},pokedex:{ownedSpecies:[9]}});
const observation=()=>({frame:100,phase:'stable',sram:{sha256:'before'},emulator:{mode:'overworld',inBattle:false,inputReady:true},playerMemory:{map:{id:'MAP_FIVE_ISLAND_MEMORIAL_PILLAR'},position:{x:5,y:47},ui:{},storyState:{flagIds:{2092:true,2112:true,2116:true,675:true,733:true,732:true,2121:false,147:false,700:false,701:false,702:false,703:false,730:false,582:false,632:false,606:false,750:false,566:false,724:false,679:false,680:false}},gameStats:{savedGame:312,leagueEntries:1,eggsHatched:0},postgameEvidence:{roamer:{species:243,active:true,shiny:false},trainerTower:Array.from({length:4},()=>({receivedPrize:false,bestTimeFrames:215999}))},trainer:trainer()}});

for(const [id,origin,destination] of [
 ['tanoby','MAP_SEVEN_ISLAND_SEVAULT_CANYON','MAP_SEVEN_ISLAND_SEVAULT_CANYON_TANOBY_KEY'],
 ['selphy','MAP_FIVE_ISLAND_LOST_CAVE_ROOM9','MAP_FIVE_ISLAND_LOST_CAVE_ROOM10'],
])test(`${id} map-only travel produces an executable doorway route`,()=>{
 const map=(id,dest,x)=>({id,connections:[],objectEvents:[],coordEvents:[],backgroundEvents:[],
  warpEvents:[{x,y:2,dest_map:dest,dest_warp_id:0}],layout:{width:5,height:5,blockDataSha256:id,
   cells:Array.from({length:25},(_,i)=>({x:i%5,y:Math.floor(i/5),collision:0,elevation:3,behaviorName:i%5===x&&Math.floor(i/5)===2?'MB_CAVE_DOOR':'MB_NORMAL',encounterType:0}))}});
 const world={data:{maps:[map(origin,destination,3),map(destination,origin,0)]}},o=observation();
 o.playerMemory.map.id=origin;o.playerMemory.position={x:1,y:2};
 const objective=agenda.resolvePostgameObjective(id,o,world,{});
 const route=campaignNavigationRecommendation({world,observation:o,objective});
 assert.equal(route?.kind,'move-toward');assert.equal(route.direction,'east');
});

test('a missed Lorelei conversation remains incomplete but cannot send the agenda to an absent NPC',()=>{
 const o=observation(),entry=agenda.postgameChecklist(o).find(x=>x.id==='lorelei-visit');
 assert.equal(entry.status,'pending');assert.equal(entry.executable,false);
 assert.match(entry.reason,/Sapphire.*conversation.*missed/);
 o.playerMemory.storyState.flagIds[724]=true;
 assert.equal(agenda.postgameChecklist(o).find(x=>x.id==='lorelei-visit').status,'complete');
});

test('the postgame checklist distinguishes completed Sevii story from untouched optional objectives',()=>{
 assert.equal(typeof agenda.postgameChecklist,'function');
 const list=agenda.postgameChecklist(observation());
 for(const id of ['league','national-dex','sevii-link'])assert.equal(list.find(x=>x.id===id).status,'complete',id);
 for(const id of ['tanoby','mewtwo','articuno','zapdos','moltres','roamer','league-rematch','togepi','selphy','trainer-tower'])assert.equal(list.find(x=>x.id===id).status,'pending',id);
 const unknown=observation();unknown.playerMemory.storyState.flagIds={};unknown.playerMemory.postgameEvidence=null;
 assert.equal(agenda.postgameChecklist(unknown).find(x=>x.id==='tanoby').status,'unknown');
});

test('postgame resumes its saved objective and advances only when the cartridge proves completion',()=>{
 assert.equal(typeof agenda.PostgameAgenda,'function');
 let plan=new agenda.PostgameAgenda();plan.start();const o=observation();
 assert.equal(plan.select(o).id,'tanoby');
 plan=new agenda.PostgameAgenda(plan.state);assert.equal(plan.select(o).id,'tanoby');
 o.playerMemory.storyState.flagIds[2121]=true;
 assert.equal(plan.select(o).id,'selphy');
 assert.equal(plan.state.entries.find(x=>x.id==='tanoby').status,'complete');
 o.playerMemory.storyState.flagIds[2121]=false;
 assert.equal(plan.select(o).id,'tanoby','a restored older save invalidates stale completion');
});

test('a failed postgame route yields to another objective and remains eligible after its cooldown',()=>{
 assert.equal(typeof agenda.PostgameAgenda,'function');
 const plan=new agenda.PostgameAgenda();plan.start();const o=observation();plan.select(o,1000);plan.defer('tanoby','Route could not be verified',1000);
 assert.equal(plan.select(o,1001).id,'selphy');
 assert.equal(plan.select(o,301001).id,'tanoby');
 assert.equal(plan.state.failures.tanoby.attempts,1);
});

test('capture space forecasts include retained nonshinies, duplicates, party and a full reserve box',()=>{
 assert.equal(typeof storage.storageCapacity,'function');
 const result=storage.storageCapacity(trainer(),{remainingTargets:289});
 assert.equal(result.pcUsed,150);assert.equal(result.pcCapacity,420);assert.equal(result.free,270);
 assert.equal(result.captureBudget,240);assert.equal(result.projectedUsed,445);assert.equal(result.shortfall,49);
 assert.equal(result.canStart,true);
});

test('new captures cannot spend the incidental-shiny reserve or trust unreadable storage',()=>{
 assert.equal(typeof storage.storageCapacity,'function');
 const t=trainer();t.storage.boxCounts=[...Array(13).fill(30),0];
 assert.equal(storage.storageCapacity(t).canStart,false);
 assert.equal(storage.storageCapacity(t).free,30);
 t.storage.boxCounts[13]=1;assert.equal(storage.storageCapacity(t).canStart,false);
 t.storage.validity='unknown';assert.equal(storage.storageCapacity(t).known,false);
 t.storage.validity='valid';t.storage.boxCounts[0]=31;assert.equal(storage.storageCapacity(t).known,false);
});
test('storage forecasts follow the active collection goal instead of always forecasting 386 shinies',()=>{
 const t=trainer();t.pokedex={ownedSpecies:[13,14,15]};
 assert.equal(typeof storage.collectionStorage,'function');
 const ordinary=storage.collectionStorage(t,{scope:'postgame'});
 assert.equal(ordinary.remainingTargets,383);assert.equal(ordinary.goal,'national-dex');
 const records=[{owned:true,nativeSaveVerified:true,nationalSpeciesId:13,pokemon:{shiny:true}},
  {owned:false,nativeSaveVerified:true,nationalSpeciesId:14,pokemon:{shiny:true}}];
 const shiny=storage.collectionStorage(t,{scope:'collection',records});
 assert.equal(shiny.remainingTargets,385);assert.equal(shiny.goal,'shiny-national-dex');
 assert.equal(storage.collectionStorage(t,{scope:'campaign'}).remainingTargets,0);
 assert.equal(storage.collectionStorage(t,{scope:'task',quantity:3,caught:1}).remainingTargets,2);
});

test('a multi-catch request reserves its whole quantity before travel, while a protected encounter may finish',()=>{
 assert.equal(typeof storage.assertCaptureCapacity,'function');
 const t=trainer();t.storage.boxCounts=[...Array(12).fill(30),20,0];
 assert.throws(()=>storage.assertCaptureCapacity(t,{quantity:11}),/spaces|space/);
 assert.doesNotThrow(()=>storage.assertCaptureCapacity(t,{quantity:10}));
 t.storage.boxCounts=Array(14).fill(30);
 assert.doesNotThrow(()=>storage.assertCaptureCapacity(t,{quantity:1,protected:true}));
});

test('a full PC blocks new Pokémon tasks without blocking a non-capture island objective',()=>{
 assert.equal(typeof agenda.PostgameAgenda,'function');
 const plan=new agenda.PostgameAgenda();plan.start();const o=observation();o.playerMemory.trainer.storage.boxCounts=Array(14).fill(30);
 assert.equal(plan.select(o).id,'tanoby');
 assert.equal(agenda.postgameChecklist(o).find(x=>x.id==='mewtwo').storageBlocked,true);
});

test('Tanoby uses observed boulder positions, including after a mid-puzzle restart',()=>{
 assert.equal(typeof agenda.resolvePostgameObjective,'function');
 const o=observation();o.playerMemory.map.id='MAP_SEVEN_ISLAND_SEVAULT_CANYON_TANOBY_KEY';
 const initial=[[7,6],[8,6],[8,9],[6,10],[8,10],[6,9],[6,6]];
 o.playerMemory.objectEvents=initial.map(([x,y],i)=>({localId:i+1,current:{x,y}}));
 const world={data:{maps:[{id:o.playerMemory.map.id,objectEvents:initial.map(([x,y])=>({x,y,graphics_id:'OBJ_EVENT_GFX_PUSHABLE_BOULDER'}))}]}};
 let objective=agenda.resolvePostgameObjective('tanoby',o,world,{});
 assert.equal(objective.target.objectIndex,0);assert.equal(objective.target.y,2);
 o.playerMemory.objectEvents[0].current={x:7,y:2};
 objective=agenda.resolvePostgameObjective('tanoby',o,world,{});
 assert.equal(objective.target.objectIndex,6);assert.deepEqual(objective.authoredBoulderPath.at(-1),{x:4,y:4});
 o.playerMemory.objectEvents[6].current={x:7,y:5};
 assert.equal(agenda.resolvePostgameObjective('tanoby',o,world,{}).target.objectIndex,6);
 o.playerMemory.objectEvents[6].current={x:12,y:12};
 assert.equal(agenda.resolvePostgameObjective('tanoby',o,world,{}).target.kind,'map-arrival','an off-path push resets the room through its real exit');
 o.playerMemory.objectEvents[6].current={x:4,y:4};o.playerMemory.objectEvents[1].current={x:10,y:4};
 objective=agenda.resolvePostgameObjective('tanoby',o,world,{});
 assert.equal(objective.target.objectIndex,3,'move the bottom row before upper rocks; x=5,y=7 is a wall');
 assert.deepEqual(objective.authoredBoulderPath,[{x:6,y:10},{x:5,y:10},{x:5,y:9},{x:5,y:8}]);
});

test('the controller includes postgame flags and keeps the selected agenda across checkpoints',async()=>{
 const {createPostgameController}=await import('../src/suite/postgame.js');
 const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
 const p=createPostgameController(args);
 assert.equal(typeof p.beginAdventure,'function');p.beginAdventure();
 assert.ok(p.storyWatch().flags.includes(2121));
 const restored=createPostgameController({...args,state:p.state()});
 assert.equal(restored.state().agenda.enabled,true);
});

test('postgame evidence reads live roamer and decrypts all four tower records',()=>{
 assert.equal(typeof agenda.readPostgameEvidence,'function');
 const b1=Buffer.alloc(200),b2=Buffer.alloc(20),key=0x12345678;
 b1.writeUInt16LE(243,8);b1[19]=1;b1.writeUInt16LE(162,10);b1[12]=50;
 b2.writeUInt32LE(key,4);
 for(let i=0;i<4;i++){b1.writeUInt32LE((215999^key)>>>0,40+i*12+4);b1[40+i*12+10]=i===0?1:0;}
 const session={readMemory(a,n){if(a===1){const b=Buffer.alloc(4);b.writeUInt32LE(1000);return b;}if(a===2){const b=Buffer.alloc(4);b.writeUInt32LE(2000);return b;}if(a>=2000)return b2.subarray(a-2000,a-2000+n);return b1.subarray(a-1000,a-1000+n);}};
 const runtime={data:{symbols:{gSaveBlock1Ptr:{address:1},gSaveBlock2Ptr:{address:2}},structures:{SaveBlock1:{fields:{roamer:{offset:0},trainerTower:{offset:40}}},SaveBlock2:{fields:{encryptionKey:{offset:4}}}}}};
 const result=agenda.readPostgameEvidence(session,runtime,observation());
 assert.equal(result.roamer.species,243);assert.equal(result.roamer.active,true);
 assert.deepEqual(result.trainerTower.map(t=>t.receivedPrize),[true,false,false,false]);
 assert.equal(result.trainerTower[1].bestTimeFrames,215999);
 assert.equal(agenda.readPostgameEvidence(session,runtime,{phase:'transition'}),null);
});

test('completion records are decoded from optional native fields without guessing absent evidence',()=>{
 const b1=Buffer.alloc(256),b2=Buffer.alloc(64);
 for(let i=0;i<16;i++)b1.writeUInt16LE((i===15?31:63)<<2,100+i*4);
 b2.writeUInt16LE(201,20);b2.writeUInt16LE(205,40+4);
 const ptr=x=>{const b=Buffer.alloc(4);b.writeUInt32LE(x);return b;};
 const session={readMemory(a,n){if(a===1)return ptr(1000);if(a===2)return ptr(2000);return a>=2000?b2.subarray(a-2000,a-2000+n):b1.subarray(a-1000,a-1000+n);}};
 const runtime={data:{symbols:{gSaveBlock1Ptr:{address:1},gSaveBlock2Ptr:{address:2}},structures:{SaveBlock1:{fields:{roamer:{offset:0},trainerTower:{offset:40},fameChecker:{offset:100}}},SaveBlock2:{fields:{encryptionKey:{offset:4},pokeJump:{offset:20},berryPick:{offset:40}}}}}};
 const result=agenda.readPostgameEvidence(session,runtime,observation());
 assert.equal(result.fameChecker.length,16);assert.equal(result.fameChecker[15].entries,31);
 assert.deepEqual(result.minigames,{jumps:201,berries:205});
 delete runtime.data.structures.SaveBlock1.fields.fameChecker;
 assert.equal(agenda.readPostgameEvidence(session,runtime,observation()).fameChecker,null);
});

test('postgame presentation retains chapter evidence across transition frames',()=>{
 const o=observation(),state={enabled:true,active:'tanoby'};
 const before=agenda.postgamePresentation(o,state);
 assert.ok(before.progress?.chapters.length>0);
 const after=agenda.postgamePresentation({...o,phase:'transition',frame:o.frame+1},state,before);
 assert.deepEqual(after.progress,before.progress);assert.equal(after.evidenceCurrent,false);
});

test('session startup presents progress before an agenda exists, then retains the new agenda across restart',()=>{
 const o=observation();
 for(const missing of [null,undefined]){
  const initial=agenda.postgamePresentation(o,missing);
  assert.equal(initial.progress.active,null);
  assert.deepEqual(initial.progress.species,[]);
  assert.equal(initial.progress.dex.caught,1);
  assert.equal(initial.progress.complete,false);
  const transition=agenda.postgamePresentation({...o,phase:'transition',frame:o.frame+1},missing,initial);
  assert.deepEqual(transition.progress,initial.progress);
  const cold=agenda.postgamePresentation({...o,phase:'transition'},missing);
  assert.equal(cold.progress.dex.known,false);
  assert.equal(cold.progress.complete,false);
 }
 const controller=new agenda.PostgameAgenda();controller.start();controller.select(o);
 const restored=new agenda.PostgameAgenda(JSON.parse(JSON.stringify(controller.state)));
 const active=agenda.postgamePresentation(o,restored.state);
 assert.equal(active.enabled,true);
 assert.equal(active.progress.active,'tanoby');
});

test('a postgame checklist resumes after restart even without an old hunt mission',async()=>{
 const {canContinuePostgame}=await import('../src/suite/postgame.js');
 const state={enabled:true,running:false,mission:null,wireless:{remotePlayers:0},postgame:{status:'running',agenda:{enabled:true}}};
 assert.equal(canContinuePostgame(state),true);
 assert.equal(canContinuePostgame({...state,enabled:false}),false);
});

test('an objective that produces only neutral waits eventually yields instead of spinning forever',()=>{
 const plan=new agenda.PostgameAgenda();plan.start();const o=observation();plan.select(o,1000);
 o.frame+=10000;
 assert.equal(plan.select(o,2000).id,'selphy');
 assert.ok(plan.state.failures.tanoby.reason.includes('progress'));
});

test('a verified PC roster change resets the agenda route deadline while preparation continues',()=>{
 const plan=new agenda.PostgameAgenda();plan.start();const o=observation();
 assert.equal(plan.select(o,1000).id,'tanoby');
 o.frame+=8000;
 o.playerMemory.trainer.party[5]={...o.playerMemory.trainer.party[5],species:150,personality:501};
 assert.equal(plan.select(o,2000).id,'tanoby');
 o.frame+=2000;
 assert.equal(plan.select(o,3000).id,'tanoby','the real roster change must extend the route deadline');
});

test('walking in circles cannot keep a postgame route alive beyond five active minutes',()=>{
 const p=new agenda.PostgameAgenda();p.start();const o=observation();p.select(o,0);
 for(let i=1;i<=61;i++){o.frame+=100;o.playerMemory.position.x=i%2;p.select(o,i*5000);}
 assert.ok(p.state.failures.tanoby);assert.notEqual(p.state.active,'tanoby');
});

test('temporary scripts and incidental wild battles cannot reset the quest watchdog',()=>{
 const p=new agenda.PostgameAgenda();p.start();const o=observation();p.select(o,0);
 for(let i=1;i<=61;i++){
  o.frame+=100;o.playerMemory.position.x=i%2;
  o.playerMemory.storyState.variableIds={0x4001:i,0x8004:i};
  o.playerMemory.storyState.flagIds[1]=Boolean(i%2);
  o.playerMemory.gameStats.battles=i;
  p.select(o,i*5000);
 }
 assert.ok(p.state.failures.tanoby);assert.notEqual(p.state.active,'tanoby');
});

test('the stronger League rematch requires an observed post-link Hall of Fame save, not a total of two earlier wins',()=>{
 const o=observation();o.playerMemory.gameStats.leagueEntries=2;
 const p=new agenda.PostgameAgenda();p.start();assert.equal(agenda.postgameChecklist(o).find(e=>e.id==='league-rematch').status,'pending');
 p.state.workflows={league:{baseline:{leagueEntries:2,savedGame:312,sha256:'before'}}};
 o.playerMemory.gameStats.leagueEntries=3;o.playerMemory.gameStats.savedGame=313;o.emulator={mode:'hall-of-fame',callback2:'CB2_HofIdle'};o.sram.sha256='after';
 assert.equal(typeof p.observe,'function');p.observe(o);
 assert.equal(p.state.workflows.league.receipt,undefined,'wait for the playable field after credits');
 o.emulator={mode:'overworld',inBattle:false,inputReady:true};p.observe(o);
 assert.equal(p.state.workflows.league.receipt.nativeSaveVerified,true);
 assert.equal(agenda.postgameChecklist(o,p.state.workflows).find(e=>e.id==='league-rematch').status,'complete');
 o.playerMemory.gameStats.leagueEntries=2;
 assert.equal(agenda.postgameChecklist(o,p.state.workflows).find(e=>e.id==='league-rematch').status,'pending','an older save must not inherit a later victory');
});

test('League rematches stock supplies before entering and heal and save between opponents',()=>{
 const o=observation(),map='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F',world={data:{maps:[{id:map,objectEvents:[{script:'Mart'},{script:'IndigoPlateau_PokemonCenter_1F_EventScript_Nurse'}]}]}};
 const party=o.playerMemory.trainer.party;party.forEach(p=>Object.assign(p,{hp:100,maxHp:100,status1:0,pp:[15,15,15]}));
 o.playerMemory.trainer.money=156448;o.playerMemory.trainer.bag={items:[{itemId:24,quantity:15}]};
 const state={},mechanics={data:{moves:[{id:57,pp:15,power:95},{id:70,pp:15,power:80},{id:19,pp:15,power:70}]}};
 const supplies=agenda.resolvePostgameObjective('league-rematch',o,world,state,{mechanics});
 assert.equal(supplies.target.kind,'map'); // Reach the departure harbor before the Kanto shop.
 o.playerMemory.map.id=map;
 assert.equal(agenda.resolvePostgameObjective('league-rematch',o,world,state,{mechanics}).target.kind,'purchase-items');
 o.playerMemory.map.id='MAP_POKEMON_LEAGUE_LORELEIS_ROOM';o.playerMemory.storyState.flagIds[1208]=true;party[0].hp=40;
 o.playerMemory.trainer.bag.items.push({itemId:20,quantity:20});
 assert.equal(agenda.resolvePostgameObjective('league-rematch',o,world,state,{mechanics}).target.kind,'heal-with-items');
 party[0].hp=100;
 assert.equal(agenda.resolvePostgameObjective('league-rematch',o,world,state,{mechanics}).target.kind,'save-game');
 o.playerMemory.gameStats.savedGame++;o.playerMemory.saveAttemptStatus=1;o.sram.sha256='after';
 assert.equal(agenda.resolvePostgameObjective('league-rematch',o,world,state,{mechanics}).target.map,'MAP_POKEMON_LEAGUE_BRUNOS_ROOM');
});

test('the checklist hands a remaining legendary to its shiny mission and leaves the encounter untouched while space is low',()=>{
 const o=observation(),plan=new agenda.PostgameAgenda();plan.start();
 for(const id of [2121,147,606,582,632])o.playerMemory.storyState.flagIds[id]=true;
 assert.equal(plan.select(o).id,'mewtwo');
 const next=agenda.resolvePostgameObjective('mewtwo',o,{data:{maps:[]}});
 assert.equal(next.target.kind,'postgame-hunt');assert.equal(next.request.shiny,'required');assert.equal(next.route.method,'static');
 o.playerMemory.trainer.storage.boxCounts=Array(14).fill(30);
 assert.equal(plan.select(o).id,'league-rematch');
});

test('unclaimed Lapras and dojo gifts become shiny tasks rather than ordinary irreversible gifts',()=>{
 const o=observation(),plan=new agenda.PostgameAgenda();plan.start();
 for(const id of [2121,147])o.playerMemory.storyState.flagIds[id]=true;
 assert.equal(plan.select(o).id,'lapras');
 const lapras=agenda.resolvePostgameObjective('lapras',o,{data:{maps:[]}});
 assert.equal(lapras.route.method,'gift');assert.equal(lapras.request.speciesId,131);assert.equal(lapras.request.shiny,'required');
 o.playerMemory.trainer.pokedex.ownedSpecies.push(106);
 assert.equal(agenda.resolvePostgameObjective('dojo-gift',o,{data:{maps:[]}}).request.speciesId,107);
});

test('League entry restores PP even when every party member has full health',()=>{
 const o=observation(),map='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';o.playerMemory.map.id=map;
 const world={data:{maps:[{id:map,objectEvents:[{script:'Mart'},{script:'IndigoPlateau_PokemonCenter_1F_EventScript_Nurse'}]}]}};
 o.playerMemory.trainer.bag={items:[{itemId:24,quantity:24},{itemId:20,quantity:20},{itemId:23,quantity:8},{itemId:19,quantity:20}]};
 o.playerMemory.trainer.party.forEach(p=>Object.assign(p,{hp:100,maxHp:100,status1:0,pp:[15,15,15]}));
 o.playerMemory.trainer.party[0].pp[0]=0;
 const mechanics={data:{moves:[{id:57,pp:15},{id:70,pp:15},{id:19,pp:15}]}};
 const next=agenda.resolvePostgameObjective('league-rematch',o,world,{}, {mechanics});
 assert.equal(next.target.map,map);assert.equal(next.target.index,1);
});

test('battle preparation counts native XP between levels but still defers a truly idle objective',()=>{
 const o=observation();let plan=new agenda.PostgameAgenda(),now=1000;plan.start();
 const id=plan.select(o,now).id;
 for(let i=0;i<80;i++){
  now+=5000;o.frame+=300;o.playerMemory.position={x:i%2,y:0};
  o.playerMemory.trainer.party[0].experience=100000+i*100;
  if(i===40)plan=new agenda.PostgameAgenda(JSON.parse(JSON.stringify(plan.state)));
  assert.equal(plan.select(o,now)?.id,id,'XP training remains productive even without a level-up');
 }
 for(let i=0;i<61;i++){now+=5000;o.frame+=300;o.playerMemory.position={x:i%2,y:0};plan.select(o,now);}
 assert.ok(plan.state.failures[id],'walking alone must not keep the task alive');
});

test('postgame field preparation restores health, status and PP before another expedition',async()=>{
 const {fieldRecoveryObjective}=await import('../src/suite/field-recovery.js');
 const o=observation(),map='MAP_FIVE_ISLAND_POKEMON_CENTER_1F';
 const world={data:{maps:[{id:map,objectEvents:[{script:'FiveIsland_PokemonCenter_1F_EventScript_Nurse'}]}]}};
 const mechanics={data:{moves:[{id:57,pp:15},{id:70,pp:15},{id:19,pp:15}]}};
 o.playerMemory.trainer.party.forEach(p=>Object.assign(p,{hp:100,maxHp:100,status1:0,pp:[15,15,15]}));
 assert.equal(fieldRecoveryObjective(o,world,mechanics),null);
 o.playerMemory.trainer.party[0].pp[0]=0;assert.equal(fieldRecoveryObjective(o,world,mechanics).target.map,map);
 o.emulator.inBattle=true;assert.equal(fieldRecoveryObjective(o,world,mechanics),null,'battle recovery keeps ownership until the battle finishes');
});

test('the visible checklist retains verified progress during transitions and rechecks an older restored save',()=>{
 assert.equal(typeof agenda.postgamePresentation,'function');
 const o=observation(),state={enabled:true,active:'tanoby',failures:{}};
 const before=agenda.postgamePresentation(o,state);
 const during=agenda.postgamePresentation({...o,phase:'transition',frame:o.frame+1},state,before);
 assert.equal(during.entries.find(e=>e.id==='league').status,'complete');assert.equal(during.evidenceCurrent,false);
 const restored=agenda.postgamePresentation({...o,phase:'transition',frame:1},state,during);
 assert.equal(restored.entries.find(e=>e.id==='league').status,'unknown');
 o.playerMemory.storyState.flagIds[2092]=false;
 assert.equal(agenda.postgamePresentation(o,state,during).entries.find(e=>e.id==='league').status,'pending');
});

test('the same unsupported task stops retrying after three attempts until relevant game state changes',()=>{
 let plan=new agenda.PostgameAgenda();plan.start();const o=observation();
 for(let i=0;i<3;i++){plan.defer('tanoby','No executable route.',i*4000000,o);plan=new agenda.PostgameAgenda(JSON.parse(JSON.stringify(plan.state)));}
 assert.notEqual(plan.select(o,20000000).id,'tanoby','elapsed cooldown alone cannot repeat a proven failure forever');
 o.playerMemory.position={x:6,y:47};assert.notEqual(plan.select(o,20000001).id,'tanoby','walking alone is not a newly supported route');
 o.playerMemory.storyState.flagIds[2083]=true;assert.equal(plan.select(o,20000002).id,'tanoby','a new traversal capability permits revalidation');
});

test('exhausted postgame work stays deferred after map changes and temporary script flags',()=>{
 let plan=new agenda.PostgameAgenda();plan.start();const o=observation();
 for(let i=0;i<3;i++)plan.defer('tanoby','No executable route.',i*4000000,o);
 plan=new agenda.PostgameAgenda(JSON.parse(JSON.stringify(plan.state)));
 o.playerMemory.map.id='MAP_LAVENDER_TOWN';o.playerMemory.storyState.flagIds[1]=true;
 assert.notEqual(plan.select(o,20000000)?.id,'tanoby');
 assert.equal(plan.state.failures.tanoby.attempts,3);
 o.playerMemory.storyState.flagIds[2083]=true;
 assert.equal(plan.select(o,20000001)?.id,'tanoby');
});

test('exhausted combat preparation retries after a stronger team, not a party reorder',()=>{
 const o=observation();let plan=new agenda.PostgameAgenda();plan.start();
 o.playerMemory.trainer.party.forEach((p,i)=>Object.assign(p,{species:[3,22,53,67,55,149][i],level:70,personality:100+i,otId:10}));
 for(const e of agenda.postgameChecklist(o))if(e.id!=='league-rematch')plan.state.failures[e.id]={retryAt:1e12};
 for(let i=0;i<3;i++)plan.defer('league-rematch','The same battle team lost.',i*4000000,o);
 plan=new agenda.PostgameAgenda(JSON.parse(JSON.stringify(plan.state)));
 o.playerMemory.trainer.party.reverse();
 assert.notEqual(plan.select(o,20000000)?.id,'league-rematch');
 o.playerMemory.trainer.party[0].level+=1;
 assert.equal(plan.select(o,20000001)?.id,'league-rematch','training changes battle readiness');
});

test('upgrading a saved retry context retains its exhausted attempts and cooldown',()=>{
 const o=observation(),plan=new agenda.PostgameAgenda();plan.start();
 plan.state.failures.tanoby={reason:'Retained route failure.',context:'previous-v2-hash',contextVersion:2,attempts:3,retryAt:12345,requiresStateChange:true};
 assert.notEqual(plan.select(o,20000000)?.id,'tanoby');
 assert.equal(plan.state.failures.tanoby.contextVersion,3);
 assert.equal(plan.state.failures.tanoby.attempts,3);
 assert.equal(plan.state.failures.tanoby.retryAt,12345);
 assert.equal(plan.state.failures.tanoby.requiresStateChange,true);
});

test('the agenda keeps a Fly user in the party and withdraws a boxed one',()=>{
 assert.equal(typeof agenda.resolvePostgameObjective,'function');
 const o=observation(),trainer=o.playerMemory.trainer;
 o.playerMemory.map.id='MAP_FIVE_ISLAND_POKEMON_CENTER_1F';
 trainer.party=[...trainer.party.slice(0,5)].map((p,slot)=>({...p,slot,moves:[57,70]}));
 const flyer={slot:5,validity:'valid',species:22,personality:4242,otId:9,level:60,moves:[19,33,39,98],box:0};
 trainer.storage.pokemon=[flyer];
 assert.equal(agenda.postgameChecklist(o).find(x=>x.id==='fly-carrier').status,'pending');
 assert.ok(agenda.postgameChecklist(o).find(x=>x.id==='fly-carrier').executable);
 const objective=agenda.resolvePostgameObjective('fly-carrier',o,{data:{maps:[]}},{});
 assert.equal(objective?.target?.kind,'party-roster');
 assert.deepEqual(objective?.target?.requiredFingerprints,[encounterFingerprint(flyer)]);
 trainer.party[0].moves=[19,57,70];
 assert.equal(agenda.postgameChecklist(o).find(x=>x.id==='fly-carrier').status,'complete');
 assert.equal(agenda.resolvePostgameObjective('fly-carrier',o,{data:{maps:[]}},{}),null);
 trainer.party[0].moves=[57,70];
 trainer.storage.pokemon=[];
 assert.equal(agenda.postgameChecklist(o).find(x=>x.id==='fly-carrier').status,'unknown','no recoverable source cannot stall the agenda');
});

test('a missing Fly user outranks further National Dex collection',()=>{
 const o=observation(),trainer=o.playerMemory.trainer,f=o.playerMemory.storyState.flagIds;
 o.playerMemory.map.id='MAP_FIVE_ISLAND_POKEMON_CENTER_1F';
 for(const id of [2121,147,700,701,702,703,730,611,582,632,606,626,627,748,749,750,566,724,738,2092,2112,2116])f[id]=true;
 trainer.pokedex.ownedSpecies=[9,131,150,144,145,146,175,133,143,243,106,63,35,147,123,137];
 o.playerMemory.postgameEvidence.trainerTower=Array.from({length:4},()=>({receivedPrize:true,bestTimeFrames:1}));
 o.playerMemory.gameStats.leagueEntries=1;
 trainer.party=trainer.party.map((p,slot)=>({...p,slot,moves:[57,70]}));
 trainer.storage.pokemon=[{slot:5,validity:'valid',species:22,personality:4242,otId:9,level:60,moves:[19,33,39,98],box:0}];
 const plan=new agenda.PostgameAgenda();plan.start();
 plan.state.workflows={league:{receipt:{nativeSaveVerified:true,leagueEntries:1,savedGame:1}}};
 assert.equal(plan.select(o,1000).id,'fly-carrier');
});

// The worker releases a blocked automatic hunt back to the durable agenda. Its
// failure must keep the observed context: without it the Slugma hunt retried
// every 5-40 minutes forever from an unchanged save (14 identical stalls).
test('a released blocked hunt stores its failure context and stops retrying the same state',()=>{
 assert.equal(typeof agenda.releaseBlockedHunt,'function');
 const o=observation(),P='MAP_MT_EMBER_RUBY_PATH_';
 let state={schema:'pokemon-suite/postgame-agenda/v1',enabled:true,active:'national-collection',entries:[],failures:{},
  workflows:{dex:{target:{speciesId:218,map:P+'B3F'}}},hunts:{'national-collection':{id:'postgame-national-collection-1'}}};
 for(let i=0;i<3;i++){
  state=agenda.releaseBlockedHunt(JSON.parse(JSON.stringify(state)),'national-collection','repeated-navigation-cycle',o,i*4000000);
  assert.equal(state.hunts['national-collection'],undefined,'the released hunt record is dropped');
  assert.equal(state.failures['national-collection'].context,agenda.postgameFailureContext(o));
  state.workflows.dex.target={speciesId:218,map:P+'B3F'};state.hunts['national-collection']={id:'postgame-national-collection-'+(i+2)};
 }
 assert.equal(state.failures['national-collection'].attempts,3);
 assert.equal(state.failures['national-collection'].requiresStateChange,true,'three identical failures wait for a state change');
 assert.equal(state.workflows.dex.failed[`218:${P}B3F`].requiresStateChange,true,'the floor failure is recorded per species and map');
 assert.equal(state.workflows.dex.failed[218],undefined,'a failed floor does not defer the species everywhere');
});

test('postgame observations carry the Altering Cave wild-set variable',()=>{
 assert.ok(agenda.POSTGAME_WATCH.variables.includes(0x4024),'VAR_ALTERING_CAVE_WILD_SET must be watched for the National Dex selector');
});
