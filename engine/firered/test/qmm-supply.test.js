import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeMailState,decodeEasyChatState,partyPromptStage,decodeBattleItemState,BOX3_SLOT1_OFFSET,MAIL_BYTES} from '../src/evidence/mail-state.js';
import {QmmSupplyTask,qmmPartyHoldsMail,qmmRenewable,QMM_SETUP_TRAINER,partyOrderRecommendation} from '../src/suite/qmm-supply.js';
import {PlayerTask} from '../src/suite/player-task.js';
import {canYieldPostgame} from '../src/suite/postgame.js';
import {TradePreparation} from '../src/suite/trade-preparation.js';
import {FireRedEvolutionTask} from '../src/suite/fire-red-evolution.js';
import {mapRecommendation} from '../src/player/delegator.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// ---- synthetic bytes --------------------------------------------------------
const MAIL_OFFSET=0x100;
function save1WithMail(items){
 const save1=new Uint8Array(MAIL_OFFSET+16*MAIL_BYTES);
 items.forEach((item,slot)=>{const o=MAIL_OFFSET+slot*MAIL_BYTES;save1[o+0x20]=item&0xff;save1[o+0x21]=item>>8;save1[o+0x1e]=122;});
 return save1;
}
function partyBytes(mailIds){const b=new Uint8Array(600);mailIds.forEach((id,slot)=>{b[slot*100+0x55]=id;});return b;}

test('mail readout finds an allocated party mail slot that no holder references',()=>{
 const save1=save1WithMail([132,132]);
 const party=[{slot:0,heldItem:134},{slot:1,heldItem:132},{slot:2,heldItem:0}];
 const storage=new Uint8Array(BOX3_SLOT1_OFFSET+80);
 const state=decodeMailState({save1,mailOffset:MAIL_OFFSET,partyBytes:partyBytes([0,1,255]),party,storageBytes:storage});
 assert.equal(state.allocatedPartySlots,2);
 assert.deepEqual(state.orphanSlots,[0],'slot 0 is linked from a berry holder, so nothing holds its Mail');
 assert.deepEqual(state.party.map(m=>[m.mailId,m.hasMail,m.linked]),[[0,false,false],[1,true,true],[255,false,false]]);
 assert.equal(state.partyHoldsMail,true);
 assert.equal(state.box3Slot1.empty,true);
 storage[BOX3_SLOT1_OFFSET]=7;
 assert.equal(decodeMailState({save1,mailOffset:MAIL_OFFSET,partyBytes:partyBytes([0,1,255]),party,storageBytes:storage}).box3Slot1.empty,false);
 assert.equal(decodeMailState({save1,mailOffset:undefined,partyBytes:null,party}),null,'no Mail field, no guessed state');
});

test('the Easy Chat readout identifies the question-mark alias of Box 3 slot 1 and input readiness',()=>{
 const sb1=0x02025534,storage=sb1+0x3de8,screen=new Uint8Array(0x2c);
 screen[4]=4;screen[7]=9;new DataView(screen.buffer).setUint32(0x14,storage+BOX3_SLOT1_OFFSET,true);
 const alias=decodeEasyChatState({screen,menuCursor:1,taskState:1,saveBlock1Pointer:sb1,mailOffset:0x2cd0,storagePointer:storage,words:Array(9).fill(0)});
 assert.equal(alias.stage,'confirm-quit');assert.equal(alias.menuCursor,1);assert.equal(alias.aliasesBox3Slot1,true);
 assert.equal(alias.mailIndex,255,'SB1+0x2CD0+255*0x24 is gPokemonStorage+0x12C4');
 assert.equal(alias.edited,false);assert.equal(alias.inputReady,true);
 assert.equal(decodeEasyChatState({screen,taskState:2}).inputReady,false,'interface commands still running');
 assert.equal(decodeEasyChatState({screen,taskState:1,fading:true}).inputReady,false);
 new DataView(screen.buffer).setUint32(0x14,sb1+0x2cd0,true);screen[4]=0;
 const own=decodeEasyChatState({screen,taskState:1,saveBlock1Pointer:sb1,mailOffset:0x2cd0,storagePointer:storage,words:[1,0,0,0,0,0,0,0,0]});
 assert.equal(own.mailIndex,0);assert.equal(own.aliasesBox3Slot1,false);assert.equal(own.edited,true);assert.equal(own.stage,'field');
});

test('the three party Mail prompts and battle item marks are decoded from native task and struct state',()=>{
 assert.equal(partyPromptStage(['Task_PrintAndWaitForText','Task_HandleSwitchItemsFromBagYesNoInput']),'confirm-switch-item');
 assert.equal(partyPromptStage(['Task_HandleSendMailToPCYesNoInput']),'confirm-send-mail-to-pc');
 assert.equal(partyPromptStage(['Task_HandleLoseMailMessageYesNoInput']),'confirm-lose-mail');
 assert.equal(partyPromptStage(['Task_HandleChooseMonInput']),null);
 const battleStruct=new Uint8Array(0x200);battleStruct[0xb8]=134;const knock=new Uint8Array(44);knock[41]=4;
 assert.deepEqual(decodeBattleItemState(battleStruct,knock),{usedHeldItems:[134,0,0,0],knockedOffMons:[4,0]});
 assert.deepEqual(decodeBattleItemState(null,null),{usedHeldItems:null,knockedOffMons:null});
});

