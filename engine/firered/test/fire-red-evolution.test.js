import test from 'node:test';
import assert from 'node:assert/strict';
import {FireRedEvolutionTask, evolutionItemRecommendation, projectedTyrogueBranch,resolveSavedEvolutionSource,selectOwnedDexEvolution} from '../src/suite/fire-red-evolution.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';
const mon=(species=25)=>({validity:'valid',species,personality:123,otId:456,shiny:true,level:25,friendship:70,heldItem:0,slot:2,hp:70,maxHp:70,status1:0,moves:[33],pp:[35],ivs:{hp:20,attack:20,defense:20,speed:20,spAttack:20,spDefense:20},evs:{hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0}});
const observe=p=>({phase:'stable',frame:100,emulator:{mode:'overworld',inBattle:false,inputReady:true},sram:{sha256:'before'},playerMemory:{map:{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F'},position:{x:7,y:8},ui:{},storyState:{flagIds:{2112:true}},gameStats:{savedGame:7},saveAttemptStatus:1,trainer:{money:10000,partyValidity:'valid',party:[p],storage:{validity:'valid',pokemon:[]},bag:{items:[{itemId:96,quantity:1},{itemId:68,quantity:2}]}}}});
const task=(p,target,state=null)=>new FireRedEvolutionTask({requestId:'evolve',sourceId:'caught',pokemon:p,steps:[{kind:'evolve',game:'firered',fromSpecies:p.species,speciesId:target},{kind:'verify',game:'firered',speciesId:target}],request:{game:'firered',speciesId:target,shiny:'required',quantity:1,moves:[],finalLevel:null,heldItemId:null},state});
test('postgame capture receipts cannot replace or make the reserved Eevee ambiguous',()=>{
 const eevee=mon(133),other={...mon(61),personality:789},trainer={partyValidity:'valid',party:[other],storage:{validity:'valid',pokemon:[eevee]}};
 assert.equal(resolveSavedEvolutionSource({sourceSpeciesId:133,proofs:[eevee,eevee,other],trainer}).personality,123);
 assert.throws(()=>resolveSavedEvolutionSource({sourceSpeciesId:133,proofs:[other],trainer}),/identity/);
});
test('National Dex preparation uses ordinary early evolutions and never consumes the reserved ancestor',()=>{
 const kakuna={...mon(14),shiny:false},eevee={...mon(133),shiny:false};
 const trainer={partyValidity:'valid',party:[eevee],storage:{validity:'valid',pokemon:[kakuna]},pokedex:{ownedSpecies:[14,133]},bag:{items:[{itemId:96,quantity:1}]}};
 assert.equal(selectOwnedDexEvolution({trainer,protectedFingerprints:[encounterFingerprint(eevee)],canSupply:()=>false}).rule.speciesId,15);
 kakuna.shiny=true;assert.equal(selectOwnedDexEvolution({trainer,protectedFingerprints:[encounterFingerprint(eevee)],canSupply:()=>false}),null);
});

test('full National Dex evolution includes later generations and level/friendship rules without using shinies or external methods',()=>{
 const p={...mon(246),shiny:false,level:29},trainer={partyValidity:'valid',party:[p],storage:{validity:'valid',pokemon:[]},pokedex:{ownedSpecies:[246]},bag:{}};
 assert.equal(selectOwnedDexEvolution({trainer,scope:'national',canSupply:()=>false})?.rule.speciesId,247);
 p.shiny=true;assert.equal(selectOwnedDexEvolution({trainer,scope:'national',canSupply:()=>false}),null);
 p.shiny=false;p.species=133;assert.equal(selectOwnedDexEvolution({trainer,scope:'national',canSupply:()=>false}),null,'clock evolution needs a partner, and no stone is available');
});
test('stone evolution targets the captured identity and completes only after consumption and a fresh native save',()=>{
 const p=mon(),o=observe(p),e=task(p,26);
 assert.equal(e.inspect(o).objective.target.fingerprint,encounterFingerprint(p));
 assert.equal(e.inspect(o).objective.target.itemId,96);
 const unrelated={...p,personality:999,species:26};o.playerMemory.trainer.party.push(unrelated);
 assert.equal(e.inspect(o).objective.target.kind,'evolve-with-item');
 o.playerMemory.trainer.party[0]={...p,species:26};o.playerMemory.trainer.bag.items[0].quantity=0;
 assert.equal(e.inspect(o).objective.target.kind,'save-game');
 assert.equal(e.inspect(o).objective.target.saveVerified,false);
 o.playerMemory.gameStats.savedGame=8;o.sram.sha256='after';
 const restored=task(p,26,e.state);assert.equal(restored.inspect(o).kind,'complete');
 assert.equal(restored.state.receipt.pokemon.personality,123);
 assert.equal(restored.state.receipt.nativeSaveVerified,true);
});
test('a changed species without the consumed stone is not accepted as an evolution receipt',()=>{
 const p=mon(),o=observe(p),e=task(p,26);e.inspect(o);o.playerMemory.trainer.party[0]={...p,species:26};
 assert.equal(e.inspect(o).kind,'stop');
});
test('an incidental capture save before evolution cannot certify the evolved individual',()=>{
 const p=mon(),o=observe(p);let e=task(p,26);e.inspect(o);
 o.playerMemory.gameStats.savedGame=8;o.sram.sha256='incidental-catch';
 e.inspect(o);
 o.playerMemory.trainer.party[0]={...p,species:26};o.playerMemory.trainer.bag.items[0].quantity=0;
 let next=e.inspect(o);
 assert.equal(next.kind,'policy');assert.equal(next.objective.target.kind,'save-game');
 assert.equal(next.objective.target.saveVerified,false,'require a save after the evolution was observed');
 e=task(p,26,JSON.parse(JSON.stringify(e.state)));next=e.inspect(o);
 assert.equal(next.objective.target.saveVerified,false);
 o.playerMemory.gameStats.savedGame=9;o.sram.sha256='evolved-save';
 assert.equal(e.inspect(o).kind,'complete');assert.equal(e.state.receipt.savedSramSha256,'evolved-save');
 assert.equal(e.state.receipt.nativeSaveAfterEvolution,true);
});
test('legacy evolution checkpoints require a fresh post-evolution save even if an old save counter matches',()=>{
 const p=mon(),o=observe(p);let e=task(p,26);e.inspect(o);
 const old=JSON.parse(JSON.stringify(e.state));old.phase='saving';delete old.evolutionSave;
 o.playerMemory.trainer.party[0]={...p,species:26};o.playerMemory.trainer.bag.items[0].quantity=0;
 o.playerMemory.gameStats.savedGame=8;o.sram.sha256='unknown-old-save';
 e=task(p,26,old);assert.equal(e.inspect(o).objective.target.saveVerified,false);
 o.playerMemory.gameStats.savedGame=9;o.sram.sha256='fresh-evolved-save';
 assert.equal(e.inspect(o).kind,'complete');
});
test('withdraws the exact source and removes Everstone through the party menu',()=>{
 const p={...mon(),heldItem:195},o=observe(p),e=task(p,26);o.playerMemory.trainer.party=[];o.playerMemory.trainer.storage.pokemon=[p];
 assert.deepEqual(e.inspect(o).objective.target.requiredFingerprints,[encounterFingerprint(p)]);
 o.playerMemory.trainer.party=[p];o.playerMemory.trainer.storage.pokemon=[];
 assert.equal(e.inspect(o).objective.target.kind,'take-held-item');
 o.playerMemory.ui.party={stage:'selection-menu',selectedPartySlot:2,actions:['give-item','take-item','cancel']};
 assert.equal(evolutionItemRecommendation(o,e.inspect(o).objective).targetAction,'take-item');
});
test('ordinary friendship waits for the National Dex and friendship before using a level-up',()=>{
 const p=mon(113),o=observe(p),e=task(p,242);o.playerMemory.storyState.flagIds[2112]=false;
 assert.equal(e.inspect(o).kind,'national-dex');
 o.playerMemory.storyState.flagIds[2112]=true;
 assert.equal(e.inspect(o).objective.target.kind,'friendship-walk');
 p.friendship=220;assert.equal(e.inspect(o).objective.target.itemId,68);
});
test('FireRed never tries local time evolution, even with enough friendship',()=>{
 for(const target of [196,197]){const p={...mon(133),friendship:255},e=task(p,target);const d=e.inspect(observe(p));assert.equal(d.kind,'external');assert.equal(d.game,'emerald');}
});
test('level 100 cannot be evolved by a Rare Candy; an already beautiful Feebas can evolve locally',()=>{
 const p={...mon(10),level:100};assert.equal(task(p,11).inspect(observe(p)).kind,'stop');
 const f={...mon(328),beauty:169,sheen:255},e=new FireRedEvolutionTask({requestId:'feebas',sourceId:'caught',pokemon:f,steps:[{kind:'evolve',game:'firered',fromSpecies:349,speciesId:350}],request:{speciesId:350,shiny:'required'}});
 assert.equal(e.inspect(observe(f)).kind,'external');f.beauty=170;assert.equal(e.inspect(observe(f)).objective.target.itemId,68);
});
test('Wurmple fixed branch is checked before any training, while Shedinja requires party space',()=>{
 const w=mon(290);w.personality=6<<16;
 const make=(p,from,to)=>new FireRedEvolutionTask({requestId:'special',sourceId:'caught',pokemon:p,steps:[{kind:'evolve',game:'firered',fromSpecies:from,speciesId:to}],request:{speciesId:to,shiny:'required'}});
 assert.equal(make(w,265,266).inspect(observe(w)).kind,'stop');
 const n=mon(301),o=observe(n);o.playerMemory.trainer.party=[n,...Array.from({length:5},(_,i)=>({...mon(16),personality:1000+i,slot:i+1}))];
 const e=make(n,290,292);assert.equal(e.inspect(o).objective.target.maximumPartySize,5);
 o.playerMemory.trainer.party.pop();assert.equal(e.inspect(o).objective.target.itemId,68);
 o.playerMemory.trainer.party[0]={...n,species:303};assert.equal(e.inspect(o).kind,'stop');
});
test('a requested Ninjask accepts the cartridge-created bonus Shedinja and still saves both',()=>{
 const p=mon(301),o=observe(p),e=new FireRedEvolutionTask({requestId:'ninjask',sourceId:'caught',pokemon:p,steps:[{kind:'evolve',game:'firered',fromSpecies:290,speciesId:291}],request:{speciesId:291,shiny:'required'}});
 e.inspect(o);o.playerMemory.trainer.party=[{...p,species:302},{...p,species:303,slot:3}];
 assert.equal(e.inspect(o).objective.target.kind,'save-game');
});
test('Tyrogue reserves a Rare Candy so battle EVs cannot change its final branch during the trigger',()=>{
 const p={...mon(236),personality:0,evs:{...mon().evs,attack:20}},o=observe(p),e=task(p,106);
 o.playerMemory.trainer.bag.items=[];assert.equal(e.inspect(o).kind,'supply');assert.equal(e.inspect(o).item.nativeId,68);
});
test('Tyrogue compares projected level-up stats, including nature and EV rounding',()=>{
 const p={...mon(236),level:19,personality:0,ivs:{...mon().ivs,attack:0,defense:0},evs:{attack:0,defense:0}};
 assert.equal(projectedTyrogueBranch(p,20),0);
 p.evs.attack=20;assert.equal(projectedTyrogueBranch(p,20),1);
 p.evs.attack=0;p.evs.defense=20;assert.equal(projectedTyrogueBranch(p,20),-1);
 p.personality=3;p.evs={attack:0,defense:0};assert.equal(projectedTyrogueBranch(p,20),1);
});
test('Tyrogue prepares its branch with a real vitamin before allowing a level-up',()=>{
 const p={...mon(236),level:19,personality:0},o=observe(p),e=task(p,106);
 o.playerMemory.trainer.bag.items.push({itemId:64,quantity:1});
 assert.equal(e.inspect(o).objective.target.itemId,64);
 p.evs.attack=10;assert.equal(e.inspect(o).objective.target.itemId,64);
 p.evs.attack=20;assert.equal(e.inspect(o).objective.target.itemId,68);
});
test('held-item trades equip the native item and keep the exchange pending for a separate owner',()=>{
 const p=mon(117),o=observe(p);o.playerMemory.trainer.bag.items.push({itemId:201,quantity:1});
 const e=new FireRedEvolutionTask({requestId:'kingdra',sourceId:'caught',pokemon:p,steps:[{kind:'equip-evolution-item',game:'firered',speciesId:117,item:{nativeId:201}},{kind:'trade',fromGame:'firered',toGame:'emerald',speciesId:117,evolution:{fromSpecies:117,speciesId:230}}],request:{speciesId:230,shiny:'required'}});
 assert.equal(e.inspect(o).objective.target.kind,'give-held-item');p.heldItem=201;
 assert.equal(e.inspect(o).kind,'external');assert.notEqual(e.state.phase,'complete');
});

test('plain Gen III trade evolution removes Everstone before handing the source to the partner',()=>{
 const p={...mon(64),heldItem:195},o=observe(p),e=new FireRedEvolutionTask({requestId:'alakazam',sourceId:'caught',pokemon:p,steps:[{kind:'trade',fromGame:'firered',toGame:'emerald',speciesId:64,evolution:{fromSpecies:64,speciesId:65,removeEverstone:true}}],request:{speciesId:65,shiny:'required'}});
 assert.equal(e.inspect(o).objective.target.kind,'take-held-item');
 p.heldItem=0;assert.equal(e.inspect(o).kind,'external');
});
test('a final held item requires its own save after the evolution save',()=>{
 const p=mon(),o=observe(p),e=new FireRedEvolutionTask({requestId:'final-item',sourceId:'caught',pokemon:p,steps:[{kind:'evolve',game:'firered',fromSpecies:25,speciesId:26},{kind:'equip-final-item',game:'firered',speciesId:26,item:{nativeId:200}},{kind:'verify',game:'firered',speciesId:26}],request:{speciesId:26,shiny:'required'}});
 e.inspect(o);o.playerMemory.trainer.party[0]={...p,species:26};o.playerMemory.trainer.bag.items[0].quantity=0;e.inspect(o);o.playerMemory.gameStats.savedGame=8;o.sram.sha256='evolved';o.playerMemory.trainer.bag.items.push({itemId:200,quantity:1});
 assert.equal(e.inspect(o).objective.target.kind,'give-held-item');o.playerMemory.trainer.party[0].heldItem=200;
 assert.equal(e.inspect(o).objective.target.kind,'save-game');assert.notEqual(e.state.phase,'complete');
 o.playerMemory.gameStats.savedGame=9;o.sram.sha256='final';assert.equal(e.inspect(o).kind,'complete');assert.equal(e.state.receipt.pokemon.heldItem,200);
});
test('item menus never select another member of the same species or give a stone when Use was requested',()=>{
 const p=mon(),o=observe(p);o.playerMemory.trainer.party.unshift({...p,slot:0,personality:987});
 const objective={id:'stone',target:{kind:'evolve-with-item',fingerprint:encounterFingerprint(p),itemId:96}};
 o.playerMemory.ui.party={stage:'choose-pokemon',itemId:96};assert.equal(evolutionItemRecommendation(o,objective).targetPartySlot,2);
 o.playerMemory.ui={bag:{stage:'context',selectedItemId:96}};assert.equal(evolutionItemRecommendation(o,objective).targetAction,'use');
});

test('a final held berry is given through the Berry Pouch Key Item, not a fifth Bag pocket',()=>{
 // FireRed's Bag has Items, Key Items and Poké Balls. Berries live in the
 // Berry Pouch (item 365): Key Items > Berry Pouch > Open > berry > Give.
 // The former pocket-4 route pressed Right forever in the native Bag.
 const p=mon(),o=observe(p),e=new FireRedEvolutionTask({requestId:'berry',sourceId:'caught',pokemon:p,steps:[{kind:'equip-final-item',game:'firered',speciesId:25,item:{nativeId:141}}],request:{speciesId:25,shiny:'required'}});
 o.playerMemory.trainer.bag.berries=[{itemId:141,quantity:2}];
 o.playerMemory.trainer.bag.keyItems=[{itemId:362,quantity:1},{itemId:365,quantity:1}];
 const next=e.inspect(o);assert.equal(next.kind,'policy');
 o.playerMemory.ui.bag={stage:'list',pocket:0};assert.equal(evolutionItemRecommendation(o,next.objective).targetPocket,1);
 o.playerMemory.ui.bag.pocket=1;assert.deepEqual(evolutionItemRecommendation(o,next.objective),{kind:'choose-bag-item',targetItemId:365,targetIndex:1});
 o.playerMemory.ui.bag={stage:'context',pocket:1,selectedItemId:365};assert.equal(evolutionItemRecommendation(o,next.objective).targetAction,'open');
 o.playerMemory.ui.bag={stage:'berry-pouch-list',pocket:4,index:0};assert.equal(evolutionItemRecommendation(o,next.objective).targetIndex,0);
 o.playerMemory.ui.bag={stage:'berry-pouch-context',pocket:4,selectedItemId:141,actions:['use','give','exit']};
 assert.deepEqual(evolutionItemRecommendation(o,next.objective),{kind:'choose-bag-context-action',targetAction:'give',targetIndex:1});
});

test('field lead preparation swaps the exact Fly carrier with the current lead through native menus',()=>{
 const p={...mon(18),slot:1,moves:[19,33]},o=observe(p),objective={id:'travel-lead',target:{kind:'lead-party-member',fingerprint:encounterFingerprint(p)}};
 o.playerMemory.trainer.party.unshift({...mon(12),slot:0,personality:456});
 o.playerMemory.ui.party={stage:'selection-menu',selectedPartySlot:1,actions:['summary','fly','switch','item','cancel']};
 assert.equal(evolutionItemRecommendation(o,objective).targetAction,'switch');
 o.playerMemory.ui.party={stage:'choose-switch-target',selectedPartySlot:1};assert.equal(evolutionItemRecommendation(o,objective).targetPartySlot,0);
});

test('evolution PC and friendship preparation stay in the current Sevii region',()=>{
 const p=mon(113),o=observe(p),e=task(p,242);o.playerMemory.map.id='MAP_FOUR_ISLAND_ICEFALL_CAVE_1F';
 assert.equal(e.inspect(o).objective.target.map,'MAP_FOUR_ISLAND_POKEMON_CENTER_1F');
 o.playerMemory.trainer.party=[];o.playerMemory.trainer.storage.pokemon=[p];
 assert.equal(e.inspect(o).objective.target.map,'MAP_FOUR_ISLAND_POKEMON_CENTER_1F');
});
