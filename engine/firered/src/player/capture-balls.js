const MASTER_BALL_ITEM_ID = 1;
const SAFARI_BALL_ITEM_ID = 5;
const WATER_TYPE_ID = 11;
const BUG_TYPE_ID = 6;

export const PURCHASABLE_CAPTURE_BALL_IDS = Object.freeze([
  2,
  3,
  4,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
]);

export const CAPTURE_BALL_UNIT_PRICES = Object.freeze({
  2: 1200,
  3: 600,
  4: 200,
  6: 1000,
  7: 1000,
  8: 1000,
  9: 1000,
  10: 1000,
  11: 1000,
  12: 200,
});

const BALL_TIE_ORDER = new Map(
  PURCHASABLE_CAPTURE_BALL_IDS.map((itemId, index) => [itemId, index]),
);

function dataOf(document) {
  return document?.data ?? document ?? {};
}

function indexed(collection, id) {
  if (Array.isArray(collection)) {
    return collection.find((entry) => Number(entry?.id) === Number(id)) ?? null;
  }
  return collection?.[id] ?? collection?.[String(id)] ?? null;
}

function opponentTypes(opponent, mechanics) {
  if (Array.isArray(opponent?.types) && opponent.types.length > 0) {
    return opponent.types;
  }
  const species = indexed(
    dataOf(mechanics).species,
    Number(opponent?.species),
  );
  if (Array.isArray(species?.types)) return species.types;
  return [species?.type1, species?.type2].filter((type) => type !== undefined);
}

function hasType(types, name, id) {
  return types.some((type) =>
    Number(type) === id || String(type).toUpperCase() === name
  );
}

function speciesIsOwned(ownedSpecies, species) {
  return (ownedSpecies ?? []).some((owned) =>
    Number(owned) === Number(species)
  );
}

export function captureBallMultiplier({
  itemId,
  opponent,
  mechanics = {},
  ownedSpecies = [],
  mapType = null,
  turn = 0,
} = {}) {
  const ball = Number(itemId);
  if (ball === MASTER_BALL_ITEM_ID) return Number.POSITIVE_INFINITY;
  if (ball === 2) return 20;
  if (ball === 3 || ball === SAFARI_BALL_ITEM_ID) return 15;
  if (ball === 4 || ball === 11 || ball === 12) return 10;
  if (!PURCHASABLE_CAPTURE_BALL_IDS.includes(ball)) return 0;

  const types = opponentTypes(opponent, mechanics);
  if (ball === 6) {
    return hasType(types, "TYPE_WATER", WATER_TYPE_ID) ||
        hasType(types, "TYPE_BUG", BUG_TYPE_ID)
      ? 30
      : 10;
  }
  if (ball === 7) {
    return mapType === "MAP_TYPE_UNDERWATER" ? 35 : 10;
  }
  if (ball === 8) {
    const level = Number(opponent?.level);
    return Number.isSafeInteger(level) && level > 0 && level < 40
      ? Math.max(10, 40 - level)
      : 10;
  }
  if (ball === 9) {
    return speciesIsOwned(ownedSpecies, opponent?.species) ? 30 : 10;
  }
  if (ball === 10) {
    const battleTurn = Number.isFinite(Number(turn))
      ? Math.max(0, Number(turn))
      : 0;
    return Math.min(40, battleTurn + 10);
  }
  return 10;
}

function compareRankedBalls(left, right) {
  return right.multiplier - left.multiplier ||
    (BALL_TIE_ORDER.get(left.itemId) ?? Number.MAX_SAFE_INTEGER) -
      (BALL_TIE_ORDER.get(right.itemId) ?? Number.MAX_SAFE_INTEGER) ||
    left.index - right.index;
}

export function selectBestCaptureBall({
  balls = [],
  opponent,
  mechanics = {},
  ownedSpecies = [],
  mapType = null,
  turn = 0,
} = {}) {
  return balls
    .map((entry, index) => ({
      itemId: Number(entry.itemId),
      quantity: Number(entry.quantity ?? 0),
      index,
      multiplier: captureBallMultiplier({
        itemId: entry.itemId,
        opponent,
        mechanics,
        ownedSpecies,
        mapType,
        turn,
      }),
    }))
    .filter(({ itemId, quantity, multiplier }) =>
      itemId !== MASTER_BALL_ITEM_ID &&
      itemId !== SAFARI_BALL_ITEM_ID &&
      quantity > 0 &&
      multiplier > 0
    )
    .sort(compareRankedBalls)[0] ?? null;
}

function objectiveBallScore({
  itemId,
  opponents,
  mechanics,
  ownedSpecies,
  mapType,
  turn,
}) {
  return Math.min(...opponents.map((opponent) => captureBallMultiplier({
    itemId,
    opponent,
    mechanics,
    ownedSpecies,
    mapType,
    turn,
  })));
}

export function planCaptureBallPortfolio({
  stock = [],
  targetCount,
  opponents = [],
  mechanics = {},
  ownedSpecies = [],
  mapType = null,
} = {}) {
  const desired = Math.max(0, Math.floor(Number(targetCount) || 0));
  if (desired === 0) return Object.freeze([]);
  const targets = opponents.length > 0 ? opponents : [{ species: null }];
  const seen = new Set();
  const ranked = stock.flatMap((entry) => {
    const itemId = Number(entry.itemId);
    const unitPrice = CAPTURE_BALL_UNIT_PRICES[itemId];
    if (
      seen.has(itemId) ||
      !PURCHASABLE_CAPTURE_BALL_IDS.includes(itemId) ||
      !Number.isSafeInteger(unitPrice)
    ) return [];
    seen.add(itemId);
    return [{
      itemId,
      stockIndex: Number(entry.stockIndex),
      unitPrice,
      immediateMultiplier: objectiveBallScore({
        itemId,
        opponents: targets,
        mechanics,
        ownedSpecies,
        mapType,
        turn: 0,
      }),
      peakMultiplier: objectiveBallScore({
        itemId,
        opponents: targets,
        mechanics,
        ownedSpecies,
        mapType,
        turn: 30,
      }),
    }];
  }).sort((left, right) =>
    right.immediateMultiplier - left.immediateMultiplier ||
    right.peakMultiplier - left.peakMultiplier ||
    (BALL_TIE_ORDER.get(left.itemId) ?? Number.MAX_SAFE_INTEGER) -
      (BALL_TIE_ORDER.get(right.itemId) ?? Number.MAX_SAFE_INTEGER) ||
    left.stockIndex - right.stockIndex
  );
  const primary = ranked[0];
  if (!primary) return Object.freeze([]);
  const selected = [
    primary,
    ...ranked.slice(1).filter((candidate) =>
      candidate.immediateMultiplier >= 15 ||
      candidate.peakMultiplier > primary.immediateMultiplier
    ).slice(0, 2),
  ];
  const primaryQuantity = selected.length === 1
    ? desired
    : Math.ceil(desired * 2 / 3);
  let remainder = desired - primaryQuantity;
  const result = selected.map((entry, index) => {
    let quantity = primaryQuantity;
    if (index > 0) {
      const entriesLeft = selected.length - index;
      quantity = Math.ceil(remainder / entriesLeft);
      remainder -= quantity;
    }
    return Object.freeze({ ...entry, quantity });
  }).filter(({ quantity }) => quantity > 0);
  return Object.freeze(result);
}
