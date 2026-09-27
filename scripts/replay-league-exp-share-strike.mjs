import assert from 'node:assert/strict';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {battleDecisionState} from '../engine/firered/src/player/battle-model.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';
import {resolvePostgameObjective,POSTGAME_WATCH} from '../engine/firered/src/suite/postgame-agenda.js';

// The live League Exp. Share incident (round 102, 2026-09-25 01:15:42 PDT):
// Dragonite fainted to Agatha's rematch team while the passive trainee Gloom
// held the Exp. Share at full HP. Owner decision (Sept 26): one fainted battler
// in a round that is still won is a strike, not a hold, and the trainee stays
// protected for the whole round. The trainee stays passive to the Hall of Fame,
// the round is judged at the first readable field frame outside the League with
// its one faint, and training continues with Gloom. The build-106 engine held
// at the faint and dropped Gloom from the rest of the round. The checkpoint
// carries round 102's agenda state (legacy round shape).
const HALL_OF_FAME='MAP_POKEMON_LEAGUE_HALL_OF_FAME',AGATHA='MAP_POKEMON_LEAGUE_AGATHAS_ROOM',EXP_SHARE=182,DRAGONITE=3639020581;
const LEAGUE=/^MAP_POKEMON_LEAGUE_(LORELEIS|BRUNOS|AGATHAS|LANCES|CHAMPIONS)_ROOM$/;

