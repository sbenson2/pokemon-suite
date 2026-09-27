// Central player. One decision loop owns the controller: it observes the
// cartridge, lets the battle, dialog, campaign, training and recovery
// advisors propose, records the winner, and executes exactly one bounded
// edge before observing again. Policies never press buttons themselves.

import { runBattle } from './battle.mjs';
import { advanceScript, interact } from './dialog.mjs';
import { face, holdFrames, press, walkSegment } from './locomotion.mjs';
import { currentMapId, liveBoulders, scriptPersists, travelTo } from './navigation.mjs';
import { captureTargets, createCampaign, learnerTargets, freeHealers, healDecision, mapTransitionDistances, shoppingPlan } from './campaign.mjs';
import { teachFromPack, useFieldMoveOnFacingTile, closeMenus, buyFromClerk, packVisible, startMenuVisible, movePartyMemberToLead, depositPartyMember } from './field.mjs';
import { DESIRED_OPTIONS, currentOptions, ensureGameOptions, optionsSatisfied } from './options.mjs';
import { classifyParty, depositCandidate, leadRestoreSlot } from './contracts.mjs';
import { teamPlanForStarter } from '../index.mjs';

const STARTER_FAMILIES = Object.freeze({ CHIKORITA: [152, 153, 154], CYNDAQUIL: [155, 156, 157], TOTODILE: [158, 159, 160] });

export function starterOf(observation) {
  for (const member of observation.party) {
    for (const [starter, ids] of Object.entries(STARTER_FAMILIES)) if (ids.includes(member.speciesId)) return starter;
  }
  return null;
}

/** Forget the weakest damaging non-HM move (never an HM move, never the only damaging move). */
export function chooseMoveToForget(observation, knowledge) {
  const lead = observation.party.find((member) => !member.isEgg);
  if (!lead) return 0;
  const hmMoves = new Set(['CUT', 'FLY', 'SURF', 'STRENGTH', 'FLASH', 'WHIRLPOOL', 'WATERFALL']);
  const scored = lead.moves.map((move) => {
    const data = knowledge.moves.get(move.id);
    const power = data?.power ?? 0;
    return { slot: move.slot, name: move.name, power, hm: hmMoves.has((data?.name ?? move.name).replace(' ', '_')) };
  });
  const candidates = scored.filter((move) => !move.hm).sort((left, right) => left.power - right.power);
  return candidates[0]?.slot ?? 0;
}

export class PlayerStallError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'PlayerStallError';
    this.detail = detail;
  }
}

const partySummary = (observation) => observation.party.map((member) => `${member.speciesName} L${member.level} ${member.hp}/${member.maxHp}`).join('; ');
const signatureOf = (observation) => JSON.stringify([
  observation.map, observation.party.map((member) => [member.speciesId, member.level, member.hp]),
  observation.trainer.badges, observation.balls.length, observation.items.length, observation.trainer.money,
]);