test('a party Yes/No prompt maps its own cursor, not a stale choice menu',()=>{
 const o={playerMemory:{ui:{party:{stage:'confirm-send-mail-to-pc',cursor:0}}}};
 assert.deepEqual(mapRecommendation({kind:'choose-menu-option',targetOption:'no',targetIndex:1},o).buttons,['down']);
 o.playerMemory.ui.party.cursor=1;
 assert.deepEqual(mapRecommendation({kind:'choose-menu-option',targetOption:'no',targetIndex:1},o).buttons,['a']);
});

// ---- task fixtures ------------------------------------------------------------
let personality=1000;
const mon=(species,level,{moves=[1],heldItem=0,slot=0,box,hp=100,maxHp=100,abilityNum=0}={})=>({validity:'valid',species,level,slot,...(box!==undefined?{box}:{}),
 personality:personality++,otId:1706568373,ivs:{hp:1,attack:1,defense:1,speed:1,spAttack:1,spDefense:1},moves,pp:moves.map(()=>10),heldItem,hp,maxHp,status1:0,isEgg:false,abilityNum});
const mechanics={data:{
 species:Object.assign([],{47:{abilities:['ABILITY_EFFECT_SPORE']},143:{abilities:['ABILITY_IMMUNITY','ABILITY_THICK_FAT']},122:{abilities:['ABILITY_SOUNDPROOF']},83:{abilities:['ABILITY_KEEN_EYE']},22:{abilities:['ABILITY_KEEN_EYE']},149:{abilities:['ABILITY_INNER_FOCUS']},97:{abilities:['ABILITY_INSOMNIA']},21:{abilities:['ABILITY_KEEN_EYE']},63:{abilities:['ABILITY_SYNCHRONIZE']}}),
 moves:Object.assign([],{1:{id:1,power:40,type:'TYPE_NORMAL',target:'MOVE_TARGET_SELECTED',accuracy:100},147:{id:147,power:0,target:'MOVE_TARGET_SELECTED'},282:{id:282,power:20,target:'MOVE_TARGET_SELECTED',type:'TYPE_DARK'},
  278:{id:278,power:0,target:'MOVE_TARGET_USER'},115:{id:115,power:0,target:'MOVE_TARGET_USER'},281:{id:281,power:0,target:'MOVE_TARGET_SELECTED'},156:{id:156,power:0,target:'MOVE_TARGET_USER'},
  14:{id:14,power:0,target:'MOVE_TARGET_USER'},65:{id:65,power:80,type:'TYPE_FLYING',target:'MOVE_TARGET_SELECTED',accuracy:100}}),
 typeChart:[]}};
const planner={selectRecovery:()=>({id:'heal',target:{kind:'object',map:'MAP_CELADON_CITY_POKEMON_CENTER_1F',index:0}}),selectItemPreparation:()=>({id:'seed',target:{kind:'object',map:'MAP_MT_MOON_1F',index:10}}),selectIncomePreparation:()=>null};
const world={data:{maps:[]}},story={data:{scripts:[],symbols:{}}};
function cast(){
 personality=1000;
 return {berry:mon(143,30,{moves:[29,281,156],heldItem:134,slot:0}),sleeper:mon(47,49,{moves:[141,147],slot:1}),recycle:mon(122,33,{moves:[112,93,115,278],slot:2}),
  knock:mon(83,32,{moves:[31,282,14],slot:3}),fearow:mon(22,100,{moves:[65],slot:4}),dragonite:mon(149,90,{moves:[1],slot:5})};
}
function observation({party,storage=[],items=[],berries=[],mail=null,flags={},ui={},map='MAP_CELADON_CITY_POKEMON_CENTER_1F',saved=10}){
 const links=mail?.links??party.map(()=>255);
 const slots=mail?.slots??Array(16).fill(0);
 const holds=p=>p.heldItem>=121&&p.heldItem<=132;
 const partyLinks=party.map((p,i)=>({slot:i,heldItem:p.heldItem,mailId:links[i],hasMail:holds(p)&&links[i]!==255,linked:holds(p)&&links[i]<6}));
 const referenced=new Set(partyLinks.filter(x=>x.hasMail).map(x=>x.mailId));
 return {frame:100,phase:'stable',phaseReasons:[],sram:{sha256:`sram-${saved}`},emulator:{mode:'overworld',inBattle:false,inputReady:true},
  playerMemory:{map:{id:map},position:{x:7,y:4},ui,saveAttemptStatus:1,gameStats:{savedGame:saved},storyState:{flagIds:flags},vsSeeker:{batterySteps:100,rematchEntries:Array(100).fill(0)},
   mail:{slots:slots.map((itemId,slot)=>({slot,itemId,species:122})),party:partyLinks,allocatedPartySlots:slots.slice(0,6).filter(Boolean).length,
    orphanSlots:slots.slice(0,6).map((v,i)=>v&&!referenced.has(i)?i:-1).filter(i=>i>=0),partyHoldsMail:party.some(holds),box3Slot1:{empty:mail?.box3Empty??true,head:Array(18).fill(0)}},
   trainer:{partyValidity:'valid',money:10000,party:party.map((p,i)=>({...p,slot:i})),storage:{validity:'valid',pokemon:storage,boxCounts:Array(14).fill(0)},
    bag:{items,keyItems:[{itemId:365,quantity:1}],berries,pokeBalls:[]}}}};
}
const task=(extra={})=>new QmmSupplyTask({requestId:'test',stockTarget:13,world,story,mechanics,planner,...extra});

