// AgentTV status projection for the Emerald player. The shape mirrors the
// Master Red player status consumed by AgentLand-visualizer's
// external_mgba_status.cjs projection (runId, decisions, frame, mode, map,
// position, winner, decision, spectator, game).
const HOENN_BADGES = Object.freeze([
  ['stone', 'Stone', 'FLAG_BADGE01_GET'], ['knuckle', 'Knuckle', 'FLAG_BADGE02_GET'], ['dynamo', 'Dynamo', 'FLAG_BADGE03_GET'], ['heat', 'Heat', 'FLAG_BADGE04_GET'],
  ['balance', 'Balance', 'FLAG_BADGE05_GET'], ['feather', 'Feather', 'FLAG_BADGE06_GET'], ['mind', 'Mind', 'FLAG_BADGE07_GET'], ['rain', 'Rain', 'FLAG_BADGE08_GET'],
]);

export const EMERALD_GAME = Object.freeze({ id: 'pokemon-emerald', title: 'Pokémon Emerald', generation: 3, region: 'Hoenn', platform: 'gba' });

function titleCase(value) {
  return String(value ?? '').replace(/^MAP_/, '').split('_').map(part => part ? part[0] + part.slice(1).toLowerCase() : part).join(' ').replace(/(\d+)f\b/gi, '$1F');
}

function partyStatus(member) {
  if (member.hp === 0 && member.maxHp > 0) return 'FNT';
  const status = member.status >>> 0;
  if ((status & 0x07) !== 0) return 'SLP';
  if ((status & 0x08) !== 0) return 'PSN';
  if ((status & 0x10) !== 0) return 'BRN';
  if ((status & 0x20) !== 0) return 'FRZ';
  if ((status & 0x40) !== 0) return 'PAR';
  return 'OK';
}

export function createSpectatorStatus({ observation, runProfile = {}, campaignStatus, decision, tables = null }) {
  const player = observation?.player ?? null;
  const female = (player?.gender ?? runProfile.gender) === 'FEMALE';
  const badges = HOENN_BADGES.map(([id, label, flag]) => ({ id, label, earned: observation ? observation.flag(flag) : false }));
  return {
    map: { name: titleCase(player?.map.id ?? 'unknown'), region: 'Hoenn', group: player?.map.group ?? null, number: player?.map.number ?? null, x: player?.position.x ?? null, y: player?.position.y ?? null },
    trainer: { name: player?.name || runProfile.playerName || 'EMERALD', gender: female ? 'GIRL' : 'BOY', portrait: `./assets/emerald/ui/${female ? 'may' : 'brendan'}-trainer.png`, id: player?.trainerId ?? null, money: player?.money ?? 0, playTime: player?.playTime ?? null, pokedex: { owned: player?.pokedex?.owned ?? 0, seen: player?.pokedex?.seen ?? 0 } },
    party: (observation?.party ?? []).filter(member => member.validity !== 'invalid').slice(0, 6).map((member, index) => {
      const speciesId = member.speciesId ?? tables?.nationalSpecies(member.species) ?? (member.species <= 251 ? member.species : null);
      const base = tables?.experienceAtLevel(member.species, member.level), next = member.level < 100 ? tables?.experienceAtLevel(member.species, member.level + 1) : null;
      return {lead:index === 0, slot:member.slot??index, heldItem:member.heldItem??null, speciesId, shiny:Boolean(member.shiny), isEgg:Boolean(member.isEgg), speciesName:member.isEgg ? 'Egg' : titleCase(member.speciesName ?? `#${member.species}`), level:member.level, hp:member.hp, maxHp:member.maxHp, status:partyStatus(member),
        sprite:speciesId && !member.isEgg ? `./assets/pokedex/emerald/${member.shiny ? 'shiny/' : ''}${speciesId}.png` : './assets/pokemon/ui/pokemon-neutral.svg',
        ...(Number.isFinite(next) && Number.isFinite(base) && Number.isFinite(member.experience) ? {experience:{remaining:Math.max(0,next-member.experience),ratio:Math.max(0,Math.min(1,(member.experience-base)/(next-base)))}} : {})};
    }),
    badges,
    progress: { ...(player?.gameStats??{}),leagueComplete:player?.map?.id ? observation.flag('FLAG_SYS_GAME_CLEAR') : null, story: badges.filter(badge => badge.earned).length, objectives: campaignStatus?.completed?.length ?? 0, targetObjectives: campaignStatus?.total ?? 0, species: player?.pokedex?.owned ?? 0, targetSpecies: observation?.flag?.('FLAG_SYS_NATIONAL_DEX') ? 386 : 202 },
    strategy: { activeStoryGoal: campaignStatus?.activeObjective?.id ?? decision?.recommendation?.kind ?? 'awaiting campaign state', campaign: campaignStatus ?? null, decision: decision ? { sequence: decision.sequence, kind: decision.recommendation?.kind ?? 'unknown', advisor: decision.advisor, recommendation: decision.recommendation ?? null, action: decision.action ?? null, confidence: decision.recommendation?.confidence ?? null } : null },
  };
}

export function createPlayerStatus({ runId, runProfile, observation, decision, decisions, frame, complete = false, campaignStatus = null, emulation = null, diagnostics = null, attempt = null }) {
  const recommendation = decision?.recommendation ?? null;
  return {
    schema: 'pokemon-research/emerald-player-status/v1',
    runId,
    game: EMERALD_GAME,
    running: !complete,
    complete,
    attempt,
    runProfile: { seed: runProfile.seed, gender: runProfile.gender, starter: runProfile.starter, playerName: observation?.player?.name ?? runProfile.playerName ?? null, tickets: runProfile.tickets },
    decisions,
    atomicCaptureRaces: 0,
    frame,
    phase: 'streaming',
    mode: observation?.emulator.mode ?? null,
    callback2: observation?.emulator.callback2Name ?? null,
    map: observation?.player?.map.id ?? null,
    position: observation?.player?.position ?? null,
    usablePartyCount: (observation?.party ?? []).filter(member => member.hp > 0 && !member.isEgg).length,
    winner: recommendation ? { advisor: decision.advisor, recommendation, confidence: recommendation.confidence ?? null, constraints: [], evidenceRefs: recommendation.evidenceRefs ?? [] } : null,
    decision: decision ? { sequence: decision.sequence, kind: recommendation?.kind ?? 'unknown', reason: decision.action?.reason ?? recommendation?.kind ?? 'unknown', objective: decision.objective ?? null } : null,
    action: decision?.action ?? null,
    campaign: campaignStatus,
    emulation,
    diagnostics,
    spectator: createSpectatorStatus({ observation, runProfile, campaignStatus, decision }),
    updatedAt: new Date().toISOString(),
  };
}
