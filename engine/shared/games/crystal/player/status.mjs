// Status projection for AgentTV. The shape mirrors what the visualizer's
// external_mgba_status.cjs projects (runId, decisions, frame, phase, mode, map,
// position, winner, decision, spectator) so the Crystal channel drives the same
// panels as the FireRed research player.

import { currentOptions, optionsSatisfied } from './options.mjs';

const JOHTO_BADGES = Object.freeze([
  ['zephyr', 'Zephyr', 'ZEPHYR'], ['hive', 'Hive', 'HIVE'], ['plain', 'Plain', 'PLAIN'], ['fog', 'Fog', 'FOG'],
  ['mineral', 'Mineral', 'MINERAL'], ['storm', 'Storm', 'STORM'], ['glacier', 'Glacier', 'GLACIER'], ['rising', 'Rising', 'RISING'],
]);

const titleCase = (value) => String(value ?? '').split('_').filter(Boolean)
  .map((part) => (/^[B]?\d+F$/.test(part) ? part : part[0] + part.slice(1).toLowerCase())).join(' ');

export function createCrystalStatus({
  observation,
  world,
  runId,
  runProfile = null,
  decision = null,
  campaign = null,
  emulation = null,
  complete = false,
  startedAt = null,
} = {}) {
  const mapId = observation ? world?.idOf(observation.map.group, observation.map.number) ?? null : null;
  const winner = decision?.winner ?? null;
  const mode = !observation ? 'boot' : observation.battle ? 'battle' : observation.scriptRunning ? 'script' : 'overworld';
  const badges = JOHTO_BADGES.map(([id, label, key]) => ({ id, label, earned: observation?.trainer.badges.includes(key) === true }));
  return {
    schema: 'pokemon-research/crystal-status/v1',
    game: { id: 'pokemon-crystal', title: 'Pokémon Crystal', generation: 2, region: 'Johto', platform: 'gbc' },
    runId,
    complete,
    decisions: Number(decision?.sequence ?? 0),
    frame: observation?.frame ?? null,
    phase: complete ? 'hall-of-fame-complete' : observation ? 'streaming' : 'starting',
    mode,
    callback2: mode,
    map: mapId ? `MAP_${mapId}` : null,
    position: observation ? { x: observation.map.x, y: observation.map.y } : null,
    facing: observation?.facing ?? null,
    updatedAt: new Date().toISOString(),
    startedAt,
    emulation,
    runProfile,
    winner,
    action: decision?.action ?? null,
    decision: decision ? {
      sequence: decision.sequence,
      kind: decision.kind,
      reason: decision.reason,
      advisor: winner?.advisor ?? null,
      recommendation: winner?.recommendation ?? null,
      action: decision.action ?? null,
      confidence: winner?.confidence ?? null,
      constraints: winner?.constraints ?? [],
      evidenceRefs: winner?.evidenceRefs ?? [],
    } : null,
    control: { mode: 'bot', manualButtons: [], manualSessionCount: 0 },
    spectator: observation ? {
      map: {
        name: mapId ? titleCase(mapId) : `Map ${observation.map.group}/${observation.map.number}`,
        region: 'Johto',
        group: observation.map.group,
        number: observation.map.number,
        x: observation.map.x,
        y: observation.map.y,
      },
      trainer: {
        name: observation.trainer.name || runProfile?.playerName || 'KRIS',
        gender: observation.trainer.gender,
        id: observation.trainer.id,
        money: observation.trainer.money,
        playTime: { ...observation.trainer.playTime, vblanks: 0 },
        pokedex: { owned: observation.trainer.pokedexCaught, seen: observation.trainer.pokedexSeen },
      },
      clock: observation.clock ? { ...observation.clock, timeOfDay: observation.timeOfDay, momSaving: observation.mom?.saving ?? false, momsMoney: observation.mom?.money ?? 0 } : null,
      options: (() => { const { raw, ...rest } = currentOptions(observation); return { ...rest, satisfied: optionsSatisfied(observation) }; })(),
      party: observation.party.map((pokemon, index) => ({
        lead: index === 0,
        speciesName: titleCase(pokemon.speciesName),
        nickname: pokemon.nickname,
        level: pokemon.level,
        hp: pokemon.hp,
        maxHp: pokemon.maxHp,
        status: pokemon.isEgg ? 'EGG' : pokemon.hp === 0 ? 'FNT' : pokemon.status,
        moves: pokemon.moves.map((move) => ({ name: titleCase(move.name), pp: move.pp })),
      })),
      badges,
      battle: observation.battle ? {
        mode: observation.battle.mode,
        opponent: {
          speciesName: titleCase(observation.battle.enemy.speciesName),
          level: observation.battle.enemy.level,
          hp: observation.battle.enemy.hp,
          maxHp: observation.battle.enemy.maxHp,
          types: observation.battle.enemy.types,
        },
        active: {
          speciesName: titleCase(observation.battle.player.speciesName),
          level: observation.battle.player.level,
          hp: observation.battle.player.hp,
          maxHp: observation.battle.player.maxHp,
        },
        trainer: observation.battle.trainer,
      } : null,
      progress: {
        maps: campaign?.visitedMaps ?? 0,
        targetMaps: world?.mapIds.length ?? 388,
        species: observation.trainer.pokedexCaught,
        targetSpecies: 251,
        story: badges.filter(({ earned }) => earned).length,
      },
      strategy: {
        activeStoryGoal: campaign?.activeObjective?.id ?? winner?.recommendation?.kind ?? 'Awaiting campaign state',
        ...(campaign ? { campaign } : {}),
        ...(decision ? { decision: { kind: decision.kind, reason: decision.reason, advisor: winner?.advisor ?? null } } : {}),
      },
      screen: observation.screen,
    } : null,
  };
}