test('detect uses an existing reserved mail slot and skips the setup battle',()=>{
 const c=cast(),o=observation({party:Object.values(c),mail:{slots:[132,0,0,0,0,0],links:[255,255,0,255,255,255]},items:[{itemId:68,quantity:1},{itemId:132,quantity:19}]});
 const t=task();t.inspect(o);
 assert.equal(t.state.phase,'session');assert.deepEqual(t.state.orphanSlots,[0]);
 assert.equal(qmmRenewable(o),true);
});

test('detect refuses the player’s own Mail but resumes a prepared Recycle user',()=>{
 const c=cast();c.fearow.heldItem=127;
 const own=observation({party:Object.values(c),mail:{slots:[127,0,0,0,0,0],links:[255,255,255,255,0,255]}});
 assert.equal(task().inspect(own).kind,'stop');
 const d=cast();d.recycle.heldItem=132;
 const prepared=observation({party:Object.values(d),mail:{slots:[132,0,0,0,0,0],links:[255,255,0,255,255,255]},items:[{itemId:132,quantity:19}]});
 const t=task();t.inspect(prepared);
 assert.notEqual(t.state.phase,'stopped');
 assert.equal(t.state.originalParty[2].heldItem,0,'Mail is never restored as an original held item');
});

test('prerequisites use the cartridge trades: capture a Spearow, then trade it for Knock Off',()=>{
 const c=cast();delete c.knock;
 const party=Object.values(c);let t=task();
 let next=t.inspect(observation({party,items:[{itemId:132,quantity:5}]}));
 assert.equal(next.objective.target.kind,'encounter-zone');assert.equal(next.objective.target.map,'MAP_ONE_ISLAND_KINDLE_ROAD');
 assert.deepEqual(next.objective.captureSpecies,[21]);assert.equal(next.objective.identityEvolution,true,'held-item equip advice stays off');
 const spearow=mon(21,32,{box:1,slot:3});
 t=task();next=t.inspect(observation({party,storage:[spearow],items:[{itemId:132,quantity:5}]}));
 assert.equal(next.objective.target.kind,'party-roster');assert.deepEqual(next.objective.target.requiredFingerprints,[encounterFingerprint(spearow)]);
 assert.deepEqual(next.objective.target.avoidDepositBoxes,[2]);
 t=task();next=t.inspect(observation({party:[...party.slice(0,5),mon(21,32)],items:[{itemId:132,quantity:5}]}));
 assert.deepEqual(next.objective.target,{kind:'in-game-trade',map:'MAP_VERMILION_CITY_HOUSE2',index:0,requestedSpecies:21,receivedSpecies:83});
 t=task();next=t.inspect(observation({party,flags:{0x24d:true}}));
 assert.equal(next.kind,'stop');assert.match(next.reason,/Knock Off/);
});

test('prerequisites train the traded Mr. Mime to Recycle with the move required',()=>{
 const c=cast();c.recycle={...c.recycle,level:20,moves:[112,93,115,96]};
 const next=task().inspect(observation({party:Object.values(c),items:[{itemId:132,quantity:5}],flags:{0x248:true}}));
 assert.equal(next.objective.minimumCoreLevel,33);assert.deepEqual(next.objective.learnMoveIds,[278]);
 assert.equal(next.objective.trainingFingerprint,encounterFingerprint(c.recycle));
 const d=cast();d.recycle={...d.recycle,level:40,moves:[112,93,115,96]};
 assert.match(task().inspect(observation({party:Object.values(d),flags:{0x248:true}})).reason,/does not know Recycle/);
 // Native run: the level-up to 33 was read before its "learn Recycle?" prompt,
 // the supply stopped, and the plain field policy then declined Recycle.
 const e=cast();e.recycle={...e.recycle,level:33,moves:[112,93,345,60]};
 const prompt=observation({party:Object.values(e),items:[{itemId:132,quantity:5}],flags:{0x248:true},ui:{moveLearning:{stage:'confirm-replace',partySlot:2,moveId:278}}});
 prompt.emulator={mode:'battle',inBattle:true,inputReady:true};
 const training=task();training.state.phase='prerequisites';training.state.originalParty=[];
 const kept=training.inspect(prompt);
 assert.equal(kept.kind,'policy','the training objective stays through the prompt');assert.deepEqual(kept.objective.learnMoveIds,[278]);
 assert.equal(training.state.phase,'prerequisites');
});

