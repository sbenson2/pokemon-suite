import assert from 'node:assert/strict';
import test from 'node:test';
import {createCampaignController,createCampaignRun,presentCampaignRun} from '../src/suite/campaign-run.js';
import {createCampaignEpisodeMonitor} from '../src/player/campaign-episode.js';
import {createFireRedRosterContext} from '../src/player/fire-red-roster.js';
import {rosterContextFixture} from '../test-support/roster-context-fixture.js';

function observed(frame,{map='MAP_ROUTE1',xp=150,phase='stable',mode='overworld'}={}) {
  const captureId=`supervised-${frame}`;
  return {captureId,frame,phase,phaseReasons:[],sram:{captureId,frame,sha256:'save'},
    emulator:{captureId,frame,mode,inputReady:true,callback2:'CB2_Overworld'},
    playerMemory:{captureId,frame,sha256:'memory',map:{id:map},position:{x:frame%4,y:1},ui:{},
      storyState:{flagIds:{},variableIds:{}},trainer:{partyValidity:'valid',usablePartyCount:1,
        party:[{slot:0,species:7,personality:17,otId:29,level:5,experience:xp,hp:20,maxHp:20,moves:[33],pp:[35],status1:0}]}}};
}

let supervisionRecord;
function campaign(clock,state=null) {
  const fixture=rosterContextFixture();
  const record=supervisionRecord??=createCampaignRun({settings:{label:'Supervision',starter:'squirtle',teamMode:'random',helpers:'allowed',seedMode:'replay',seed:123,teamSeed:42},rosterContext:createFireRedRosterContext(fixture)});
  return createCampaignController({...fixture,record,state,clock,progressTimeoutMs:100});
}

function stuckCampaignState() {
 const saved=structuredClone(campaign(()=>0).state());
 saved.status='blocked';saved.reason='repeated-menu-transaction';
 saved.player.transactionRecovery={progress:null,attempts:2,blocked:{reason:'repeated-menu-transaction',attempts:2},unwinding:false};
 return saved;
}

test('a campaign automatically unwinds a repeated menu and replans after reaching the field',()=>{
 const controller=campaign(()=>0,stuckCampaignState());
 const o=observed(1,{mode:'start-menu'});o.playerMemory.ui={startMenu:{order:['pokemon','bag','save'],cursor:0}};
 const unwind=controller.decide(o);
 assert.equal(unwind.kind,'act');assert.deepEqual(unwind.action.buttons,['b']);
 const saved=JSON.parse(JSON.stringify(controller.state()));
 const restored=campaign(()=>0,saved);
 restored.decide(observed(2));
 assert.notEqual(restored.decide(observed(3)).kind,'blocked');
 assert.equal(restored.state().player.transactionRecovery.blocked,null);
 assert.deepEqual(restored.record.teamPlan,controller.record.teamPlan);
 assert.equal(restored.state().recovery.current.status,'verifying','closing a menu is not proof that its task recovered');
 assert.equal(presentCampaignRun(restored.record,restored.state()).recovery.status,'verifying');
});

test('a recovery that produces no task progress ends with an explicit unresolved incident',()=>{
 let now=0;const controller=campaign(()=>now,stuckCampaignState());
 controller.decide(observed(1));controller.decide(observed(2));
 now=101;assert.equal(controller.decide(observed(3)).kind,'blocked');
 assert.equal(controller.state().recovery.current.status,'needs-review');
});

test('recovery verification spans normal animation frames between two confirmed field observations',()=>{
 const saved=campaign(()=>0).state();
 saved.recovery.current={key:'verified-native-task',status:'verifying',attempt:1};
 saved.menuRecovery={key:'verified-native-task',phase:'verifying',verifiedFrame:null,baseline:{frame:1,completed:null,trainee:'[29,17]',party:[{identity:'[29,17]',experience:150}]}};
 const controller=campaign(()=>0,saved);
 controller.decide(observed(2,{xp:180}));assert.equal(controller.state().recovery.current.status,'verifying');
 controller.decide(observed(3,{phase:'transition',xp:180}));
 assert.equal(controller.state().recovery.current.status,'verifying','animation is not new proof');
 controller.decide(observed(4,{xp:180}));assert.equal(controller.state().recovery.current.status,'recovered');
});

test('Resume repairs a stale menu latch without resetting the campaign supervision history',()=>{
 const controller=campaign(()=>0,stuckCampaignState());
 controller.resume();controller.decide(observed(1));
 assert.notEqual(controller.decide(observed(2)).kind,'blocked');
 assert.equal(controller.state().player.transactionRecovery.blocked,null);
});