export async function replayLeagueExpShareStrike({session,saved,inputs}){
 const {teamPlan,workflows:seed}=saved.metadata.replay,trainee=seed.leagueExpShare.trainee;
 const basePlanner=createCampaignPlanner({...inputs,mechanics:inputs.battle});
 let workflows=structuredClone(seed),objective=null,now=0,serial=0;
 // Controller time starts at the live capture; the owner kept the default setting.
 const context={mechanics:inputs.battle,teamPlan,planner:basePlanner,protectedFingerprints:[],leagueTraining:{enabled:true,resumedAt:null}};
 const resolve=(o,state=workflows)=>resolvePostgameObjective('league-rematch',o,inputs.world,state,{...context,now:Date.parse('2026-09-25T08:15:42Z')+now});
 const planner={...basePlanner,select:()=>objective,selectCollection:()=>null,selectTraining:()=>null,
  selectBattleSquad:()=>[],campaignStatus:()=>({objective:objective?.id}),state:()=>({objective})};
 const open=state=>createCentralPlayer({campaignPlanner:planner,mechanics:inputs.battle,initialState:state,
  advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,teamPlan,campaignPlanner:planner})});
 let player=open();
 const observer=createFireRedObserver({session,...inputs,runId:'league-exp-share-strike',
  storyWatch:{flags:[...new Set([...POSTGAME_WATCH.flags,1212])],variables:POSTGAME_WATCH.variables}});
 const same=(p,t)=>Number(p?.personality)===Number(t?.personality)&&Number(p?.otId)===Number(t?.otId);
 const before=observer.capture(),m0=before.playerMemory,gloom=m0.trainer.party.find(p=>same(p,trainee));
 assert.equal(m0.map.id,AGATHA);assert.equal(before.emulator.inBattle,true,'start inside the Agatha rematch battle');
 assert.equal(battleDecisionState(m0,m0.ui??{})?.trainerId,737);assert.equal(m0.gameStats.leagueEntries,101);
 assert.deepEqual(m0.trainer.party.filter(p=>p.maxHp>0&&p.hp===0).map(p=>p.personality),[DRAGONITE],'only Dragonite has fainted');
 assert.ok(gloom&&gloom.hp===gloom.maxHp&&gloom.heldItem===EXP_SHARE,'the untouched trainee holds the Exp. Share');
 assert.deepEqual(workflows.leagueExpShare.round,{leagueEntries:101},'round 102 is open in the legacy shape');
 assert.equal(workflows.leagueExpShare.disabled,undefined);
 // Objectives resolve outside battle only: the live controller fought this
 // battle with the objective it resolved in Agatha's room before the faint.
 // Reproduce that one on a copy with the party read withheld, so the faint is
 // first observed after the battle, as it was live.
 const names=(what,o,state=workflows)=>assert.ok(same(o?.expShareTrainee,trainee),
  `${what} names the passive trainee Gloom (${o?.id}; hold ${JSON.stringify(state.leagueExpShare?.disabled??null)})`);
 const copy=structuredClone(workflows),prior=structuredClone(before);prior.playerMemory.trainer.partyValidity='unknown';
 objective=resolve(prior,copy);
 assert.equal(objective?.id,'postgame-league-rematch-battle-2');names('the battle objective',objective,copy);
 assert.equal(copy.leagueExpShare.disabled,undefined);
 const jobs=new Map(),battles=new Set([737]),entered=[],objectives=new Set();
 const emulator=createAutonomousEmulator({session,emulationSpeed:10,frameExact:true,videoFramesPerSecond:1,
  clock:()=>now,schedule(callback,delay){const id=++serial;jobs.set(id,{callback,at:now+delay});return id;},
  cancel:id=>jobs.delete(id),actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState()});
 let agatha=null,reconstructed=false,hof=null,lastTrainer=737,lastTrace='';
 const faints=s=>(s?.round?.faints??[]).map(f=>[Number(f.personality),Number(f.otId),f.room]);
 try{
  for(let step=0;step<60000;step++){
   const o=observer.capture(),m=o.playerMemory,map=m.map?.id??'';
   // Stable decisions only (as the controller): League rooms with their menus,
   // outside only the field (never the Hall of Fame, credits or title screen).
   if(o.phase==='stable'&&!o.emulator.inBattle&&o.emulator.mode!=='hall-of-fame'&&map!==HALL_OF_FAME&&(LEAGUE.test(map)||o.emulator.mode==='overworld')){
    objective=resolve(o);const s=workflows.leagueExpShare;
    if(LEAGUE.test(map)){
     // (b) Whole-round protection: every League objective names Gloom.
     objectives.add(objective?.id);names('every League objective',objective);
     // (a) The faint is a strike: no hold, one recorded faint, the round stays open.
     if(!agatha&&map===AGATHA){
      agatha={frame:o.frame,objective:objective?.id,faints:faints(s)};
      assert.equal(s.disabled,undefined,`one fainted battler in a round is a strike, not a hold (${JSON.stringify(s.disabled??null)})`);
      assert.deepEqual(agatha.faints,[[DRAGONITE,trainee.otId,2]],'Dragonite\'s faint in Agatha\'s room is recorded once');
      assert.ok(s.round?.conditions?.includes('battler-fainted'),'the round records the faint');
      assert.equal(s.round?.leagueEntries,101,'the round stays open for its judgement');
     }
     // (c) A restart at the Agatha intermission keeps the round and its faint.
     if(!reconstructed&&objective?.id==='postgame-league-rematch-intermission-2'){
      workflows=JSON.parse(JSON.stringify(workflows));player=open(JSON.parse(JSON.stringify(player.state())));reconstructed=true;
      objective=resolve(o);const r=workflows.leagueExpShare;names('the reconstructed intermission objective',objective);
      assert.equal(r.disabled,undefined);assert.equal(r.active,true);assert.equal(r.round?.leagueEntries,101);
      assert.deepEqual(faints(r),[[DRAGONITE,trainee.otId,2]],'the reconstructed round keeps its faint');
     }
    }else{
     assert.ok(hof,`the League round ended without the Hall of Fame (${map}; ${JSON.stringify(s.disabled??null)})`);
     const t=m.trainer;
     // An unreadable frame defers the verdict; nothing is inferred from it.
     if(t.partyValidity!=='valid'||!Number.isInteger(m.gameStats?.leagueEntries))assert.ok(s.round&&!s.disabled,'an unreadable frame keeps the round open');
     else{
      // (e) The first readable field frame outside the rooms judges the round.
      const g=[...t.party,...(t.storage?.validity==='valid'?t.storage.pokemon:[])].find(p=>same(p,trainee));
      const judged=s.history?.filter(e=>e.kind==='round')??[],h=judged.at(-1);
      const summary={startFrame:before.frame,endFrame:o.frame,map,agatha,reconstructed,hof,battles:[...battles],entered:entered.length,objectives:[...objectives],
       leagueEntries:m.gameStats.leagueEntries,round:s.round??null,active:s.active,disabled:s.disabled??null,history:s.history,lastPlan:s.lastPlan,
       objective:objective?.id??null,trainee:g&&{level:g.level,experience:g.experience,heldItem:g.heldItem},steps:step};
      console.log('# league-exp-share-strike-summary '+JSON.stringify(summary));
      // FLAG_DEFEATED_CHAMP was proven at the Hall of Fame; its script then resets the Elite Four flags.
      assert.equal(m.gameStats.leagueEntries,102,'the won round added one Hall of Fame entry');
      assert.equal(s.round,undefined,'the round is judged');
      assert.equal(judged.length,1,'one judged round');
      assert.equal(h?.kind,'round');assert.equal(h.baseline,101);assert.equal(h.leagueEntries,102);assert.equal(h.won,true);
      assert.deepEqual(h.faints.map(f=>[Number(f.personality),f.room]),[[DRAGONITE,2]],'the round is judged with Dragonite\'s one faint');
      assert.equal(s.disabled,undefined,`a strike keeps training (${JSON.stringify(s.disabled??null)})`);
      assert.ok(!s.history.some(e=>e.kind==='hold'),'no hold was ever recorded');
      assert.ok(!s.history.some(e=>e.kind==='resumed'),'nothing needed a resume');
      assert.equal(s.lastPlan?.active,true,`training continues (${s.lastPlan?.reason})`);assert.ok(same(s.lastPlan.trainee,trainee),'with Gloom');
      // Judging clears the round's active flag; only a battle-0 decision for the next round sets it again.
      if(s.active)assert.equal(objective?.id,'postgame-league-rematch-battle-0','only the next round start re-arms the trainee');
      if(s.active)names('the next round start',objective);
      assert.ok(g&&g.experience>gloom.experience&&g.heldItem===EXP_SHARE,'Gloom gained experience and still holds the Exp. Share');
      assert.deepEqual(entered,[],'the passive trainee never entered battle');
      return {before,after:o};
     }
    }
   }
   if(o.emulator.inBattle){
    const b=battleDecisionState(m,m.ui??{});
    if(b?.trainerId&&b.trainerId!==lastTrainer){battles.add(b.trainerId);lastTrainer=b.trainerId;}
    const active=m.trainer.party.find(p=>Number(p.slot)===Number(b?.playerPartySlot));
    const isTrainee=active?same(active,trainee):Number(b?.player?.species)===Number(gloom.species)&&m.trainer.party.filter(p=>p.species===gloom.species).length===1;
    if(isTrainee&&Number(b?.player?.hp)>0)entered.push({frame:o.frame,turn:b.turn,trainerId:b.trainerId});
   }
   // (d) The round was won with the passive trainee aboard.
   if(!hof&&(map===HALL_OF_FAME||o.emulator.mode==='hall-of-fame')){
    const g=m.trainer.party.find(p=>same(p,trainee));
    hof={frame:o.frame,leagueEntries:m.gameStats?.leagueEntries??null,experience:g?.experience,level:g?.level,heldItem:g?.heldItem};
    console.log('# league-exp-share-strike hall-of-fame '+JSON.stringify({...hof,battles:[...battles],entered}));
    assert.ok(agatha&&reconstructed,'the strike and the intermission restart came first');
    assert.equal(m.storyState.flagIds[1212],true,'FLAG_DEFEATED_CHAMP proves the round was won');
    assert.ok(battles.has(738)&&battles.size>=3,`Lance and the Champion were fought (${[...battles]})`);
    assert.deepEqual(entered,[],'the passive trainee never entered battle');
    assert.ok(g&&g.experience>gloom.experience&&g.heldItem===EXP_SHARE,'the trainee gained Exp. Share experience and still holds it');
   }
   const trace=JSON.stringify([map,objective?.id,objective?.target?.kind,o.emulator.mode,o.phase,workflows.leagueExpShare?.disabled?.reason??null,faints(workflows.leagueExpShare).length]);
   if(trace!==lastTrace){console.log('# league-exp-share-strike '+o.frame+' '+trace);lastTrace=trace;}
   // The postgame controller's own Hall of Fame input (postgame.js); the player owns everything else.
   const decision=o.emulator.mode==='hall-of-fame'?{kind:'act',action:{buttons:['a'],holdFrames:1,releaseFrames:59}}:player.decide(o);
   assert.notEqual(decision.kind,'blocked',decision.reason);
   let done=false,result,error;
   emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0}).then(x=>{result=x;done=true;},e=>{error=e;done=true;});
   for(let n=0;n<5000&&!done;n++){
    await Promise.resolve();if(done)break;
    const [id,task]=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0]??[];
    assert.ok(task,'native input remains scheduled');jobs.delete(id);now=task.at;task.callback();
   }
   assert.ok(done,'the action must settle');if(error)throw error;
   if(decision.kind!=='act')player.observeExecution({observation:o,decision,execution:result});
   if(!o.emulator.inBattle&&m.trainer?.party?.length&&m.trainer.party.every(p=>p.hp===0))throw Error('The League round was lost.');
  }
  throw Error(`The strike round did not reach a judged field frame (agatha ${JSON.stringify(agatha)}, hof ${JSON.stringify(hof)}).`);
 }finally{emulator.close();}
}