test('setup assembles the exact order, gives written Mail, heals and saves before the battle',()=>{
 const c=cast(),order=[c.berry,c.sleeper,c.recycle,c.knock,c.fearow,c.dragonite];
 const t=task();
 let next=t.inspect(observation({party:[c.sleeper,c.berry,c.recycle,c.knock,c.fearow,c.dragonite],items:[{itemId:132,quantity:19}]}));
 assert.equal(t.state.phase,'setup');
 assert.equal(next.kind,'recommendation');assert.equal(next.recommendation.kind,'open-start-menu','party SWITCH through the start menu');
 const ordered=observation({party:order,items:[{itemId:132,quantity:19}]});
 next=t.inspect(ordered);
 assert.equal(t.state.mailStep.kind,'write');assert.equal(t.state.itemOp,`give-held-item:${encounterFingerprint(c.recycle)}:132`);
 const mailed=observation({party:order.map(p=>p===c.recycle?{...p,heldItem:132}:p),mail:{slots:[132,0,0,0,0,0],links:[255,255,0,255,255,255]},items:[{itemId:132,quantity:18}]});
 mailed.playerMemory.trainer.party[0].hp=40;
 next=t.inspect(mailed);assert.equal(next.objective.id,'heal','heal before the pre-battle save');
 mailed.playerMemory.trainer.party[0].hp=100;
 next=t.inspect(mailed);assert.equal(next.objective.target.kind,'save-game');
 mailed.playerMemory.ui={startMenu:{order:['pokemon','bag','save']}};
 assert.equal(t.inspect(mailed).objective.target.kind,'save-game','the save owns its menus; no close-menu loop');
 const saved=observation({party:mailed.playerMemory.trainer.party,mail:{slots:[132,0,0,0,0,0],links:[255,255,0,255,255,255]},saved:11});
 t.inspect(saved);
 assert.equal(t.state.phase,'battle');assert.deepEqual([t.state.setup.preBattleSave.counter,t.state.setup.preBattleSave.sha256],[11,'sram-11']);
 const approach=t.inspect(saved);
 assert.deepEqual(approach.objective.target,{kind:'object',map:QMM_SETUP_TRAINER.map,index:QMM_SETUP_TRAINER.objectIndex});
});

function battleObservation(t,{left,right,usedLeft=0,knocked=0,turn=0,battler=0,leftItem,flags=8,trainerId=487}){
 const party=t._party,idx=p=>party.findIndex(q=>q.species===p.species);
 const b=p=>({battler:0,species:p.species,hp:p.hp,maxHp:p.maxHp,moves:p.moves,pp:p.moves.map(()=>10),item:p.heldItem,status1:0,level:p.level,types:[0,0],stats:{attack:50,defense:50,spAttack:50,spDefense:50}});
 const foes=[{battler:1,species:4,hp:60,maxHp:60,moves:[1],pp:[10],types:[10,10],stats:{attack:40,defense:40,spAttack:40,spDefense:40},level:29},{battler:3,species:7,hp:60,maxHp:60,moves:[1],pp:[10],types:[11,11],stats:{attack:40,defense:40,spAttack:40,spDefense:40},level:29}];
 const o=observation({party,mail:{slots:[132,0,0,0,0,0],links:party.map(p=>p.species===122?0:255)}});
 o.emulator={mode:'battle',inBattle:true,inputReady:true};o.playerMemory.battleTypeFlags=flags;
 const battlers=[{...b(left),battler:0,item:leftItem??left.heldItem},foes[0],{...b(right),battler:2},foes[1]];
 o.playerMemory.battle={trainerId,turn,battlers,battlerPartyIndexes:[idx(left),0,idx(right),1],usedHeldItems:[usedLeft,0,0,0],knockedOffMons:[knocked,0]};
 o.playerMemory.ui={battle:{stage:'action',battler,cursor:0}};
 return o;
}
function battleTask(){
 const c=cast(),t=task();t._party=[c.berry,c.sleeper,c.recycle,c.knock,c.fearow,c.dragonite];
 t.state.phase='battle';t.state.setup.preBattleSave={counter:11,sha256:'sram-11'};
 t.state.setup.roles=Object.fromEntries(Object.entries({berry:c.berry,sleeper:c.sleeper,recycle:c.recycle,knockOff:c.knock,finisherA:c.fearow,finisherB:c.dragonite}).map(([k,p])=>[k,encounterFingerprint(p)]));
 return {t,c};
}
const choice=t=>t.state.setup.battle.pending;

test('the setup battle follows the berry, switch, Knock Off, Recycle plan from battle memory',()=>{
 const {t,c}=battleTask();
 t.inspect(battleObservation(t,{left:c.berry,right:c.sleeper,battler:2}));
 assert.deepEqual({command:choice(t).command,moveSlot:choice(t).moveSlot,target:choice(t).target},{command:'fight',moveSlot:1,target:0},'Spore targets the left ally');
 t.inspect(battleObservation(t,{left:c.berry,right:c.sleeper,usedLeft:134,turn:1,battler:0}));
 assert.deepEqual([choice(t).command,choice(t).fingerprint],['switch',encounterFingerprint(c.recycle)]);
 t.inspect(battleObservation(t,{left:c.berry,right:c.sleeper,usedLeft:134,turn:1,battler:2}));
 assert.deepEqual([choice(t).command,choice(t).fingerprint],['switch',encounterFingerprint(c.knock)]);
 const withMail={...c.recycle,heldItem:132};
 t.inspect(battleObservation(t,{left:withMail,right:c.knock,usedLeft:134,turn:2,battler:0,leftItem:132}));
 assert.equal(c.recycle.moves[choice(t).moveSlot],115,'Mr. Mime is faster; it protects instead of a failing Recycle');
 t.inspect(battleObservation(t,{left:withMail,right:c.knock,usedLeft:134,turn:2,battler:2,leftItem:132}));
 assert.deepEqual([c.knock.moves[choice(t).moveSlot],choice(t).target],[282,0],'Knock Off targets the Mail holder');
 t.inspect(battleObservation(t,{left:withMail,right:c.knock,usedLeft:134,knocked:4,turn:3,battler:0,leftItem:0}));
 assert.equal(c.recycle.moves[choice(t).moveSlot],278);
 t.inspect(battleObservation(t,{left:withMail,right:c.knock,usedLeft:0,knocked:4,turn:4,battler:0,leftItem:134}));
 assert.equal(t.state.setup.battle.recycled,true);
 assert.deepEqual([choice(t).command,choice(t).fingerprint],['switch',encounterFingerprint(c.fearow)]);
 t.inspect(battleObservation(t,{left:withMail,right:c.knock,usedLeft:0,knocked:4,turn:4,battler:2,leftItem:134}));
 assert.deepEqual([choice(t).command,choice(t).fingerprint],['switch',encounterFingerprint(c.dragonite)],'the second battler never repeats this turn’s switch');
});