test('an explicit policy retry clears a reviewed transaction stop without erasing run evidence',()=>{
 const saved=stuckCampaignState(),controller=campaign(()=>0,saved);
 controller.resume({retryBlockedPolicy:true});
 assert.equal(controller.state().player.transactionRecovery.blocked,null);
 assert.deepEqual(controller.record,campaign(()=>0,saved).record);
 assert.deepEqual(controller.state().player.campaignPlanner,saved.player.campaignPlanner);
 const protectedState=stuckCampaignState();
 protectedState.recovery={...protectedState.recovery,current:{key:'reviewed-menu',status:'needs-review',attempt:1}};
 const protectedController=campaign(()=>0,protectedState);
 protectedController.resume({retryBlockedPolicy:true});
 assert.ok(protectedController.state().player.transactionRecovery.blocked,
   'An exhausted higher-level recovery still needs its own review.');
});

test('PC recovery closes an empty cursor but preserves a Pokemon being moved',()=>{
 for(const movingPokemon of [false,true,null]) {
  const controller=campaign(()=>0,stuckCampaignState()),o=observed(1,{mode:'storage'});
  o.playerMemory.ui={storage:{stage:'storage-main',boxOption:'withdraw',movingPokemon}};
  const d=controller.decide(o);
  assert.deepEqual(d.action.buttons,movingPokemon===false?['b']:[]);
 }
});

test('PC recovery drains the terminal root and hands off after a restart',()=>{
 const fixture=rosterContextFixture(),record=campaign(()=>0).record;
 const map={id:'MAP_FIXTURE_CENTER',layout:{cells:[{x:1,y:0,behaviorName:'MB_PC'}]}};
 const open=state=>createCampaignController({...fixture,world:{maps:[map]},record,state,clock:()=>0});
 let controller=open(stuckCampaignState());
 const o=observed(1);o.playerMemory.map.id=map.id;o.playerMemory.position={x:1,y:1};
 o.playerMemory.avatar={facing:'north'};
 o.playerMemory.ui={choiceMenu:{minCursor:0,maxCursor:3,cursor:0,selected:null}};
 assert.deepEqual(controller.decide(o).action.buttons,['b'],'close Which PC instead of stopping at its root');
 controller=open(JSON.parse(JSON.stringify(controller.state())));
 o.frame=o.emulator.frame=o.playerMemory.frame=o.sram.frame=2;o.playerMemory.ui={};controller.decide(o);
 assert.equal(controller.state().recovery.current.status,'verifying');
 assert.equal(controller.state().player.transactionRecovery.blocked,null);
 assert.deepEqual(controller.record,record);
});

test('an explicit reviewed retry preserves limits and can finish a known PC exit',()=>{
 const fixture=rosterContextFixture(),record=campaign(()=>0).record;
 const map={id:'MAP_FIXTURE_CENTER',layout:{cells:[{x:1,y:0,behaviorName:'MB_PC'}]}};
 let now=0;const open=state=>createCampaignController({...fixture,world:{maps:[map]},record,state,clock:()=>now});
 const o=observed(1);o.playerMemory.map.id=map.id;o.playerMemory.position={x:1,y:1};
 o.playerMemory.avatar={facing:'north'};
 o.playerMemory.ui={choiceMenu:{minCursor:0,maxCursor:3,cursor:0,selected:null}};
 let controller=open(stuckCampaignState());
 const terminal=o.playerMemory.ui;
 o.playerMemory.ui={startMenu:{cursor:0}};
 for(let n=0;n<40;n++)controller.decide(o);
 assert.equal(controller.state().recovery.current.status,'needs-review');
 const history=controller.state().recovery.history;
 o.playerMemory.ui=terminal;now=10000;
 assert.deepEqual(controller.decide(o).action.buttons,[],'automatic resume cannot erase the review stop');
 controller.resume({retryBlockedPolicy:true});
 controller=open(JSON.parse(JSON.stringify(controller.state())));
 assert.deepEqual(controller.decide(o).action.buttons,['b']);
 assert.equal(controller.state().recovery.current.attempt,2);
 o.frame=o.emulator.frame=o.playerMemory.frame=o.sram.frame=2;o.playerMemory.ui={};controller.decide(o);
 assert.equal(controller.state().recovery.current.status,'verifying');
 assert.deepEqual(controller.state().recovery.history.slice(0,history.length),history);
 assert.deepEqual(controller.record,record);
});

