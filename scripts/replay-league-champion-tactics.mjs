import assert from 'node:assert/strict';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import * as battleModel from '../engine/firered/src/player/battle-model.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';

// A live postgame Champion rematch bounced its healthy counters (Golduck to
// Fearow and back against Charizard) and paid for several matchup switches.
// Replay the retained pre-battle room state through the Hall of Fame entry.
const VOLUNTARY = new Set(['improve-battle-matchup', 'improve-battle-coverage', 'protect-struggling-pokemon']);
const HALL_OF_FAME = 'MAP_POKEMON_LEAGUE_HALL_OF_FAME';

export async function replayLeagueChampionTactics({session, saved, inputs}) {
  const {objective, teamPlan} = saved.metadata.replay;
  assert.equal(objective.battleCategory, 'champion');
  const open = state => {
    const planner = createCampaignPlanner({...inputs, mechanics: inputs.battle, teamPlan,
      campaign: {objectives: [objective]}, initialState: state?.campaignPlanner});
    const player = createCentralPlayer({campaignPlanner: planner, mechanics: inputs.battle, initialState: state,
      advisors: createPolicyAdvisors({world: inputs.world, mechanics: inputs.battle, teamPlan, campaignPlanner: planner})});
    return {player, planner};
  };
  let {player, planner} = open();
  const watch = planner.storyWatch();
  const observer = createFireRedObserver({session, ...inputs, runId: 'league-champion-tactics',
    storyWatch: {flags: [...new Set([...watch.flags, 1211, 1212, 2092, 2116])], variables: watch.variables}});
  const before = observer.capture(), identity = p => JSON.stringify([p.otId, p.personality]);
  const party = new Map(before.playerMemory.trainer.party.map(p => [identity(p), p]));
  assert.equal(before.playerMemory.map.id, 'MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM');
  assert.equal(before.playerMemory.storyState.flagIds[1211], true, 'Lance is already defeated');
  assert.equal(before.playerMemory.storyState.flagIds[2116], true, 'the rematch Champion party is active');
  assert.equal(before.playerMemory.storyState.flagIds[1212], false, 'the Champion is not yet defeated');
  let now = 0, serial = 0; const jobs = new Map();
  const emulator = createAutonomousEmulator({session, emulationSpeed: 10, frameExact: true, videoFramesPerSecond: 1,
    clock: () => now, schedule(callback, delay) { const id = ++serial; jobs.set(id, {callback, at: now + delay}); return id; },
    cancel: id => jobs.delete(id), actionObservation: () => observer.capture(), controllerState: () => observer.captureControllerState()});
  const paid = [], switchBacks = [], winnersSwitchedOut = [], withdrawn = new Map();
  let restarted = false, battled = false, trainerId = null, lastPaidTurn = null, lastTrace = '', finalTurn = null;
  const raceOf = (m, b) => {
    if (typeof battleModel.battleKoRace !== 'function' || !b?.player || !b?.opponent) return null;
    const active = m.trainer.party.find(p => Number(p.slot) === Number(b.playerPartySlot));
    return battleModel.battleKoRace({mechanics: inputs.battle, member: active ? {...active, ...b.player} : b.player,
      opponent: b.opponent, weather: b.weather});
  };
  try {
    for (let step = 0; step < 24000; step++) {
      const o = observer.capture(), m = o.playerMemory;
      const b = o.emulator.inBattle ? battleModel.battleDecisionState(m, m.ui ?? {}) : null;
      const decision = player.decide(o), r = decision.winner?.recommendation;
      assert.notEqual(decision.kind, 'blocked', decision.reason);
      if (b) { battled = true; trainerId = b.trainerId ?? trainerId; if (Number.isInteger(b.turn)) finalTurn = b.turn; }
      if (process.env.SUITE_REPLAY_TRACE === '1' && b && r && ['choose-battle-command', 'choose-battle-move', 'choose-party-member', 'choose-menu-option'].includes(r.kind)) {
        const trace = JSON.stringify({turn: b.turn, player: b.player?.species, hp: b.player?.hp, opponent: b.opponent?.species,
          enemyHp: b.opponent?.hp, recommendation: r});
        if (trace !== lastTrace) { console.log('# champion ' + o.frame + ' ' + trace); lastTrace = trace; }
      }
      if (b && r?.kind === 'choose-battle-command' && r.targetCommand === 'pokemon' && VOLUNTARY.has(r.objective) &&
          m.ui.battle?.stage === 'action' && b.turn !== lastPaidTurn) {
        lastPaidTurn = b.turn;
        const stint = `${b.battlerPartyIndexes?.[1]}:${b.opponent?.species}`, from = Number(b.playerPartySlot), to = Number(r.targetPartySlot);
        const race = raceOf(m, b);
        const event = {turn: b.turn, stint, from, fromSpecies: b.player?.species, to, objective: r.objective,
          activeWinsRace: race?.wins ?? null};
        paid.push(event);
        if (withdrawn.get(stint)?.has(to)) switchBacks.push(event);
        withdrawn.set(stint, new Set([...(withdrawn.get(stint) ?? []), from]));
        if (race?.wins) winnersSwitchedOut.push(event);
      }
      if (!restarted && o.emulator.inBattle && m.ui.party?.stage === 'choose-pokemon') {
        ({player, planner} = open(JSON.parse(JSON.stringify(player.state())))); restarted = true;
      }
      if (battled && (m.map?.id === HALL_OF_FAME || o.emulator.mode === 'hall-of-fame')) {
        const summary = {startFrame: before.frame, endFrame: o.frame, finalTurn, paidSwitches: paid.length, switchBacks: switchBacks.length,
          winnersSwitchedOut: winnersSwitchedOut.length, raceEvaluator: typeof battleModel.battleKoRace === 'function', restarted, steps: step,
          fainted: m.trainer.party.filter(p => p.hp === 0).map(p => p.species), paid};
        console.log('# league-champion-tactics ' + JSON.stringify(summary));
        assert.equal(trainerId, 741, 'the Charmander-variant rematch Champion was fought');
        assert.equal(m.storyState.flagIds[1212], true, 'FLAG_DEFEATED_CHAMP proves the rematch was won');
        assert.deepEqual(m.trainer.party.map(identity).sort(), [...party.keys()].sort());
        assert.ok(restarted, 'a committed battle party action survived reconstruction');
        assert.deepEqual(switchBacks, [], 'never switch back to a member withdrawn against the same opponent');
        assert.deepEqual(winnersSwitchedOut, [], 'never pay to switch out an active member that wins its KO race');
        assert.ok(paid.length <= 2, `avoid the retained Champion switch cycle (${paid.length} paid switches)`);
        return {before, after: o};
      }
      let done = false, result, error;
      emulator.execute(decision.action ?? {buttons: [], holdFrames: 8, releaseFrames: 0}).then(r => { result = r; done = true; }, e => { error = e; done = true; });
      for (let n = 0; n < 5000 && !done; n++) {
        await Promise.resolve(); if (done) break;
        const [id, task] = [...jobs].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
        assert.ok(task, 'native input remains scheduled'); jobs.delete(id); now = task.at; task.callback();
      }
      assert.ok(done, 'the action must settle'); if (error) throw error;
      player.observeExecution({observation: o, decision, execution: result});
      if (!o.emulator.inBattle && battled && m.trainer.party.every(p => p.hp === 0)) throw Error('The Champion rematch was lost.');
    }
    throw Error(`The native Champion rematch did not reach the Hall of Fame (${paid.length} paid switches, turn ${finalTurn}).`);
  } finally { emulator.close(); }
}