test('only the setup trainer’s battle is choreographed',()=>{
 const {t,c}=battleTask();
 assert.equal(t.inspect(battleObservation(t,{left:c.berry,right:c.sleeper,flags:4,trainerId:0})).kind,'defer');
 assert.equal(t.state.setup.battle,null);
});

test('a failed setup attempt power-cycles to the pre-battle save and verifies it before retrying',()=>{
 const {t,c}=battleTask(),party=t._party;
 t.inspect(battleObservation(t,{left:c.berry,right:c.sleeper,battler:0}));
 const field=observation({party,saved:11,mail:{slots:Array(16).fill(0)}});field.sram.sha256='sram-after-battle';
 assert.equal(t.inspect(field).kind,'power-cycle');assert.equal(t.state.receipts[0].kind,'setup-battle-failed');
 const title={frame:5,phase:'stable',emulator:{mode:'boot',callback2:'CB2_TitleScreenRun',inputReady:true},playerMemory:{ui:{}}};
 t.titleScreenDelay(title);
 const wrong=observation({party,saved:12});
 assert.equal(t.inspect(wrong).kind,'stop','Continue must land on the exact pre-battle save');
 const again=battleTask();again.t.inspect(battleObservation(again.t,{left:c.berry,right:c.sleeper}));
 again.t.inspect(field);
 const cont=observation({party:again.t._party,saved:11});
 // A checkpoint restored after the failed battle (crash before the reset) has
 // the same SRAM but never booted: cycle again rather than accept that field.
 assert.equal(again.t.inspect(cont).kind,'power-cycle');
 again.t.titleScreenDelay(title);
 const next=again.t.inspect(cont);
 assert.equal(again.t.state.setup.powerCycle,null);assert.equal(next.objective.target.kind,'object');
 again.t.state.setup.attempts=3;again.t.state.setup.battle={ended:true,attempt:3};
 assert.equal(again.t.inspect(field).kind,'stop','three attempts at most');
});

test('duplication guards Box 3 slot 1, never gives real Mail, and counts each +1/-1 step',()=>{
 const c=cast();c.recycle.heldItem=134;const party=Object.values(c);
 const occupant=mon(73,30,{box:2,slot:0});
 let t=task();
 let next=t.inspect(observation({party,storage:[occupant],mail:{slots:[132,0,0,0,0,0],links:[255,255,0,255,255,255],box3Empty:false},items:[{itemId:68,quantity:1},{itemId:132,quantity:19}]}));
 assert.equal(next.objective.id.endsWith('box3-slot1-withdraw'),true);assert.deepEqual(next.objective.target.avoidDepositBoxes,[2]);
 next=t.inspect(observation({party:[...party.slice(0,5),{...occupant}],storage:[],mail:{slots:[132,0,0,0,0,0],links:[255,255,0,255,255,255]},items:[{itemId:68,quantity:1},{itemId:132,quantity:19}]}));
 assert.equal(next.objective.id.endsWith('box3-slot1-deposit'),true);assert.equal(next.objective.target.requiredFingerprints.includes(encounterFingerprint(occupant)),false);
 t=task();
 next=t.inspect(observation({party,mail:{slots:[132,0,0,0,0,0],links:[255,255,0,255,255,255]},items:[{itemId:68,quantity:1},{itemId:132,quantity:19}]}));
 assert.equal(t.state.session.seed,encounterFingerprint(c.recycle),'the orphan’s former holder is the seed');
 assert.equal(t.state.session.holders.length,5);
 const allMail=party.map(p=>p===c.recycle?{...p,heldItem:68}:{...p,heldItem:132});
 const five=observation({party:allMail,mail:{slots:[132,132,132,132,132,0],links:[1,2,0,3,4,255]},items:[{itemId:132,quantity:14}]});
 five.playerMemory.mail.party[5]={...five.playerMemory.mail.party[5],hasMail:true,linked:false,mailId:255};
 five.playerMemory.mail.allocatedPartySlots=5;
 assert.match(t.inspect(five).reason,/Only 5 of 6/,'with a free slot the “duplication” would attach real Mail');
 const six=observation({party:allMail,mail:{slots:[132,132,132,132,132,132],links:[1,2,0,3,4,5]},items:[{itemId:132,quantity:14}]});
 t.state.phase='session';t.state.itemOp=null;
 next=t.inspect(six);
 assert.equal(t.state.mailStep.kind,'quit');assert.equal(t.state.session.pendingDupe.candies,0);
 const after=observation({party:allMail,mail:{slots:[132,132,132,132,132,132],links:[1,2,0,3,4,5]},items:[{itemId:68,quantity:1},{itemId:132,quantity:13}]});
 t.inspect(after);assert.equal(t.state.session.dupes,1);
 const wrong=observation({party:allMail,mail:{slots:[132,132,132,132,132,132],links:[1,2,0,3,4,5]},items:[{itemId:68,quantity:3},{itemId:132,quantity:12}]});
 assert.equal(t.inspect(wrong).kind,'stop','an unexpected Bag change stops the supply');
});