test('menu recovery cannot cancel a battle, save, trade or a user pause',()=>{
 for(const scenario of ['battle','save','trade','paused']) {
  const saved=stuckCampaignState();if(scenario==='paused')saved.status='paused';
  const controller=campaign(()=>0,saved),o=observed(1);
  o.playerMemory.ui={startMenu:{cursor:0}};
  if(scenario==='battle')o.emulator.inBattle=true;
  if(scenario==='save')o.playerMemory.ui.saveDialog={stage:'writing'};
  if(scenario==='trade')o.playerMemory.map.id='MAP_UNION_ROOM';
  const d=controller.decide(o);
  assert.deepEqual(d.action.buttons,[],scenario);
  assert.ok(controller.state().player.transactionRecovery.blocked,scenario);
 }
});

test('PC recovery does not cancel an unrelated choice with the same cursor shape',()=>{
 const fixture=rosterContextFixture(),record=campaign(()=>0).record;
 const o=observed(1);o.playerMemory.position={x:1,y:1};o.playerMemory.avatar={facing:'north'};
 o.playerMemory.ui={choiceMenu:{minCursor:0,maxCursor:3,cursor:0,selected:null}};
 const controller=createCampaignController({...fixture,world:{maps:[{id:o.playerMemory.map.id,
   layout:{cells:[{x:1,y:0,behaviorName:'MB_NORMAL'}]}}]},record,state:stuckCampaignState(),clock:()=>0});
 assert.deepEqual(controller.decide(o).action.buttons,[]);
 assert.equal(controller.state().recovery.current.status,'needs-review');
 assert.ok(controller.state().player.transactionRecovery.blocked);
});

test('explicit retries and restarts cannot exceed the original menu attempt limit',()=>{
 let now=0,controller=campaign(()=>now,stuckCampaignState());
 const o=observed(1,{mode:'start-menu'});o.playerMemory.ui={startMenu:{cursor:0}};
 for(let attempt=1;attempt<=3;attempt++) {
  if(attempt>1){now+=30000;controller.resume({retryBlockedPolicy:true});}
  for(let n=0;n<40;n++)controller.decide(o);
  assert.equal(controller.state().recovery.current.status,'needs-review');
  assert.equal(controller.state().recovery.current.attempt,attempt);
  controller=campaign(()=>now,JSON.parse(JSON.stringify(controller.state())));
 }
 const history=controller.state().recovery.history;
 now+=30000;controller.resume({retryBlockedPolicy:true});
 assert.deepEqual(controller.decide(o).action.buttons,[]);
 assert.equal(controller.state().status,'blocked');
 assert.equal(controller.state().recovery.current.attempt,3);
 assert.deepEqual(controller.state().recovery.history,history);
});

test('a menu that cannot close stops with its recovery budget preserved across Resume',()=>{
 const controller=campaign(()=>0,stuckCampaignState());
 const o=observed(1,{mode:'start-menu'});o.playerMemory.ui={startMenu:{cursor:0}};
 for(let i=0;i<40;i++)controller.decide(o);
 assert.equal(controller.state().status,'blocked');
 const saved=JSON.parse(JSON.stringify(controller.state()));
 assert.equal(saved.recovery.current.status,'needs-review');
 const restored=campaign(()=>0,saved);restored.resume();
 assert.deepEqual(restored.decide(o).action.buttons,[]);
 assert.equal(restored.state().recovery.current.attempt,1);
});

test('the Suite campaign stops aimless movement without an external qualification runner',()=>{
  let now=0;const controller=campaign(()=>now);
  controller.decide(observed(1));
  now=50;controller.decide(observed(2,{map:'MAP_ROUTE2'}));
  now=149;assert.notEqual(controller.decide(observed(3)).kind,'blocked');
  now=151;const stop=controller.decide(observed(4,{map:'MAP_ROUTE2'}));
  assert.equal(stop.kind,'blocked');assert.equal(stop.reason,'no-meaningful-progress');
  assert.deepEqual(stop.action.buttons,[]);assert.equal(controller.state().status,'blocked');
});

test('Suite restart preserves consumed progress budget and does not reward rediscovering the same map',()=>{
  let now=0;let controller=campaign(()=>now);controller.decide(observed(1));
  now=80;controller.decide(observed(2));const saved=JSON.parse(JSON.stringify(controller.state()));
  now=10000;controller=campaign(()=>now,saved);controller.decide(observed(3));
  now=10021;assert.equal(controller.decide(observed(4)).reason,'no-meaningful-progress');
});

