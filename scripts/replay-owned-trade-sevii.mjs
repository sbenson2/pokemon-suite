import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCampaignPlanner,campaignNavigationOutcome} from '../engine/firered/src/player/campaign.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';
import {TradePreparation} from '../engine/firered/src/suite/trade-preparation.js';
import {FireRedNativeTradeHost} from '../engine/firered/src/suite/native-trade-host.js';
import {LINK_QUEST_WATCH} from '../engine/firered/src/suite/fire-red-link-quest.js';
import {POSTGAME_WATCH} from '../engine/firered/src/suite/postgame-agenda.js';
import {BALL_SHOP_WATCH} from '../engine/firered/src/suite/ball-supplies.js';
import {encounterFingerprint as fingerprint} from '../engine/firered/src/player/encounter-tracker.js';

// Live hardware test (Sept 27, build 121): a Switch trade of shiny Hitmonlee
// was selected while the bot stood in the Four Island Sticker Man's house.
// Trade preparation targets the Lavender Pokémon Center and its objective was
// used without the Seagallop leg, so every decision waited on "No executable
// route" until the 15-minute travel limit. This case starts from that retained
// preparation (phase party, full party, the capture in box 1) and must sail to
// Vermilion, withdraw the exact capture at Lavender, heal and verify a fresh
// native save, surviving a restart at the harbor and on the Kanto mainland.
const LAVENDER='MAP_LAVENDER_TOWN_POKEMON_CENTER_1F';