test('the question-mark Mail screen is quit without edits; written Mail places one word and confirms',()=>{
 const c=cast(),t=task(),party=Object.values(c);
 let target={mailIndex:255,aliasesBox3Slot1:true};
 const ec=(stage,menuCursor=null,edited=false)=>{const o=observation({party});o.playerMemory.ui={easyChat:{stage,menuCursor,inputReady:true,edited,...target,buffer:Array(9).fill(0)}};return o;};
 t.state.mailStep={kind:'quit'};
 assert.deepEqual(t.inspect(ec('field')).action.buttons,['b']);
 assert.deepEqual(t.inspect(ec('confirm-quit',1)).action.buttons,['up'],'the Quit prompt opens on No');
 assert.deepEqual(t.inspect(ec('confirm-quit',0)).action.buttons,['a']);
 t.state.mailStep={kind:'write'};target={mailIndex:1,aliasesBox3Slot1:false};
 assert.deepEqual(t.inspect(ec('field')).action.buttons,['a']);
 assert.deepEqual(t.inspect(ec('word')).action.buttons,['a']);
 assert.deepEqual(t.inspect(ec('field',null,true)).action.buttons,['start']);
 assert.deepEqual(t.inspect(ec('confirm-message',0,true)).action.buttons,['a']);
 const busy=ec('field');busy.playerMemory.ui.easyChat.inputReady=false;
 assert.equal(t.inspect(busy).kind,'wait');
});

test('cleanup takes every Mail back through the native prompts before anything else',()=>{
 const c=cast(),t=task(),party=Object.values(c).map((p,i)=>i<2?{...p,heldItem:132}:p);
 t.state.phase='cleanup';t.state.session={heldBefore:{},dupes:3,iterations:[]};t.state.originalParty=[];
 const o=observation({party,mail:{slots:[132,132,132,0,0,0],links:[1,2,0,255,255,255]}});
 assert.equal(t.inspect(o).recommendation.kind,'open-start-menu');
 o.playerMemory.ui={party:{stage:'confirm-send-mail-to-pc',cursor:0}};
 assert.deepEqual(t.inspect(o).recommendation,{kind:'choose-menu-option',targetOption:'no',targetIndex:1,objective:'qmm-test'});
 o.playerMemory.ui={party:{stage:'confirm-lose-mail',cursor:1}};
 assert.equal(t.inspect(o).recommendation.targetOption,'yes');
 o.playerMemory.ui={party:{stage:'selection-menu',selectedPartySlot:0,actions:['summary','switch','mail','cancel']}};
 assert.equal(t.inspect(o).recommendation.targetAction,'mail');
});

test('the owner never yields, trades or deposits while a party Pokémon holds Mail',()=>{
 const c=cast(),party=Object.values(c).map((p,i)=>i===0?{...p,heldItem:132}:p);
 const o=observation({party,mail:{slots:[132,0,0,0,0,0],links:[0,255,255,255,255,255]}});
 assert.equal(qmmPartyHoldsMail(o),true);
 assert.equal(canYieldPostgame({qmmEnabled:true},o),false,'the enabled supply owns party Mail');
 assert.equal(canYieldPostgame({qmm:{phase:'setup',dirty:false}},o),false,'an active supply owns party Mail');
 assert.equal(canYieldPostgame({},o),true,'with the supply off, a player’s own Mail changes nothing');
 const clean=observation({party:Object.values(cast())});
 assert.equal(canYieldPostgame({qmmEnabled:true},clean),true);
 assert.equal(canYieldPostgame({qmm:{dirty:true}},clean),false,'a Mail supply transaction owns the game');
 const trade=new TradePreparation({receipt:{requestId:'x',fingerprint:'y',state:'saved-awaiting-partner'},center:'MAP_CELADON_CITY_POKEMON_CENTER_1F',nurseIndex:0,mechanics});
 assert.match(trade.inspect(o).reason,/Mail/);
});

