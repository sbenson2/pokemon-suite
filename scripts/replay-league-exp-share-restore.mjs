import assert from 'node:assert/strict';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';
import {resolvePostgameObjective,POSTGAME_WATCH} from '../engine/firered/src/suite/postgame-agenda.js';

// The live postgame team between League rounds (see replay-league-exp-share.mjs):
// Venusaur (89) becomes the passive Exp. Share trainee. First Venusaur is given
// its own held item, Dragonite's King's Rock, with the ordinary take/give
// targets (controller inputs only). The composition must set that item aside
// for Venusaur while it holds the Exp. Share; the general held-item policy
// would otherwise equip it on another member from the Bag. The passive setup
// then ends (the recorded sticky fallback after a fainted battler, in the record
// shape of an earlier engine) and the next visit must give Venusaur its King's
// Rock back and return the Exp. Share before the full team goes in. That record
// is never lifted without an owner resume. The case stops before the League doors.
const CENTER = 'MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F', KINGS_ROCK = 187, EXP_SHARE = 182, VENUSAUR = 3;
const ROUND = new Set(['postgame-league-rematch-battle-0', 'postgame-league-rematch-interact']);

export async function replayLeagueExpShareRestore({session, saved, inputs}) {
  const {teamPlan} = saved.metadata.replay;
  const basePlanner = createCampaignPlanner({...inputs, mechanics: inputs.battle});
  let workflows = {}, objective = null;
  const resolve = o => resolvePostgameObjective('league-rematch', o, inputs.world, workflows,
    {mechanics: inputs.battle, teamPlan, planner: basePlanner, protectedFingerprints: []});
  const planner = {...basePlanner, select: () => objective, selectCollection: () => null, selectTraining: () => null,
    selectBattleSquad: () => [], campaignStatus: () => ({objective: objective?.id}), state: () => ({objective})};
  const player = createCentralPlayer({campaignPlanner: planner, mechanics: inputs.battle,
    advisors: createPolicyAdvisors({world: inputs.world, mechanics: inputs.battle, teamPlan, campaignPlanner: planner})});
  const observer = createFireRedObserver({session, ...inputs, runId: 'league-exp-share-restore',
    storyWatch: {flags: [...POSTGAME_WATCH.flags], variables: POSTGAME_WATCH.variables}});
  const before = observer.capture(), t0 = before.playerMemory.trainer;
  assert.equal(before.playerMemory.map.id, CENTER);
  assert.equal(before.playerMemory.storyState.flagIds[2116], true, 'the rematch League is open');
  const same = (p, q) => Boolean(p && q) && Number(p.personality) === Number(q.personality) && Number(p.otId) === Number(q.otId);
  const venusaur = t0.party.find(p => p.species === VENUSAUR), dragonite = t0.party.find(p => p.heldItem === KINGS_ROCK);
  assert.ok(venusaur && dragonite && venusaur.heldItem === 0, 'Venusaur holds nothing and a party member holds the King\'s Rock');
  const holdings = o => {
    const t = o.playerMemory.trainer, bag = Object.values(t.bag ?? {}).flat();
    const count = id => bag.filter(i => i?.itemId === id).reduce((n, i) => n + i.quantity, 0);
    const holders = id => [...t.party, ...(t.storage?.pokemon ?? [])].filter(p => p.validity === 'valid' && p.heldItem === id);
    return {bag: {[EXP_SHARE]: count(EXP_SHARE), [KINGS_ROCK]: count(KINGS_ROCK)}, [EXP_SHARE]: holders(EXP_SHARE), [KINGS_ROCK]: holders(KINGS_ROCK)};
  };
  const initial = holdings(before);
  assert.equal(initial.bag[EXP_SHARE] + initial[EXP_SHARE].length, 1, 'one Exp. Share');
  let now = 0, serial = 0; const jobs = new Map();
  const emulator = createAutonomousEmulator({session, emulationSpeed: 10, frameExact: true, videoFramesPerSecond: 1,
    clock: () => now, schedule(callback, delay) { const id = ++serial; jobs.set(id, {callback, at: now + delay}); return id; },
    cancel: id => jobs.delete(id), actionObservation: () => observer.capture(), controllerState: () => observer.captureControllerState()});
  // Setup: Dragonite's King's Rock becomes Venusaur's own item. identityEvolution
  // keeps the general equipment policy out of this two-step move.
  // The checkpoint opens on the start menu's save prompt: close it first (no save).
  let settled = false;
  const setup = o => {
    settled ||= o.emulator.mode === 'overworld' && !Object.values(o.playerMemory.ui ?? {}).some(Boolean);
    if (!settled) return {id: 'replay-close-menus', target: {kind: 'map', map: CENTER}, identityEvolution: true, deferOptionalDetours: true};
    const party = o.playerMemory.trainer.party, d = party.find(p => same(p, dragonite)), v = party.find(p => same(p, venusaur));
    const step = (kind, who) => ({id: `replay-own-item-${kind}`, target: {kind, fingerprint: encounterFingerprint(who), map: CENTER, itemId: KINGS_ROCK},
      dialogue: 'advance', identityEvolution: true, deferOptionalDetours: true});
    if (d?.heldItem === KINGS_ROCK) return step('take-held-item', d);
    if (v?.heldItem !== KINGS_ROCK) return step('give-held-item', v);
    return null;
  };
  let phase = 'setup', lastTrace = '', composed = null, objectives = [], legacy = null;
  const traceObjective = (o, extra = null) => {
    const trace = JSON.stringify([phase, objective?.id, objective?.target?.kind, objective?.target?.itemId ?? null, extra]);
    if (trace !== lastTrace) { console.log('# league-exp-share-restore ' + o.frame + ' ' + trace); lastTrace = trace; objectives.push([phase, objective?.id, objective?.target?.itemId ?? null]); }
  };
  try {
    for (let step = 0; step < 40000; step++) {
      const o = observer.capture(), m = o.playerMemory;
      assert.ok(!o.emulator.inBattle && !/^MAP_POKEMON_LEAGUE_/.test(m.map?.id ?? ''), 'the case never enters the League');
      if (o.phase === 'stable') {
        if (phase === 'setup') {
          objective = setup(o);
          if (!objective) { phase = 'compose'; const h = holdings(o); console.log('# league-exp-share-restore own-item ' + JSON.stringify({bag: h.bag, [EXP_SHARE]: h[EXP_SHARE].map(p => p.species), [KINGS_ROCK]: h[KINGS_ROCK].map(p => p.species)})); }
        }
        if (phase !== 'setup') objective = resolve(o);
        assert.notEqual(objective?.target?.kind, 'stop-for-review', objective?.target?.reason);
        // After the setup the King's Rock is Venusaur's: on Venusaur or in the Bag, never on another
        // member (checked on the settled field; menus briefly leave entries unreadable).
        const field = o.emulator.mode === 'overworld' && !Object.values(m.ui ?? {}).some(Boolean) &&
          m.trainer.partyValidity === 'valid' && m.trainer.storage?.validity === 'valid';
        if (phase !== 'setup' && field) {
          const h = holdings(o);
          assert.ok(h[KINGS_ROCK].every(p => same(p, venusaur)) && h[KINGS_ROCK].length + h.bag[KINGS_ROCK] === 1,
            `Venusaur's own King's Rock stays reserved for it: ${JSON.stringify(h[KINGS_ROCK].map(p => p.species))} bag ${h.bag[KINGS_ROCK]}`);
          assert.equal(h[EXP_SHARE].length + h.bag[EXP_SHARE], 1, 'one Exp. Share');
        }
        if (phase === 'compose' && ROUND.has(objective?.id)) {
          const h = holdings(o), v = m.trainer.party.find(p => same(p, venusaur));
          assert.equal(objective.expShareTrainee?.species, VENUSAUR, 'Venusaur is the passive trainee');
          assert.equal(v?.heldItem, EXP_SHARE, 'the trainee holds the Exp. Share');
          assert.equal(h.bag[KINGS_ROCK], 1, 'its own King\'s Rock waits in the Bag');
          composed = {frame: o.frame, lent: workflows.leagueExpShare?.lent ?? null};
          console.log('# league-exp-share-restore composed ' + JSON.stringify(composed));
          // The round is not played: the passive setup ends with the recorded
          // sticky fallback (a battler fainted in the previous round).
          const s = workflows.leagueExpShare;
          s.disabled = {reason: 'battler-fainted', leagueEntries: m.gameStats?.leagueEntries ?? null, frame: o.frame, map: 'MAP_POKEMON_LEAGUE_LORELEIS_ROOM'};
          legacy = structuredClone(s.disabled);
          s.active = false; delete s.round;
          phase = 'restore'; objective = resolve(o);
        }
        if (phase === 'restore' && ROUND.has(objective?.id)) {
          traceObjective(o);
          const h = holdings(o), v = m.trainer.party.find(p => same(p, venusaur));
          const summary = {startFrame: before.frame, endFrame: o.frame, composed, restored: workflows.leagueExpShare?.restored ?? null,
            venusaurItem: v?.heldItem, expShare: {bag: h.bag[EXP_SHARE], holders: h[EXP_SHARE].map(p => p.species)}, objectives};
          console.log('# league-exp-share-restore-summary ' + JSON.stringify(summary));
          assert.equal(v?.heldItem, KINGS_ROCK, 'the returned trainee holds its own King\'s Rock again');
          assert.equal(objective.expShareTrainee, undefined, 'the full team plays the next round');
          assert.equal(objective.minimumBattlePartySize, 6);
          assert.ok(objectives.some(([p, id, item]) => p === 'restore' && /take-held-item$/.test(id) && item === EXP_SHARE), 'the Exp. Share was taken back');
          assert.ok(objectives.some(([p, id, item]) => p === 'restore' && /give-held-item$/.test(id) && item === KINGS_ROCK), 'the own item was given back');
          assert.ok(!h[EXP_SHARE].some(p => same(p, venusaur)), 'the Exp. Share left the returned trainee');
          // The older record stays held: the engine only notes when it first saw it.
          const s = workflows.leagueExpShare, {firstSeenAt, ...kept} = s.disabled ?? {};
          assert.deepEqual(kept, legacy, 'the older hold record is kept');
          assert.match(firstSeenAt ?? '', /^\d{4}-\d\d-\d\dT/, 'its first sighting is recorded');
          assert.ok(!s.history?.some(e => e.kind === 'resumed'), 'nothing resumed it');
          return {before, after: o};
        }
      }
      traceObjective(o);
      const decision = player.decide(o);
      assert.notEqual(decision.kind, 'blocked', decision.reason);
      let done = false, result, error;
      emulator.execute(decision.action ?? {buttons: [], holdFrames: 8, releaseFrames: 0}).then(x => { result = x; done = true; }, e => { error = e; done = true; });
      for (let n = 0; n < 5000 && !done; n++) {
        await Promise.resolve(); if (done) break;
        const [id, task] = [...jobs].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
        assert.ok(task, 'native input remains scheduled'); jobs.delete(id); now = task.at; task.callback();
      }
      assert.ok(done, 'the action must settle'); if (error) throw error;
      player.observeExecution({observation: o, decision, execution: result});
    }
    throw Error(`The League Exp. Share restore did not finish (phase ${phase}, objective ${objective?.id}).`);
  } finally { emulator.close(); }
}
