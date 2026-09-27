import assert from 'node:assert/strict';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';

// Original native snapshots survived, but their historical planner checkpoints
// did not. Reconstruct only the observed League objective and committed team.
export async function replayLeagueTactics({session,saved,inputs}) {
  const {objective,teamPlan}=saved.metadata.replay;
  const lorelei=objective.id==='elite-four-lorelei';
  assert.ok(lorelei||objective.id==='elite-four-lance');
  const next={id:'league-battle-handoff',target:{kind:'map-arrival',
    map:lorelei?'MAP_POKEMON_LEAGUE_BRUNOS_ROOM':'MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM',x:6,y:12},
    completion:{kind:'map-is',map:lorelei?'MAP_POKEMON_LEAGUE_BRUNOS_ROOM':'MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM'}};
  const open=state=>{
    const planner=createCampaignPlanner({...inputs,mechanics:inputs.battle,teamPlan,
      campaign:{objectives:[objective,next]},initialState:state?.campaignPlanner});
    const player=createCentralPlayer({campaignPlanner:planner,mechanics:inputs.battle,initialState:state,
      advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,teamPlan,campaignPlanner:planner})});
    return {player,planner};
  };
  let {player,planner}=open();
  const observer=createFireRedObserver({session,...inputs,runId:'league-tactics',storyWatch:planner.storyWatch()});
  const before=observer.capture(),identity=p=>JSON.stringify([p.otId,p.personality]);
  const party=new Map(before.playerMemory.trainer.party.map(p=>[identity(p),p]));
  assert.equal(before.playerMemory.map.id,objective.target.map);
  assert.equal(before.playerMemory.storyState.flagIds[objective.completion.id],false);
  let now=0,serial=0;const jobs=new Map();
  const emulator=createAutonomousEmulator({session,emulationSpeed:10,frameExact:true,videoFramesPerSecond:1,
    clock:()=>now,schedule(callback,delay){const id=++serial;jobs.set(id,{callback,at:now+delay});return id;},cancel:id=>jobs.delete(id),
    actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState()});
  let restarted=false,selectedFinish=false,confirmedFinish=false,paidSwitches=0,lastSwitchTurn=null;
  let lastTrace='',lastBattleTurn=before.playerMemory.battle.turn;
  const firstPound=before.playerMemory.trainer.party.find(p=>p.species===40)?.pp[2];
  try {
    for(let step=0;step<18000;step++) {
      const o=observer.capture(),m=o.playerMemory,b=m.battle,decision=player.decide(o),r=decision.winner?.recommendation;
      if(o.emulator.inBattle&&Number.isInteger(b?.turn))lastBattleTurn=b.turn;
      assert.notEqual(decision.kind,'blocked',decision.reason);
      if(process.env.SUITE_REPLAY_TRACE==='1'&&r&&['choose-battle-command','choose-battle-move','choose-party-member'].includes(r.kind)) {
        const trace=JSON.stringify({turn:b?.turn,player:b?.player?.species,hp:b?.player?.hp,status:b?.player?.status1,
          volatile:b?.player?.status2,opponent:b?.opponent?.species,enemyHp:b?.opponent?.hp,recommendation:r});
        if(trace!==lastTrace){console.log('# league '+o.frame+' '+trace);lastTrace=trace;}
      }
      if(lorelei&&r?.kind==='choose-battle-move'&&b?.player?.species===40&&b?.opponent?.species===87&&b.opponent.hp===14&&m.ui.battle?.stage==='move') {
        assert.equal(r?.targetMoveId,1,'finish the 14-HP Dewgong instead of singing');selectedFinish=true;
      }
      if(selectedFinish&&b?.player?.species===40&&b.player.moveState?.lastMove===1&&b.player.pp[2]<firstPound)confirmedFinish=true;
      if(r?.kind==='choose-battle-command'&&r.targetCommand==='pokemon'&&b.turn!==lastSwitchTurn) {
        paidSwitches++;lastSwitchTurn=b.turn;
      }
      if(!restarted&&m.ui.party?.stage==='choose-pokemon') {
        ({player,planner}=open(JSON.parse(JSON.stringify(player.state()))));restarted=true;
      }
      const free=o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(m.ui).some(Boolean);
      if(free&&m.storyState.flagIds[objective.completion.id]===true) {
        assert.ok(restarted,'the committed battle action survived reconstruction');
        assert.deepEqual(m.trainer.party.map(identity).sort(),[...party.keys()].sort());
        assert.ok(m.trainer.party.every(p=>p.hp>0),'win without sacrificing the retained team: '+JSON.stringify(m.trainer.party.map(p=>({species:p.species,hp:p.hp}))));
        assert.ok(m.trainer.party.some(p=>p.experience>party.get(identity(p)).experience),'native XP proves battle progress');
        assert.equal(planner.campaignStatus().activeObjective.id,next.id,'victory hands back to the next room');
        assert.equal(o.sram.sha256,before.sram.sha256,'battle inputs do not replace native save memory');
        if(lorelei)assert.ok(selectedFinish&&confirmedFinish,'native PP and last-move evidence confirm Pound');
        else assert.ok(paidSwitches<=2,`avoid the retained Lance switch cycle (${paidSwitches} paid switches)`);
        const remaining=new Map(m.trainer.bag.items.map(i=>[i.itemId,i.quantity]));
        const medicine=Object.fromEntries(before.playerMemory.trainer.bag.items.flatMap(i=>
          i.quantity>(remaining.get(i.itemId)??0)?[[i.itemId,i.quantity-(remaining.get(i.itemId)??0)]]:[]));
        console.log('# league-tactics '+JSON.stringify({objective:objective.id,startFrame:before.frame,endFrame:o.frame,
          paidSwitches,startingTurn:before.playerMemory.battle.turn,finalTurn:lastBattleTurn,medicine,confirmedFinish,restarted,steps:step}));
        return {before,after:o};
      }
      let done=false,result,error;
      emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0}).then(r=>{result=r;done=true;},e=>{error=e;done=true;});
      for(let n=0;n<5000&&!done;n++) {
        await Promise.resolve();if(done)break;
        const [id,task]=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0]??[];
        assert.ok(task,'native input remains scheduled');jobs.delete(id);now=task.at;task.callback();
      }
      assert.ok(done,'the action must settle');if(error)throw error;
      player.observeExecution({observation:o,decision,execution:result});
    }
    throw Error('The native League battle did not finish and hand back to navigation.');
  }finally{emulator.close();}
}