test('a Rare Candy player task starts the Mail supply only when the setting is on',()=>{
 const o=observation({party:Object.values(cast()),items:[{itemId:68,quantity:2}]});
 const pickup={selectItemPreparation:()=>({id:'find-candy',target:{kind:'object',map:'MAP_MT_MOON_1F',index:10}})};
 const enabled=new PlayerTask({request:{id:'candy',kind:'item',itemId:68,quantity:10},world,planner:pickup,qmmSupply:{enabled:true,available:()=>true}});
 assert.deepEqual(enabled.inspect(o),{kind:'qmm',itemId:68,stockTarget:12});
 const unavailable=new PlayerTask({request:{id:'candy',kind:'item',itemId:68,quantity:10},world,planner:pickup,qmmSupply:{enabled:true,available:()=>false}});
 assert.equal(unavailable.inspect(o).objective.id,'find-candy','a stopped supply falls back to field candies');
 const off=new PlayerTask({request:{id:'candy',kind:'item',itemId:68,quantity:10},world,planner:pickup});
 assert.equal(off.inspect(o).objective.id,'find-candy');
});

test('a renewable supply asks for a candy at every level, not only expensive ones',()=>{
 const p={...mon(246,30),experienceProgress:{current:37000,levelStart:36000,nextLevel:38000},friendship:70};
 const make=()=>new FireRedEvolutionTask({requestId:'tyranitar',sourceId:'owned',pokemon:p,steps:[{kind:'evolve',game:'firered',fromSpecies:246,speciesId:247}],request:{speciesId:247}});
 const o=observation({party:[p],flags:{2112:true}});o.playerMemory.trainer.pokedex={ownedSpecies:[246]};
 const finite=make().inspect(o,{canSupply:()=>true});
 assert.notEqual(finite.kind,'supply','a cheap, half-finished level is trained normally with a finite stock');
 const renewable=make().inspect(o,{canSupply:()=>true,renewableCandies:true});
 assert.deepEqual(renewable,{kind:'supply',item:{nativeId:68,name:'Rare Candy'}});
});

test('party order recommendations use the native SWITCH action',()=>{
 const o={emulator:{mode:'overworld'},playerMemory:{ui:{party:{stage:'selection-menu',selectedPartySlot:3,actions:['summary','switch','item','cancel']}}}};
 assert.deepEqual(partyOrderRecommendation(o,0,3),{kind:'choose-party-action',targetAction:'switch',targetIndex:1});
 o.playerMemory.ui.party={stage:'choose-switch-target'};
 assert.equal(partyOrderRecommendation(o,0,3).targetPartySlot,0);
});

test('a boxed catch counts by its experience-derived level, so the search stops after one Spearow',()=>{
 // Boxed records have no level field; the first native run re-caught Spearows.
 const growth={...mechanics.data,species:Object.assign([],mechanics.data.species,{21:{abilities:['ABILITY_KEEN_EYE'],growthRate:'GROWTH_MEDIUM_FAST'}})};
 const c=cast();delete c.knock;
 const boxed={...mon(21,undefined,{box:2,slot:17}),experience:32**3+10};delete boxed.level;
 const t=new QmmSupplyTask({requestId:'test',stockTarget:13,world,story,mechanics:{data:growth},planner});
 const next=t.inspect(observation({party:Object.values(c),storage:[boxed],items:[{itemId:132,quantity:5}]}));
 assert.equal(next.objective.target.kind,'party-roster','withdraw the caught L32 Spearow instead of hunting again');
 const young={...boxed,experience:20**3};
 const again=new QmmSupplyTask({requestId:'test',stockTarget:13,world,story,mechanics:{data:growth},planner});
 assert.equal(again.inspect(observation({party:Object.values(c),storage:[young],items:[{itemId:132,quantity:5}]})).objective.target.kind,'encounter-zone','a level-20 Spearow cannot learn Knock Off');
});

test('the seed Rare Candy comes from the planner without the Cycling Road slope candy',()=>{
 const c=cast();c.recycle.heldItem=134;
 let asked=null;
 const spy={...planner,selectItemPreparation:(o,itemId,quantity,options)=>{asked={itemId,quantity,options};return {id:'evolution-collect:MAP_ROUTE6:hidden:2',target:{kind:'background',map:'MAP_ROUTE6',x:19,y:5}};}};
 const t=task({planner:spy});
 const next=t.inspect(observation({party:Object.values(c),mail:{slots:[132,0,0,0,0,0],links:[255,255,0,255,255,255]},items:[{itemId:132,quantity:19}]}));
 assert.deepEqual(asked,{itemId:68,quantity:1,options:{excludeLocationIds:['collect:MAP_ROUTE17:hidden:6']}});
 assert.equal(next.objective.target.map,'MAP_ROUTE6');
 assert.equal(next.objective.identityEvolution,true,'held-item equip advice stays off on the way');
 assert.equal(t.state.session.holders,null,'no Mail is handed out before the seed exists');
 const none=task({planner:{...planner,selectItemPreparation:()=>null}});
 assert.match(none.inspect(observation({party:Object.values(c),mail:{slots:[132,0,0,0,0,0],links:[255,255,0,255,255,255]},items:[{itemId:132,quantity:19}]})).reason,/one Rare Candy/);
});