export async function replayOwnedTradeSevii({session,saved,inputs,fixture}) {
  const receipt=JSON.parse(readFileSync(fixture.receipt,'utf8'));
  const retained=saved.metadata.ownedTrade;
  assert.equal(retained.state.phase,'trade-party');
  assert.equal(retained.preparation.phase,'party');
  assert.equal(retained.preparation.center,LAVENDER);
  assert.equal(receipt.fingerprint,retained.preparation.fingerprint);
  const basePlanner=createCampaignPlanner({world:inputs.world,story:inputs.story,mechanics:inputs.battle});
  let objective=null;
  // The worker's trade planner: the preparation's objective is the only goal.
  const planner={...basePlanner,select:()=>objective,selectCollection:()=>null,selectTraining:()=>null,selectBattleSquad:()=>[],
    campaignStatus:()=>({objective:objective?.id}),state:()=>({mission:null,objective})};
  const playerFor=state=>createCentralPlayer({campaignPlanner:planner,initialState:state,mechanics:inputs.battle,
    advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,campaignPlanner:planner})});
  const prepare=state=>new TradePreparation({receipt,center:retained.preparation.center,nurseIndex:retained.preparation.nurseIndex,
    mechanics:inputs.battle,world:inputs.world,state});
  const watch=basePlanner.storyWatch();
  const observer=createFireRedObserver({session,...inputs,runId:'owned-trade-sevii',storyWatch:{
    variables:[...new Set([...(watch.variables??[]),...LINK_QUEST_WATCH.variables,...BALL_SHOP_WATCH.variables,...POSTGAME_WATCH.variables])],
    flags:[...new Set([...watch.flags,...LINK_QUEST_WATCH.flags,...BALL_SHOP_WATCH.flags,...POSTGAME_WATCH.flags,84,128,573,611,2092,2112,2116])]}});
  const before=observer.capture(),t0=before.playerMemory.trainer;
  const all=t=>[...t.party,...t.storage.pokemon].map(fingerprint).sort();
  assert.equal(before.playerMemory.map.id,'MAP_FOUR_ISLAND_HOUSE2');
  assert.equal(t0.party.length,6);
  assert.ok(!t0.party.some(p=>fingerprint(p)===receipt.fingerprint)&&t0.storage.pokemon.some(p=>fingerprint(p)===receipt.fingerprint),'the capture starts in the PC');
  // The unfixed objective: Lavender is not reachable from Sevii without the ferry.
  const raw={id:'trade-withdraw-capture',target:{kind:'party-roster',map:LAVENDER,requiredFingerprints:[receipt.fingerprint]}};
  assert.equal(campaignNavigationOutcome({world:inputs.world,observation:before,objective:raw}).status,'unsupported');
  let preparation=prepare(structuredClone(retained.preparation)),player=playerFor(structuredClone(retained.player));
  let now=0,serial=0;const jobs=new Map();
  const emulator=createAutonomousEmulator({session,emulationSpeed:10,frameExact:true,videoFramesPerSecond:1,
    clock:()=>now,schedule(callback,delay){const id=++serial;jobs.set(id,{callback,at:now+delay});return id;},
    cancel:id=>jobs.delete(id),actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState()});
  const visited=new Set(),restarted=new Set();let last='';
  try{
    for(let step=0;step<30000;step++){
      const o=observer.capture(),m=o.playerMemory,next=preparation.inspect(o);
      visited.add(m.map?.id);
      assert.notEqual(next.kind,'stop',next.reason);
      if(next.kind==='ready'){
        const t=m.trainer;
        assert.ok(visited.has('MAP_FOUR_ISLAND_HARBOR')&&visited.has('MAP_VERMILION_CITY'),'the capture crossed by Seagallop');
        assert.ok(restarted.has('harbor')&&restarted.has('mainland'),'the preparation survived both restarts');
        assert.equal(m.map.id,LAVENDER);
        assert.equal(fingerprint(next.pokemon),receipt.fingerprint);
        assert.ok(t.party.some(p=>fingerprint(p)===receipt.fingerprint),'the exact capture is in the party');
        assert.deepEqual(all(t),all(t0),'every Pokémon is kept; only party and PC places changed');
        assert.equal(preparation.state.nativeSaveVerified,true);
        assert.equal(m.gameStats.savedGame,before.playerMemory.gameStats.savedGame+1);
        assert.notEqual(o.sram.sha256,before.sram.sha256);
        const host=new FireRedNativeTradeHost({world:inputs.world,center:preparation.state.center,fingerprint:receipt.fingerprint});
        assert.equal(host.state.map,'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F');
        console.log('# owned-trade-sevii '+JSON.stringify({startFrame:before.frame,endFrame:o.frame,steps:step,visited:[...visited].length}));
        return {before,after:o};
      }
      if(next.objective)objective=next.objective;
      const stage=m.map?.id==='MAP_FOUR_ISLAND_HARBOR'&&m.ui?.fieldDialog?'harbor':
        m.map?.id==='MAP_VERMILION_CITY'&&o.phase==='stable'&&o.emulator.mode==='overworld'&&!Object.values(m.ui??{}).some(Boolean)?'mainland':null;
      if(stage&&!restarted.has(stage)){
        preparation=prepare(JSON.parse(JSON.stringify(preparation.state)));player=playerFor(JSON.parse(JSON.stringify(player.state())));restarted.add(stage);
      }
      const decision=next.kind==='wait'?{kind:'resample',action:{buttons:[],holdFrames:8,releaseFrames:0}}:player.decide(o);
      assert.ok(!['blocked','complete'].includes(decision.kind),decision.reason);
      assert.notEqual(decision.winner?.recommendation?.kind,'wait-for-supported-objective',`${m.map?.id}: ${objective?.id} has no route`);
      const trace=JSON.stringify([m.map?.id,m.position,o.emulator.mode,objective?.id,decision.winner?.recommendation?.kind]);
      if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# owned-trade-sevii '+o.frame+' '+trace);last=trace;}
      let done=false,result,error;
      emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0}).then(r=>{result=r;done=true;},e=>{error=e;done=true;});
      for(let n=0;n<5000&&!done;n++){
        await Promise.resolve();if(done)break;
        const [id,task]=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0]??[];
        assert.ok(task,'native input remains scheduled');jobs.delete(id);now=task.at;task.callback();
      }
      assert.ok(done,'the action must settle');if(error)throw error;
      if(next.kind!=='wait')player.observeExecution({observation:o,decision,execution:result});
    }
  }finally{emulator.close();}
  throw Error('The Sevii trade preparation did not reach a saved Lavender party.');
}
