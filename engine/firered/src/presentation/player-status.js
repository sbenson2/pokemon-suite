const KANTO_BADGES = Object.freeze([
  Object.freeze({ id: "boulder", label: "Boulder", flagId: 2080 }),
  Object.freeze({ id: "cascade", label: "Cascade", flagId: 2081 }),
  Object.freeze({ id: "thunder", label: "Thunder", flagId: 2082 }),
  Object.freeze({ id: "rainbow", label: "Rainbow", flagId: 2083 }),
  Object.freeze({ id: "soul", label: "Soul", flagId: 2084 }),
  Object.freeze({ id: "marsh", label: "Marsh", flagId: 2085 }),
  Object.freeze({ id: "volcano", label: "Volcano", flagId: 2086 }),
  Object.freeze({ id: "earth", label: "Earth", flagId: 2087 }),
]);

const speciesIndexes = new WeakMap();

function finite(value) {
  if(value===null||value===undefined||value==='')return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function titleCaseIdentifier(value, prefix) {
  const source = String(value ?? "").replace(prefix, "")
    .replace(/([A-Z]+)(\d+)/gu, "$1 $2")
    .replace(/_/gu, " ")
    .trim();
  if (!source) return "Unknown";
  return source.split(/\s+/u).map((part) => {
    if (/^[B]?\d+F$/u.test(part)) return part;
    if (part === "SS") return "S.S.";
    return `${part[0]}${part.slice(1).toLowerCase()}`;
  }).join(" ");
}

function speciesIndex(mechanicsDocument) {
  if (!mechanicsDocument || typeof mechanicsDocument !== "object") return new Map();
  const cached = speciesIndexes.get(mechanicsDocument);
  if (cached) return cached;
  const mechanics = mechanicsDocument.data ?? mechanicsDocument;
  const species = Array.isArray(mechanics.species)
    ? mechanics.species
    : Object.values(mechanics.species ?? {});
  const index = new Map(species.map((entry) => [Number(entry.id), entry]));
  speciesIndexes.set(mechanicsDocument, index);
  return index;
}

function genderFor(trainer) {
  // The observer publishes BOY/GIRL; legacy observations used the native byte.
  // A run's intended character must never override the loaded save's evidence.
  const gender = trainer?.gender;
  if (gender === "GIRL" || gender === 1) return "GIRL";
  if (gender === "BOY" || gender === 0) return "BOY";
  return null;
}

function partyStatus(pokemon) {
  if (Number(pokemon?.hp) === 0 && Number(pokemon?.maxHp) > 0) return "FNT";
  const status = Number(pokemon?.status1 ?? 0) >>> 0;
  if ((status & 0x07) !== 0) return "SLP";
  if ((status & 0x08) !== 0) return "PSN";
  if ((status & 0x10) !== 0) return "BRN";
  if ((status & 0x20) !== 0) return "FRZ";
  if ((status & 0x40) !== 0) return "PAR";
  return "OK";
}

function activeStoryGoal(decision, campaignStatus = null) {
  const recommendation = decision?.winner?.recommendation ?? {};
  return String(
    campaignStatus?.activeObjective?.id ?? recommendation.objective ??
      recommendation.goal ?? recommendation.id ?? recommendation.kind ??
      "Awaiting campaign state",
  );
}

function currentDecision(decision) {
  if (!decision || typeof decision !== "object") return null;
  const winner = decision.winner ?? null;
  return {
    sequence: finite(decision.sequence),
    kind: String(decision.kind ?? "unknown"),
    reason: String(decision.reason ?? "unknown"),
    advisor: winner?.advisor ? String(winner.advisor) : null,
    recommendation: winner?.recommendation
      ? { ...winner.recommendation }
      : null,
    action: decision.action
      ? {
          kind: String(decision.action.kind ?? "unknown"),
          reason: String(decision.action.reason ?? "unknown"),
        }
      : null,
    confidence: finite(winner?.confidence),
    constraints: Array.isArray(winner?.constraints)
      ? [...winner.constraints]
      : [],
    evidenceRefs: Array.isArray(winner?.evidenceRefs)
      ? [...winner.evidenceRefs]
      : [],
  };
}

export function createSpectatorStatus({
  observation,
  runProfile = null,
  mechanics = null,
  collectionProgress = null,
  decision = null,
  campaignStatus = null,
} = {}) {
  const memory = observation?.playerMemory ?? {};
  const trainer = memory.trainer ?? {};
  const pokedex = trainer.pokedex ?? {};
  const map = memory.map ?? {};
  const position = memory.position ?? {};
  const flags = memory.storyState?.flagIds ?? {};
  const names = speciesIndex(mechanics);
  const describePokemon = pokemon => ({
    name:titleCaseIdentifier(names.get(Number(pokemon.species))?.name ?? `SPECIES_${pokemon.species ?? 'UNKNOWN'}`,/^SPECIES_/u),
    species:pokemon.species, ...(pokemon.nationalSpecies ? {speciesId:pokemon.nationalSpecies} : {}),
    slot:pokemon.slot ?? null, level:finite(pokemon.level), hp:finite(pokemon.hp),maxHp:finite(pokemon.maxHp),status:partyStatus(pokemon),
    ...(pokemon.experienceProgress?.remaining != null ? {experienceRemaining:finite(pokemon.experienceProgress.remaining)} : {}),
  });
  const task=campaignStatus?.activeTask;
  const assigned=task?.kind==='training'&&trainer.partyValidity==='valid'
    ? (trainer.party??[]).filter(p=>Number.isSafeInteger(p.otId)&&Number.isSafeInteger(p.personality)&&JSON.stringify([p.otId,p.personality])===task.member) : [];
  const training=assigned.length===1 ? {pokemon:describePokemon(assigned[0]),nextLevel:task.minimumLevel,targetLevel:task.targetLevel,rotation:task.rotation??null} : null;
  const battle=observation?.phase==='stable'&&observation?.emulator?.inBattle&&memory.battle?.player&&memory.battle?.opponent
    ? {player:describePokemon(memory.battle.player),opponent:describePokemon(memory.battle.opponent)} : null;
  const owned = finite(pokedex.ownedCount) ?? 0;
  const seen = finite(pokedex.seenCount) ?? 0;
  const badges = KANTO_BADGES.map(({ id, label, flagId }) => ({
    id,
    label,
    earned: flags[flagId] === true || flags[String(flagId)] === true,
  }));
  return {
    map: {
      name: titleCaseIdentifier(map.id, /^MAP_/u),
      region: "Kanto",
      group: finite(map.group),
      number: finite(map.number),
      x: finite(position.x),
      y: finite(position.y),
      ...(memory.townMap ? {townMap:{...memory.townMap}} : {}),
    },
    trainer: {
      name: String(trainer.playerName ?? runProfile?.playerName ?? "RED"),
      gender: genderFor(trainer),
      id: trainer.trainerId ?? trainer.id ?? null,
      money: finite(trainer.money) ?? 0,
      playTime: trainer.playTime ?? null,
      pokedex: { owned, seen },
    },
    party: (Array.isArray(trainer.party) ? trainer.party : []).slice(0, 6).map((pokemon, index) => ({
      lead: index === 0,
      slot: pokemon.slot ?? index,
      ...(pokemon.heldItem !== undefined ? {heldItem:pokemon.heldItem} : {}),
      ...(typeof pokemon.shiny === 'boolean' ? {shiny:pokemon.shiny} : {}),
      ...(pokemon.experienceProgress ? {experience:pokemon.experienceProgress} : {}),
      ...(pokemon.nationalSpecies ? {speciesId:pokemon.nationalSpecies,sprite:`./assets/pokedex/firered/${pokemon.shiny?'shiny/':''}${pokemon.nationalSpecies}.png`} : {}),
      speciesName: titleCaseIdentifier(
        names.get(Number(pokemon.species))?.name ?? `SPECIES_${pokemon.species ?? "UNKNOWN"}`,
        /^SPECIES_/u,
      ),
      level: finite(pokemon.level) ?? 0,
      hp: finite(pokemon.hp) ?? 0,
      maxHp: finite(pokemon.maxHp) ?? 0,
      status: partyStatus(pokemon),
    })),
    badges,
    progress: {
      maps: finite(collectionProgress?.provenMaps) ?? 0,
      targetMaps: 389,
      species: owned,
      targetSpecies: flags[2112] === true ? 386 : 151,
      ...(memory.gameStats ?? {}),
      leagueComplete: typeof flags[2092] === 'boolean' ? flags[2092] : null,
      story: badges.filter(({ earned }) => earned).length,
    },
    strategy: {
      activeStoryGoal: activeStoryGoal(decision, campaignStatus),
      ...(training ? {training} : {}),
      ...(battle ? {battle} : {}),
      ...(campaignStatus ? { campaign: structuredClone(campaignStatus) } : {}),
      ...(decision ? { decision: currentDecision(decision) } : {}),
    },
  };
}