test('an already defeated setup pair is rematched through the VS Seeker beside them',()=>{
 const {t,c}=battleTask(),party=t._party.map(p=>p===c.recycle?{...p,heldItem:132}:p);
 const at=(pos,battery,rematch=0)=>{
  const o=observation({party,map:QMM_SETUP_TRAINER.map,mail:{slots:[132,0,0,0,0,0],links:[255,255,0,255,255,255]},flags:{[QMM_SETUP_TRAINER.flagId]:true}});
  o.playerMemory.position=pos;o.playerMemory.vsSeeker={batterySteps:battery,rematchEntries:Object.assign(Array(100).fill(0),{15:rematch})};
  o.playerMemory.mapGrid={cells:[{x:10,y:51,collision:0},{x:11,y:52,collision:1},{x:11,y:50,collision:0},{x:12,y:51,collision:0}]};
  o.playerMemory.objectEvents=[];
  return o;
 };
 const a=QMM_SETUP_TRAINER.anchor;
 const walk=t.inspect(at({x:5,y:40},0));
 assert.deepEqual(walk.objective.target,{kind:'vs-seeker-activation',map:'MAP_ROUTE14',x:a.x,y:a.y});
 assert.equal(walk.objective.vsSeekerAction,'activate');assert.deepEqual(walk.objective.vsSeekerBatch.localIds,[14,15]);
 const pace=t.inspect(at({...a},40));
 assert.equal(pace.kind,'act');assert.deepEqual(pace.action.buttons,['left'],'recharge by pacing onto the first free neighbour');
 assert.deepEqual(t.inspect(at({x:a.x-1,y:a.y},40)).action.buttons,['right']);
 assert.equal(t.inspect(at({...a},100)).objective.target.kind,'vs-seeker-activation','a charged VS Seeker is used at the anchor');
 assert.deepEqual(t.inspect(at({...a},0,1)).objective.target,{kind:'object',map:'MAP_ROUTE14',index:QMM_SETUP_TRAINER.objectIndex},'a pending rematch is fought by talking to Kiri');
});

test('a holder’s Mail is never written on the question-mark screen or the reserved record',()=>{
 const c=cast();c.recycle.heldItem=134;const party=Object.values(c);
 const mail={slots:[132,0,0,0,0,0],links:[255,255,0,255,255,255]};
 const t=task();
 t.inspect(observation({party,mail,items:[{itemId:68,quantity:1},{itemId:132,quantity:19}]}));
 const holder=t.state.session.holders[0];
 assert.deepEqual(t.state.mailStep,{kind:'write',fingerprint:holder});
 const screen=(mailIndex,alias=false)=>{const o=observation({party,mail,items:[{itemId:68,quantity:1},{itemId:132,quantity:18}]});
  o.playerMemory.ui={easyChat:{stage:'field',menuCursor:null,inputReady:true,edited:false,mailIndex,aliasesBox3Slot1:alias,buffer:Array(9).fill(0)}};return o;};
 assert.deepEqual(t.inspect(screen(255,true)).action.buttons,['b'],'the Box 3 slot 1 alias is left without an edit');
 assert.equal(t.state.mailStep.kind,'quit');
 const back=observation({party,mail,items:[{itemId:68,quantity:1},{itemId:132,quantity:19}]});
 const next=t.inspect(back);
 assert.equal(next.kind,'stop');assert.match(next.reason,/opened mail record 255/);
 const own=task();own.inspect(observation({party,mail,items:[{itemId:68,quantity:1},{itemId:132,quantity:19}]}));
 assert.deepEqual(own.inspect(screen(0)).action.buttons,['b'],'the reserved record is never edited either');
 const free=task();free.inspect(observation({party,mail,items:[{itemId:68,quantity:1},{itemId:132,quantity:19}]}));
 assert.deepEqual(free.inspect(screen(1)).action.buttons,['a'],'a free party slot is written');
 const unknown=task();unknown.inspect(observation({party,mail,items:[{itemId:68,quantity:1},{itemId:132,quantity:19}]}));
 assert.equal(unknown.inspect(screen(null)).kind,'stop','an unidentified record is never written');
});

test('a retried setup battle leaves the title screen on a later frame for each attempt',()=>{
 const {t}=battleTask();
 const title=frame=>({frame,phase:'stable',emulator:{mode:'boot',callback2:'CB2_TitleScreenRun',inputReady:true},playerMemory:{ui:{}}});
 assert.equal(t.titleScreenDelay(title(5)),null,'no retry pending');
 t.state.setup.attempts=1;t.state.setup.powerCycle={at:900};
 const first=t.titleScreenDelay(title(20));
 assert.equal(first.frames,30);assert.match(first.reason,/retry 2/);
 assert.equal(t.titleScreenDelay(title(50)).frames,17);
 assert.equal(t.titleScreenDelay(title(67)),null,'47 frames later the Continue press proceeds');
 assert.equal(t.titleScreenDelay({...title(70),emulator:{mode:'boot',callback2:'CB2_MainMenu'}}),null,'only the title screen is delayed');
 t.state.setup.attempts=2;t.state.setup.powerCycle={at:2000};
 t.titleScreenDelay(title(3));
 assert.equal(t.titleScreenDelay(title(60)).frames,30,'attempt 2 waits twice as long');
});

test('a power cycle that never reaches the title screen is repeated at most three times',()=>{
 const {t,c}=battleTask();
 t.inspect(battleObservation(t,{left:c.berry,right:c.sleeper}));
 const field=observation({party:t._party,saved:11,mail:{slots:Array(16).fill(0)}});
 assert.equal(t.inspect(field).kind,'power-cycle');
 for(let i=0;i<3;i++)assert.equal(t.inspect(field).kind,'power-cycle');
 assert.match(t.inspect(field).reason,/did not return to the title screen/);
});
