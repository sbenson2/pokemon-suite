// The FRLG family (build 124). pret/pokefirered builds FireRed and LeafGreen
// from one source; their RAM layout, maps, scripts and battle data are the
// same, so one engine plays both: the same observer, story planner and
// campaign. Only the verified image, its knowledge pack (built symbols and wild
// tables), the roster identity and the Oak's-speech name presets differ.
// FireRed-only features (the reviewed peer-trade cartridge, trade partners,
// postgame, hunts) keep their own `game === 'firered'` checks.
const freeze = Object.freeze;

export const FRLG_GAMES = freeze({
  firered: freeze({
    game: "firered",
    title: "FireRed",
    cartridgeProfileId: "firered-rev1-stock",
    configCartridgeId: "firered-rev1",
    sha1: "dd5945db9b930750cb39d00c84da8571feebf417",
    bytes: 16_777_216,
    gameCode: "BPRE",
  }),
  leafgreen: freeze({
    game: "leafgreen",
    title: "LeafGreen",
    cartridgeProfileId: "leafgreen-rev1-stock",
    configCartridgeId: "leafgreen-rev1",
    sha1: "7862c67bdecbe21d1d69ce082ce34327e1c6ed5e",
    bytes: 16_777_216,
    gameCode: "BPGE",
  }),
});

export const isFrlgGame = (game) =>
  typeof game === "string" && Object.hasOwn(FRLG_GAMES, game);

export function frlgGame(game = "firered") {
  if (!isFrlgGame(game)) throw new TypeError("choose FireRed or LeafGreen");
  return FRLG_GAMES[game];
}

export function frlgGameForSha1(sha1) {
  return Object.values(FRLG_GAMES).find((entry) => entry.sha1 === sha1) ?? null;
}

// A knowledge pack keeps only its own version's wild tables (labels ending
// _FireRed or _LeafGreen), so matching either suffix selects exactly them.
export const FRLG_ENCOUNTER_TABLE = /_(?:FireRed|LeafGreen)$/;