// The National Dex tunnel fix added VAR_NATIONAL_DEX (0x404E) and
// FLAG_SYS_NATIONAL_DEX (2112) to the campaign watch. A retained campaign's
// first observation after such an update holds story values it never recorded;
// counting them as achievements reset its consumed no-progress budget (native
// case campaign-field-dialogue).
const watching=(frame,story)=>{const o=observed(frame);o.playerMemory.storyState=structuredClone(story);return o;};
const beforeUpdate={flagIds:{83:true,562:false},variableIds:{16480:1}};
const afterUpdate={flagIds:{83:true,562:false,2112:true},variableIds:{16462:0x6258,16480:1}};

test('an update that watches more story values cannot renew a restored campaign budget',()=>{
  for(const checkpoint of ['current','legacy']){
    let now=0;let controller=campaign(()=>now);controller.decide(watching(1,beforeUpdate));
    now=80;controller.decide(watching(2,beforeUpdate));const saved=JSON.parse(JSON.stringify(controller.state()));
    // A checkpoint written before the supervisor recorded its watch derives it from its achievements.
    if(checkpoint==='legacy')delete saved.supervision.watched;
    now=10000;controller=campaign(()=>now,saved);
    assert.notEqual(controller.decide(watching(3,afterUpdate)).kind,'blocked');
    now=10021;assert.equal(controller.decide(watching(4,afterUpdate)).reason,'no-meaningful-progress',checkpoint+' checkpoint');
  }
});

test('watched story values remain progress when they change after the update',()=>{
  for(const checkpoint of ['current','legacy']){
    let now=0;let controller=campaign(()=>now);controller.decide(watching(1,beforeUpdate));
    now=80;controller.decide(watching(2,beforeUpdate));const saved=JSON.parse(JSON.stringify(controller.state()));
    if(checkpoint==='legacy')delete saved.supervision.watched;
    now=10000;controller=campaign(()=>now,saved);
    // A value the run already watched changes in the first observation after the update.
    const advanced={flagIds:afterUpdate.flagIds,variableIds:{...afterUpdate.variableIds,16480:2}};
    controller.decide(watching(3,advanced));
    now=10099;assert.notEqual(controller.decide(watching(4,advanced)).kind,'blocked',checkpoint+': an already watched value advanced');
    // A newly watched value changes later.
    const changed={flagIds:advanced.flagIds,variableIds:{...advanced.variableIds,16462:0}};
    now=10150;controller.decide(watching(5,changed));
    now=10249;assert.notEqual(controller.decide(watching(6,changed)).kind,'blocked',checkpoint+': the newly watched value changed');
    now=10251;assert.equal(controller.decide(watching(7,changed)).reason,'no-meaningful-progress');
  }
});

test('paused campaign time is excluded while its previous no-progress budget remains consumed',()=>{
  let now=0;const controller=campaign(()=>now);controller.decide(observed(1));
  now=60;controller.pause();now=10000;controller.resume();
  assert.notEqual(controller.decide(observed(2)).kind,'blocked');
  now=10041;assert.equal(controller.decide(observed(3)).reason,'no-meaningful-progress');
});

test('a blocked campaign excludes review time from a later update pause and resume',()=>{
 let now=0;const controller=campaign(()=>now);controller.decide(observed(1));
 now=60;controller.wait('repeated-menu-transaction');
 now=10000;controller.pause('Applying a verified software update.');
 const saved=JSON.parse(JSON.stringify(controller.state()));
 assert.equal(saved.supervision.idleMs,60);
 const restored=campaign(()=>now,saved);restored.resume();
 now=10039;assert.notEqual(restored.decide(observed(2)).kind,'blocked');
 now=10041;assert.equal(restored.decide(observed(3)).reason,'no-meaningful-progress');
});

function legacyReviewAccounting() {
 const original=campaign(()=>0);original.decide(observed(1));
 const saved=stuckCampaignState();
 saved.supervision={...original.state().supervision,idleMs:10000,elapsedMs:10100,
   lastProgressAt:new Date(900).toISOString(),stopReason:'no-meaningful-progress',
   recent:[{map:'MAP_ROUTE1',objective:null,decision:'blocked',action:null,frame:1}]};
 saved.reason='no-meaningful-progress';
 saved.recovery.current={key:JSON.stringify([original.record.id,'campaign-menu','MAP_ROUTE1',null]),
   action:'resume-campaign',reason:'repeated-menu-transaction',status:'needs-review',attempt:1,
   startedAt:950,finishedAt:960};
 delete saved.activityAccounting;
 return saved;
}

