import assert from 'node:assert/strict';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {battleDecisionState} from '../engine/firered/src/player/battle-model.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';
import {resolvePostgameObjective,POSTGAME_WATCH} from '../engine/firered/src/suite/postgame-agenda.js';

// The live postgame team between League rounds: four level-100 members,
// Persian (94) and the starter Venusaur (89); the Exp. Share sits on a boxed
// Raichu. Five battlers carry the round while a passive trainee holds the Exp.
// Share. Only the League objective and committed team plan are reconstructed.
const HALL_OF_FAME = 'MAP_POKEMON_LEAGUE_HALL_OF_FAME';
const LEAGUE = /^MAP_POKEMON_LEAGUE_(LORELEIS|BRUNOS|AGATHAS|LANCES|CHAMPIONS)_ROOM$/;

export async function replayLeagueExpShare({session, saved, inputs}) {
  const {teamPlan} = saved.metadata.replay;
  const basePlanner = createCampaignPlanner({...inputs, mechanics: inputs.battle});
  let workflows = {}, objective = null;
  const resolve = o => resolvePostgameObjective('league-rematch', o, inputs.world, workflows,
    {mechanics: inputs.battle, teamPlan, planner: basePlanner, protectedFingerprints: []});
  const planner = {...basePlanner, select: () => objective, selectCollection: () => null, selectTraining: () => null,
    selectBattleSquad: () => [], campaignStatus: () => ({objective: objective?.id}), state: () => ({objective})};
  const open = state => createCentralPlayer({campaignPlanner: planner, mechanics: inputs.battle, initialState: state,
    advisors: createPolicyAdvisors({world: inputs.world, mechanics: inputs.battle, teamPlan, campaignPlanner: planner})});
  let player = open();
  const observer = createFireRedObserver({session, ...inputs, runId: 'league-exp-share',
    storyWatch: {flags: [...new Set([...POSTGAME_WATCH.flags, 1212])], variables: POSTGAME_WATCH.variables}});
  const before = observer.capture(), identity = p => JSON.stringify([p.otId, p.personality]);
  const originals = new Map(before.playerMemory.trainer.party.map(p => [identity(p), p]));
  assert.equal(before.playerMemory.map.id, 'MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F');
  assert.equal(before.playerMemory.storyState.flagIds[2116], true, 'the rematch League is open');
  let now = 0, serial = 0; const jobs = new Map();
  const emulator = createAutonomousEmulator({session, emulationSpeed: 10, frameExact: true, videoFramesPerSecond: 1,
    clock: () => now, schedule(callback, delay) { const id = ++serial; jobs.set(id, {callback, at: now + delay}); return id; },
    cancel: id => jobs.delete(id), actionObservation: () => observer.capture(), controllerState: () => observer.captureControllerState()});
  const sameAs = (p, t) => Number(p?.personality) === Number(t?.personality) && Number(p?.otId) === Number(t?.otId);
  let trainee = null, entry = null, restarted = false, battles = 0, lastTrainer = null, entered = [], lastTrace = '';
  try {
    for (let step = 0; step < 60000; step++) {
      const o = observer.capture(), m = o.playerMemory;
      if (o.phase === 'stable' && !o.emulator.inBattle && o.emulator.mode !== 'hall-of-fame') objective = resolve(o);
      const decision = player.decide(o), r = decision.winner?.recommendation;
      assert.notEqual(decision.kind, 'blocked', decision.reason);
      const trace = JSON.stringify([m.map?.id, objective?.id, objective?.target?.kind, workflows.leagueExpShare?.disabled?.reason ?? null]);
      if (trace !== lastTrace) { console.log('# league-exp-share ' + o.frame + ' ' + trace); lastTrace = trace; }
      if (!trainee && LEAGUE.test(m.map?.id ?? '') && workflows.leagueExpShare?.active) {
        trainee = workflows.leagueExpShare.trainee;
        const member = m.trainer.party.find(p => sameAs(p, trainee));
        assert.ok(member, 'the trainee entered the League in the party');
        assert.equal(member.heldItem, 182, 'the trainee holds the Exp. Share');
        assert.notEqual([...m.trainer.party].sort((a, b) => a.slot - b.slot)[0].personality, member.personality, 'the trainee does not lead');
        entry = {experience: member.experience, level: member.level, species: member.species};
      }
      if (o.emulator.inBattle && trainee) {
        const b = battleDecisionState(m, m.ui ?? {});
        if (b?.trainerId && b.trainerId !== lastTrainer) { battles++; lastTrainer = b.trainerId; }
        const active = m.trainer.party.find(p => Number(p.slot) === Number(b?.playerPartySlot));
        const activeIsTrainee = active ? sameAs(active, trainee) :
          Number(b?.player?.species) === Number(entry.species) && m.trainer.party.filter(p => p.species === entry.species).length === 1;
        if (activeIsTrainee && Number(b?.player?.hp) > 0) entered.push({frame: o.frame, turn: b.turn, trainerId: b.trainerId});
      }
      if (!restarted && o.emulator.inBattle && m.ui.party?.stage === 'choose-pokemon') {
        workflows = JSON.parse(JSON.stringify(workflows));
        player = open(JSON.parse(JSON.stringify(player.state()))); restarted = true;
      }
      if (!trainee && (m.map?.id === HALL_OF_FAME || o.emulator.mode === 'hall-of-fame'))
        throw Error(`The League round ran without a passive Exp. Share trainee (${JSON.stringify(workflows.leagueExpShare?.lastPlan ?? null)}).`);
      if (trainee && (m.map?.id === HALL_OF_FAME || o.emulator.mode === 'hall-of-fame')) {
        const member = m.trainer.party.find(p => sameAs(p, trainee));
        const summary = {startFrame: before.frame, endFrame: o.frame, trainee: {species: trainee.species, reason: trainee.reason},
          entry, exit: member && {experience: member.experience, level: member.level, species: member.species, heldItem: member.heldItem},
          battles, entered: entered.length, fallback: workflows.leagueExpShare?.disabled ?? null, restarted, steps: step,
          fainted: m.trainer.party.filter(p => p.hp === 0).map(p => p.species)};
        console.log('# league-exp-share-summary ' + JSON.stringify(summary));
        assert.equal(m.storyState.flagIds[1212], true, 'FLAG_DEFEATED_CHAMP proves the round was won');
        assert.ok(battles >= 5, `all five League battles were fought (${battles})`);
        assert.deepEqual(entered, [], 'the passive trainee never entered battle');
        assert.ok(member && member.experience > entry.experience, 'the trainee gained Exp. Share experience');
        assert.equal(member.heldItem, 182, 'the trainee still holds the Exp. Share');
        // One fainted battler would be a strike and two a hold (league-exp-share.js); none may occur in this round.
        assert.equal(workflows.leagueExpShare?.disabled ?? null, null, `no hold in the trained round (${JSON.stringify(workflows.leagueExpShare?.disabled ?? null)})`);
        assert.equal(workflows.leagueExpShare?.round?.faints?.length ?? 0, 0, 'no battler fainted in the trained round');
        assert.ok(restarted, 'a committed battle party action survived reconstruction');
        assert.deepEqual([...originals.keys()].filter(k => !m.trainer.party.some(p => identity(p) === k)).length <= 1, true,
          'at most one original member is boxed for the trainee');
        return {before, after: o};
      }
      let done = false, result, error;
      emulator.execute(decision.action ?? {buttons: [], holdFrames: 8, releaseFrames: 0}).then(x => { result = x; done = true; }, e => { error = e; done = true; });
      for (let n = 0; n < 5000 && !done; n++) {
        await Promise.resolve(); if (done) break;
        const [id, task] = [...jobs].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
        assert.ok(task, 'native input remains scheduled'); jobs.delete(id); now = task.at; task.callback();
      }
      assert.ok(done, 'the action must settle'); if (error) throw error;
      player.observeExecution({observation: o, decision, execution: result});
      if (!o.emulator.inBattle && trainee && m.trainer.party.every(p => p.hp === 0)) throw Error('The League round was lost.');
    }
    throw Error(`The League round with a passive Exp. Share trainee did not reach the Hall of Fame (trainee ${JSON.stringify(trainee)}).`);
  } finally { emulator.close(); }
}