export function createCrystalPlayer({ world, knowledge, observer, journal, runId, stallDecisions = 40, runProfile = null, diagnostics = null, campaign = createCampaign({ knowledge, world, starter: runProfile?.starter ?? null, teamPlan: runProfile?.teamPlan ?? 'v1' }) } = {}) {
  let sequence = 0;
  let lastDecision = null;
  let lastAdvice = null;
  let activePlan = null;
  const watchdog = { signature: null, repeats: 0 };
  const shoppingCooldown = new Set();
  const teamPlanVersion = runProfile?.teamPlan ?? 'v1'; // fresh runs choose with --team-plan; resumed runs keep their profile's plan
  let optionsAttempts = 0;
  const healerCatalog = freeHealers(world);
  const transitionDistances = new Map();
  const observe = observer.observe;
  const hasEventFor = (observation) => (name) => observer.hasEvent(observation, name);

  /** Serializable central-player state, stored in every replay bundle. */
  const playerState = () => ({
    schema: 'pokemon-research/crystal-player-state/v1',
    sequence,
    activePlan: activePlan ? { kind: activePlan.kind, reason: activePlan.reason ?? null, destination: activePlan.destination ?? null, ground: activePlan.ground?.mapId ?? null, point: activePlan.point?.mapId ?? null, minimumLevel: activePlan.minimumLevel ?? null, learn: activePlan.learn ?? null } : null,
    watchdog: { repeats: watchdog.repeats, signature: watchdog.signature },
    shoppingCooldown: [...shoppingCooldown],
    lastAdvice,
    lastDecision: lastDecision ? { sequence: lastDecision.sequence, kind: lastDecision.kind, reason: lastDecision.reason } : null,
    runProfile,
  });

  const record = ({ kind, reason, winner, action }, observation) => {
    sequence += 1;
    const decision = Object.freeze({
      sequence, kind, reason, winner, action,
      frame: observation.frame,
      map: currentMapId(world, observation),
      position: { x: observation.map.x, y: observation.map.y },
      party: partySummary(observation),
      at: new Date().toISOString(),
    });
    lastDecision = decision;
    journal?.append({ type: 'decision', runId, ...decision });
    diagnostics?.onDecision(decision, observation, playerState());
    return decision;
  };

  const anomaly = (message, detail = {}) => {
    journal?.append({ type: 'anomaly', runId, sequence, message, ...detail });
    diagnostics?.noteAnomaly(message, detail, { playerState: playerState(), decision: lastDecision, sequence });
  };

  const captureContext = (observation) => {
    const starter = runProfile?.starter ?? starterOf(observation);
    let targets = new Set();
    try {
      if (starter) targets = captureTargets(observation, knowledge, teamPlanForStarter(starter, { version: teamPlanVersion }));
    } catch {
      targets = new Set();
    }
    // A capture objective adds every local grass species that can learn the
    // wanted HM (Route 32 Wooper, Slowpoke Well Slowpoke for SURF).
    if (activePlan?.kind === 'capture' && activePlan.learn) {
      const owned = new Set(observation.party.map((member) => member.speciesId));
      for (const id of learnerTargets({ knowledge, mapId: currentMapId(world, observation), moveName: activePlan.learn })) {
        if (!owned.has(id)) targets.add(id);
      }
    }
    return targets.size ? { targets } : null;
  };

  function* cutFacing(direction) {
    journal?.append({ type: 'field-move', runId, sequence, move: 'CUT', direction });
    return yield* useFieldMoveOnFacingTile(observe, direction, { onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }) });
  }

  function* surfFacing(direction) {
    journal?.append({ type: 'field-move', runId, sequence, move: 'SURF', direction });
    return yield* useFieldMoveOnFacingTile(observe, direction, { onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }) });
  }

  function* whirlpoolFacing(direction) {
    journal?.append({ type: 'field-move', runId, sequence, move: 'WHIRLPOOL', direction });
    return yield* useFieldMoveOnFacingTile(observe, direction, { onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }) });
  }

  function* waterfallFacing(direction) {
    journal?.append({ type: 'field-move', runId, sequence, move: 'WATERFALL', direction });
    return yield* useFieldMoveOnFacingTile(observe, direction, { onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }) });
  }

  function* activateStrength(observation) {
    // Face the nearest boulder (any adjacent side) and answer "Use STRENGTH?".
    const { boulders, others } = liveBoulders(observation, knowledge);
    const nearest = [...boulders].sort((a, b) => (Math.abs(a.x - observation.map.x) + Math.abs(a.y - observation.map.y)) - (Math.abs(b.x - observation.map.x) + Math.abs(b.y - observation.map.y)))[0];
    if (!nearest) return false;
    const mapId = currentMapId(world, observation);
    const travel = yield* travelTo({ world, observer, knowledge, onCut: cutFacing, onSurf: surfFacing, destination: { mapId, approach: nearest } });
    if (!travel.arrived || !travel.face) return false;
    journal?.append({ type: 'field-move', runId, sequence, move: 'STRENGTH', direction: travel.face });
    yield* useFieldMoveOnFacingTile(observe, travel.face, { onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }) });
    yield* holdFrames([], 20);
    return observe().strengthActive;
  }

  const travelOptions = () => ({
    world, observer, knowledge, onCut: cutFacing, onSurf: surfFacing, onStrength: activateStrength, onWhirlpool: whirlpoolFacing, onWaterfall: waterfallFacing,
    onDecision: (navigation) => journal?.append({ type: 'navigation', runId, sequence, ...navigation }),
    onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }),
  });

  function* shopAt(point, orders) {
    // Orders name the clerk that sells them by the script that contains the
    // `pokemart` command (the object with that script is the clerk).
    const objects = world.map(point.mapId).objectEvents ?? [];
    const fallback = objects.find((object) => object.sprite === 'SPRITE_CLERK') ?? null;
    const groups = new Map();
    for (const order of orders) {
      const clerk = objects.find((object) => object.script === order.clerk) ?? fallback;
      if (!clerk) continue;
      groups.set(clerk.script, [...(groups.get(clerk.script) ?? []), order]);
    }
    if (groups.size === 0) return { arrived: false, reason: 'no-clerk' };
    const bought = [];
    for (const [script, group] of groups) {
      const clerk = objects.find((object) => object.script === script);
      const travel = yield* travelTo({ ...travelOptions(), destination: { mapId: point.mapId, approach: { x: clerk.x, y: clerk.y } } });
      if (!travel.arrived) return travel;
      if (travel.face) yield* face(travel.face);
      const result = yield* buyFromClerk(observe, {
        orders: group.map((order) => ({ itemId: knowledge.itemIds.get(order.item), displayName: knowledge.itemDisplayName(knowledge.itemIds.get(order.item)), quantity: order.quantity })),
        onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }),
      });
      bought.push(...(result.bought ?? []));
      const after = observe();
      journal?.append({ type: 'shop', runId, sequence, mapId: point.mapId, clerk: script, orders: group, ...result, balls: after.balls, items: after.items, money: after.trainer.money });
    }
    return { arrived: true, bought };
  }

  function* herdStep(plan) {
    const observation = observe();
    const mapId = currentMapId(world, observation);
    if (mapId !== plan.mapId) {
      return yield* travelTo({ ...travelOptions(), destination: { mapId: plan.mapId, x: plan.table[0].at.x, y: plan.table[0].at.y + 1 } });
    }
    // wMapObjects keeps the bird's coordinates even while its object struct is
    // unloaded (it moves several screens between positions).
    const bird = observation.mapObjects.find((object) => object.sprite === plan.sprite) ?? observation.objects.find((object) => object.sprite === plan.sprite) ?? null;
    const entry = bird ? plan.table.find((row) => row.at.x === bird.x && row.at.y === bird.y) : null;
    if (!bird || !entry) {
      anomaly('farfetchd position is not in the herding table', { bird });
      const first = plan.table[0];
      const travel = yield* travelTo({ ...travelOptions(), destination: { mapId: plan.mapId, approach: first.at } });
      if (!travel.arrived) return travel;
      return { arrived: true, reason: 'positioned' };
    }
    if (entry.facings.length === 0) return { arrived: true, reason: 'herded' };
    journal?.append({ type: 'herd', runId, sequence, position: entry.position, bird: { x: bird.x, y: bird.y }, facings: entry.facings });
    const travel = yield* travelTo({ ...travelOptions(), destination: { mapId: plan.mapId, approach: entry.at, facings: entry.facings } });
    if (!travel.arrived) return travel;
    if (travel.face) yield* face(travel.face);
    yield* interact(observe, { onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }) });
    yield* holdFrames([], 30);
    return { arrived: true, reason: `herded-from-${entry.position}` };
  }

  function* teachStep(plan) {
    const observation = observe();
    const learner = plan.learner
      ? observation.party.findIndex((member) => !member.isEgg && knowledge.canLearnMachine(member.speciesId, plan.learner))
      : observation.party.findIndex((member) => !member.isEgg);
    if (learner < 0) {
      anomaly(`no party member can learn ${plan.moveName}`, { party: partySummary(observation) });
      yield* holdFrames([], 300);
      return { arrived: false, reason: 'no-learner' };
    }
    const target = observation.party[learner];
    const result = yield* teachFromPack(observe, {
      moveLabel: plan.moveLabel,
      partySlot: Math.max(learner, 0),
      targetName: target?.nickname || target?.speciesName || null,
      partyNames: observation.party.map((member) => member.nickname || member.speciesName),
      chooseForget: (current) => chooseMoveToForget(current, knowledge),
      onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }),
    });
    yield* closeMenus(observe);
    const after = observe();
    const learned = after.party[learner]?.moves.some((move) => move.name === plan.moveName) ?? false;
    journal?.append({ type: 'teach', runId, sequence, move: plan.moveName, learner, target: target?.speciesName ?? null, learned, ...result, party: partySummary(after) });
    if (!learned) anomaly(`${plan.moveName} was not learned by ${target?.speciesName ?? 'slot ' + learner}`, { screen: after.screen.slice(12) });
    return { arrived: learned, reason: learned ? 'taught' : 'not-learned' };
  }

  /** Slots of the trainee and escort for the active training plan, or a plain boolean. */
  const trainingContext = (observation) => {
    if (activePlan?.kind !== 'train') return false;
    if (!activePlan.trainee) return true;
    const traineeSlot = observation.party.findIndex((member) => !member.isEgg && member.speciesId === activePlan.trainee.speciesId);
    if (traineeSlot < 0) return true;
    let escortSlot = activePlan.escort ? observation.party.findIndex((member) => !member.isEgg && member.hp > 0 && member.speciesId === activePlan.escort.speciesId) : -1;
    if (escortSlot < 0) {
      escortSlot = observation.party
        .map((member, slot) => ({ member, slot }))
        .filter(({ member, slot }) => slot !== traineeSlot && !member.isEgg && member.hp > 0)
        .sort((left, right) => right.member.level - left.member.level)[0]?.slot ?? -1;
    }
    return escortSlot < 0 ? true : { traineeSlot, escortSlot, trainee: activePlan.trainee.speciesName ?? null, targetLevel: activePlan.minimumLevel ?? null };
  };

  /** A battle member goes back in front when a carrier leads (a trainee demoted to utility after a catch, 2026-09-05). */
  function* restoreLead(observation, roles) {
    if (!roles) return;
    const slot = leadRestoreSlot(observation, roles);
    if (slot === null) return;
    const swap = yield* movePartyMemberToLead(observe, slot, { onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }) });
    journal?.append({ type: 'party-swap', runId, sequence, ...swap, reason: 'lead-restore', party: partySummary(observe()) });
  }

  /** Boxes one party member at the nearest Pokémon Center PC (WATER_HM_LEARNER_SLOT). */
  function* depositStep() {
    const observation = observe();
    const mapId = currentMapId(world, observation);
    if (!transitionDistances.has(mapId)) transitionDistances.set(mapId, mapTransitionDistances(world, mapId));
    const distances = transitionDistances.get(mapId);
    const center = healerCatalog
      .filter((healer) => healer.kind === 'pokemon-center' && distances.get(healer.mapId) !== undefined)
      .sort((left, right) => distances.get(left.mapId) - distances.get(right.mapId))[0] ?? null;
    if (!center) { anomaly('no reachable Pokémon Center for the PC'); yield* holdFrames([], 300); return { arrived: false, reason: 'no-center' }; }
    // Every Pokémon Center 1F keeps its PC (COLL_PC) at (9,1), used from the tile below.
    const travel = yield* travelTo({ ...travelOptions(), destination: { mapId: center.mapId, approach: { x: 9, y: 1 }, facings: ['up'] } });
    if (!travel.arrived) return travel;
    const arrived = observe();
    const starter = runProfile?.starter ?? starterOf(arrived);
    const members = starter
      ? classifyParty(arrived, { knowledge, starter, teamPlan: teamPlanVersion })
      : arrived.party.map((member, slot) => ({ ...member, slot, role: 'utility', spare: false }));
    const slot = depositCandidate(arrived, members);
    if (slot === null) { anomaly('no party member can be boxed', { party: partySummary(arrived) }); yield* holdFrames([], 300); return { arrived: false, reason: 'no-candidate' }; }
    yield* face(travel.face ?? 'up');
    const target = arrived.party[slot];
    const result = yield* depositPartyMember(observe, slot, {
      onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }),
      log: (entry) => { if (entry.event === 'deposit-fail') anomaly(`deposit failed: ${entry.message}`, { screen: entry.screen?.slice(0, 18) }); },
    });
    journal?.append({ type: 'deposit', runId, sequence, slot, species: target?.speciesName ?? null, ...result });
    return { arrived: true, reason: result.deposited ? 'deposited' : 'not-deposited' };
  }

  function* trainStep(plan) {
    let observation = observe();
    // Switch training: the trainee leads so every battle credits it.
    if (plan.trainee) {
      const slot = observation.party.findIndex((member) => !member.isEgg && member.speciesId === plan.trainee.speciesId);
      if (slot > 0 && observation.party[slot].hp > 0) {
        const swap = yield* movePartyMemberToLead(observe, slot, { onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }) });
        journal?.append({ type: 'party-swap', runId, sequence, ...swap, trainee: plan.trainee.speciesName ?? null, party: partySummary(observe()) });
        observation = observe();
      }
    }
    const mapId = currentMapId(world, observation);
    const [first, second] = plan.ground.tiles;
    const onGround = mapId === plan.ground.mapId && plan.ground.tiles.some((tile) => tile.x === observation.map.x && tile.y === observation.map.y);
    if (!onGround) {
      return yield* travelTo({ ...travelOptions(), destination: { mapId: plan.ground.mapId, x: first.x, y: first.y } });
    }
    const atFirst = observation.map.x === first.x && observation.map.y === first.y;
    const target = atFirst ? second : first;
    const direction = target.x > observation.map.x ? 'right' : target.x < observation.map.x ? 'left' : target.y > observation.map.y ? 'down' : 'up';
    const result = yield* walkSegment(observe, direction, 1);
    return { arrived: true, reason: result.reason };
  }

  function* healAt(point) {
    const travel = yield* travelTo({ ...travelOptions(), destination: { mapId: point.mapId, approach: point.approach } });
    if (!travel.arrived) return travel;
    if (travel.face) yield* face(travel.face);
    const settled = yield* interact(observe, { onPrompt: (answer, observation) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: observation.screen.slice(12) }) });
    const after = observe();
    const healed = after.party.every((member) => member.isEgg || member.hp === member.maxHp);
    journal?.append({ type: 'heal', runId, sequence, healed, party: partySummary(after), presses: settled.presses });
    if (!healed) anomaly('heal interaction did not restore the party', { party: partySummary(after) });
    return { arrived: true, healed };
  }

  function* recover(reason) {
    anomaly(`recovery: ${reason}`);
    const before = observe();
    if (startMenuVisible(before) || packVisible(before)) yield* closeMenus(observe, 8);
    yield* press('b');
    yield* press('b');
    yield* holdFrames([], 30);
    const observation = observe();
    if (observation.scriptRunning || observation.menu.items > 0) yield* advanceScript(observe);
    for (const direction of ['down', 'left', 'up', 'right']) {
      const result = yield* walkSegment(observe, direction, 1, { blockedFrames: 20 });
      if (result.completedSteps > 0 || result.reason !== 'blocked') break;
    }
  }

  function* play() {
    for (;;) {
      const observation = observe();
      campaign.noteMap(currentMapId(world, observation));

      if (observation.battle) {
        const training = trainingContext(observation);
        record({
          kind: 'battle', reason: `${observation.battle.mode.toLowerCase()}-battle`,
          winner: { advisor: 'battle', recommendation: { kind: 'battle', mode: observation.battle.mode, opponent: observation.battle.enemy.speciesName, level: observation.battle.enemy.level, training }, confidence: 0.9, constraints: ['no-run-from-trainers'], evidenceRefs: ['engine/battle/core.asm'] },
          action: { kind: 'battle-loop', reason: 'drive native battle menus until wBattleMode clears' },
        }, observation);
        try {
          const starter = runProfile?.starter ?? starterOf(observation);
          const roles = starter ? classifyParty(observation, { knowledge, starter, teamPlan: teamPlanVersion }).map((member) => member.role) : null;
          const result = yield* runBattle({
            observe, knowledge, training, roles,
            capture: captureContext(observation),
            chooseForget: (current) => chooseMoveToForget(current, knowledge),
            onDecision: (advice, current) => {
              lastAdvice = advice;
              journal?.append({ type: 'battle-turn', runId, sequence, recommendation: advice.recommendation, enemy: `${current.battle.enemy.speciesName} L${current.battle.enemy.level} ${current.battle.enemy.hp}/${current.battle.enemy.maxHp}`, active: `${current.battle.player.speciesName} ${current.battle.player.hp}/${current.battle.player.maxHp}` });
            },
            onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }),
          });
          journal?.append({ type: 'battle-result', runId, sequence, ...result, party: partySummary(observe()) });
        } catch (error) {
          anomaly(`battle loop failed: ${error.message}`, { screen: observe().screen.slice(8) });
          yield* press('b');
          yield* press('b');
          yield* holdFrames([], 30);
        }
        continue;
      }

      if (yield* scriptPersists(observe)) {
        record({
          kind: 'dialog', reason: 'script-running',
          winner: { advisor: 'dialog', recommendation: { kind: 'advance-script' }, confidence: 0.7, constraints: [], evidenceRefs: ['wScriptRunning'] },
          action: { kind: 'press-a', reason: 'acknowledge text and answer prompts' },
        }, observation);
        yield* advanceScript(observe, { onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }) });
        continue;
      }

      const signature = signatureOf(observation);
      if (signature === watchdog.signature) {
        watchdog.repeats += 1;
        if (watchdog.repeats >= stallDecisions * 2) {
          diagnostics?.noteAnomaly('no cartridge progress across decisions', { repeats: watchdog.repeats, signature }, { observation, decision: lastDecision, playerState: playerState(), sequence, kind: 'stall' });
          throw new PlayerStallError('no cartridge progress across decisions', { repeats: watchdog.repeats, signature });
        }
        if (watchdog.repeats % stallDecisions === 0) {
          record({ kind: 'recovery', reason: 'stalled-signature', winner: { advisor: 'recovery', recommendation: { kind: 'recover', repeats: watchdog.repeats }, confidence: 0.5, constraints: [], evidenceRefs: [] }, action: { kind: 'cancel-and-step', reason: 'break a stationary loop' } }, observation);
          yield* recover('stalled signature');
          continue;
        }
      } else {
        watchdog.signature = signature;
        watchdog.repeats = 0;
      }

      // Game options first (reform P0-3): FAST text, no battle animations,
      // SHIFT style, no menu descriptions. Checked on every decision so a
      // resumed run or a stale save is corrected; capped so a failure cannot loop.
      if (!optionsSatisfied(observation) && optionsAttempts < 3) {
        optionsAttempts += 1;
        record({
          kind: 'options', reason: `set game options ${JSON.stringify(DESIRED_OPTIONS)} (currently ${JSON.stringify({ ...currentOptions(observation), raw: undefined })})`,
          winner: { advisor: 'options', recommendation: { kind: 'options', desired: DESIRED_OPTIONS, attempt: optionsAttempts }, confidence: 1, constraints: ['overworld-only'], evidenceRefs: ['engine/menus/options_menu.asm', 'constants/ram_constants.asm'] },
          action: { kind: 'start-menu-option', reason: 'START → OPTION, Right until each row matches, CANCEL' },
        }, observation);
        try {
          const result = yield* ensureGameOptions(observe, { onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }) });
          journal?.append({ type: 'options', runId, sequence, ...result });
        } catch (error) {
          if (error instanceof PlayerStallError) throw error;
          anomaly(`options failed: ${error.message}`, { attempt: optionsAttempts });
          yield* recover(error.message);
        }
        continue;
      }

      const hasEvent = hasEventFor(observation);
      const mapId = currentMapId(world, observation);
      let plan;
      let advisor;
      let objectiveId = null;
      const starterNow = runProfile?.starter ?? starterOf(observation);
      const roles = starterNow ? classifyParty(observation, { knowledge, starter: starterNow, teamPlan: teamPlanVersion }).map((member) => member.role) : null;
      if (!transitionDistances.has(mapId)) transitionDistances.set(mapId, mapTransitionDistances(world, mapId));
      const heal = healDecision(observation, { world, currentMapId: mapId, healers: healerCatalog, distances: transitionDistances.get(mapId), roles });
      const shopping = heal ? null : shoppingPlan(observation, {
        knowledge, world, mapId, distances: transitionDistances.get(mapId), roles, hasEvent,
        contract: campaign.nextContract?.(observation, hasEvent) ?? null,
        captureTargets: captureContext(observation)?.targets ?? new Set(),
      });
      if (heal) {
        plan = { kind: 'heal', point: heal.healer, reason: heal.reason, urgent: heal.urgent, distance: heal.distance };
        advisor = 'recovery';
      } else if (shopping && !shoppingCooldown.has(shopping.mart.mapId)) {
        plan = { kind: 'shop', point: { mapId: shopping.mart.mapId }, orders: shopping.orders.map((order) => ({ item: order.item, quantity: order.quantity, clerk: order.clerk })), total: shopping.total, reason: shopping.reason };
        advisor = 'supply';
      } else {
        const next = campaign.next(observation, hasEvent);
        if (!next) {
          // Nothing left to do: idle without counting toward the stall watchdog,
          // and record the idle decision only once per idle stretch.
          if (lastDecision?.kind !== 'idle') {
            record({ kind: 'idle', reason: 'no-objective', winner: { advisor: 'campaign', recommendation: { kind: 'idle' }, confidence: 1, constraints: [], evidenceRefs: [] }, action: { kind: 'wait', reason: 'campaign complete or undefined beyond this point' } }, observation);
          }
          watchdog.signature = null;
          watchdog.repeats = 0;
          yield* holdFrames([], 600);
          continue;
        }
        plan = next.plan;
        objectiveId = next.objective.id;
        advisor = plan.kind === 'train' ? 'training' : plan.kind === 'capture' ? 'capture' : 'campaign';
      }
      activePlan = plan;
      record({
        kind: plan.kind, reason: plan.reason,
        winner: { advisor, recommendation: { kind: plan.kind, objective: objectiveId, destination: plan.destination ?? (plan.ground ? { mapId: plan.ground.mapId } : plan.point ? { mapId: plan.point.mapId } : null), interact: plan.interact ?? null, minimumLevel: plan.minimumLevel ?? null }, confidence: 0.8, constraints: [], evidenceRefs: objectiveId ? [objectiveId] : [] },
        action: { kind: { travel: 'route-lease', train: 'grass-pace', capture: 'grass-pace', heal: 'heal-visit', herd: 'herd-step', teach: 'pack-teach', shop: 'mart-buy', deposit: 'pc-deposit' }[plan.kind] ?? plan.kind, reason: plan.reason },
      }, observation);
      try {
        if (plan.kind !== 'train') yield* restoreLead(observation, roles);
        if (plan.kind === 'capture') {
          yield* trainStep(plan);
        } else if (plan.kind === 'travel') {
          const travel = yield* travelTo({ ...travelOptions(), destination: plan.destination });
          if (travel.reason === 'target-absent') anomaly(`travel target ${travel.missing} is not visible under the current event flags`, { objective: objectiveId });
          if (travel.arrived && plan.interact) {
            const direction = plan.interact === 'approach' ? travel.face : plan.interact;
            if (direction) yield* face(direction);
            yield* interact(observe, { onPrompt: (answer, current) => journal?.append({ type: 'prompt', runId, sequence, answer, screen: current.screen.slice(12) }) });
          }
        } else if (plan.kind === 'train') {
          yield* trainStep(plan);
        } else if (plan.kind === 'heal') {
          yield* healAt(plan.point);
        } else if (plan.kind === 'herd') {
          yield* herdStep(plan);
        } else if (plan.kind === 'teach') {
          yield* teachStep(plan);
        } else if (plan.kind === 'shop') {
          const result = yield* shopAt(plan.point, plan.orders);
          if (!result.bought?.length) shoppingCooldown.add(plan.point.mapId);
        } else if (plan.kind === 'deposit') {
          yield* depositStep(plan);
        }
      } catch (error) {
        if (error instanceof PlayerStallError) throw error;
        anomaly(`${plan.kind} failed: ${error.message}`, { detail: error.detail ?? null });
        yield* recover(error.message);
      }
    }
  }

  return Object.freeze({
    play,
    sequence: () => sequence,
    lastDecision: () => lastDecision,
    lastAdvice: () => lastAdvice,
    activePlan: () => activePlan,
    playerState,
    campaignStatus: (observation) => campaign.status(observation, hasEventFor(observation)),
    resetWatchdog: () => { watchdog.signature = null; watchdog.repeats = 0; },
  });
}