test('legacy review-clock correction uses the recorded menu stop and retains consumed active time',()=>{
 const saved=legacyReviewAccounting();let now=0;
 let controller=campaign(()=>now,saved);
 assert.equal(controller.state().supervision.idleMs,60);
 assert.equal(controller.state().supervision.elapsedMs,160);
 assert.equal(controller.state().supervision.stopReason,null);
 assert.equal(controller.state().supervisionAccountingRepair.excludedMs,9940);
 assert.deepEqual(controller.state().supervision.achievements,saved.supervision.achievements);
 assert.deepEqual(controller.state().supervision.recent,saved.supervision.recent);
 assert.deepEqual(controller.state().recovery,saved.recovery);
 controller=campaign(()=>now,JSON.parse(JSON.stringify(controller.state())));
 controller.resume({retryBlockedPolicy:true});controller.decide(observed(2));
 now=39;assert.notEqual(controller.decide(observed(3)).kind,'blocked');
 now=41;assert.equal(controller.decide(observed(4)).reason,'no-meaningful-progress');
});

test('legacy accounting cannot erase an active stall or a stop without matching evidence',()=>{
 for(const scenario of ['active-stall','missing-evidence','later-action','later-action-and-stop','new-accounting']) {
  const saved=legacyReviewAccounting();
  if(scenario==='active-stall')saved.recovery.current.finishedAt=1100;
  if(scenario==='missing-evidence')saved.recovery.current=null;
  if(scenario.startsWith('later-action'))saved.supervision.recent.push({map:'MAP_ROUTE1',objective:null,decision:'act',action:'move-toward',frame:2});
  if(scenario==='later-action-and-stop')saved.supervision.recent.push({map:'MAP_ROUTE1',objective:null,decision:'blocked',action:null,frame:3});
  if(scenario==='new-accounting')saved.activityAccounting='blocked-pauses-v1';
  const controller=campaign(()=>0,saved);controller.resume({retryBlockedPolicy:true});
  assert.equal(controller.decide(observed(2)).reason,'no-meaningful-progress',scenario);
  assert.equal(controller.state().supervision.stopReason,'no-meaningful-progress',scenario);
 }
});

test('earned XP extends the Suite progress budget but changing menus and transitions does not',()=>{
  let now=0;const controller=campaign(()=>now);controller.decide(observed(1));
  now=90;controller.decide(observed(2,{xp:180}));
  now=180;assert.notEqual(controller.decide(observed(3,{phase:'transition',xp:9999})).kind,'blocked');
  now=191;assert.equal(controller.decide(observed(4,{xp:180})).reason,'no-meaningful-progress');
});

test('the qualification monitor preserves its semantic progress history across a checkpoint restore',()=>{
  let now=0;
  let monitor=createCampaignEpisodeMonitor({target:'hall-of-fame',maxGameSeconds:null,clock:()=>now,progressTimeoutMs:100});
  monitor.observe({observation:observed(1),decision:{kind:'act'}});
  now=80;monitor.observe({observation:observed(2),decision:{kind:'act'}});
  const state=JSON.parse(JSON.stringify(monitor.state?.()??null));
  now=10000;monitor=createCampaignEpisodeMonitor({target:'hall-of-fame',maxGameSeconds:null,clock:()=>now,progressTimeoutMs:100,initialState:state});
  monitor.observe({observation:observed(3),decision:{kind:'act'}});
  now=10021;
  assert.equal(monitor.observe({observation:observed(4),decision:{kind:'act'}}).stopReason,'no-meaningful-progress');
});

test('a stalled Suite run exposes the objective and actual decisions alongside its preserved budget',()=>{
  let now=0;const controller=campaign(()=>now);
  const decision=controller.decide(observed(1));
  now=101;controller.decide(observed(2));
  const saved=controller.state(),view=presentCampaignRun(controller.record,saved);
  assert.equal(view.supervision.stopReason,'no-meaningful-progress');
  assert.equal(view.supervision.idleMs,101);
  assert.ok(view.supervision.recent.some(row=>row.objective===saved.objective.id&&row.decision===decision.kind));
  const restored=campaign(()=>now,JSON.parse(JSON.stringify(saved)));
  restored.resume();
  assert.equal(restored.decide(observed(3)).reason,'no-meaningful-progress','resume cannot silently reset the evidence or budget');
});
