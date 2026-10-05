import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readFireRedRosterFacts } from "../player/fire-red-roster-facts.js";
import { createFireRedRosterContext } from "../player/fire-red-roster.js";
import { frlgGame } from "../frlg.js";
import { resolveSuiteOwner, ownerNativePair } from "./suite-owner.js";

const json = path => JSON.parse(readFileSync(path,"utf8"));
const STOCK = "dd5945db9b930750cb39d00c84da8571feebf417";
const PEER = "85a259c7b7a74d4f2322e5b9f89d22a53dfd6fce";

export function selectCampaignCartridge(cfg, active) {
  // Profiles retain their adapter after the configured hunt changes. Match the
  // emulator owner's selection so preview and execution bind the same ROM.
  const native = active && (active.nativeRadio === true || cfg.nativeRadio?.huntId === active.id);
  return native ? cfg.nativeRadio?.cartridge ?? cfg.cartridge : cfg.cartridge;
}

// The cartridge a named FireRed owner's worker boots (session-worker.js): its
// own config and active hunt, and for a partner or helper its native link pair.
export function ownerCampaignCartridge(config, owner = "firered") {
  const { title, partner, helper, cfg, directory } = resolveSuiteOwner(config, owner);
  if (title !== "firered") throw new Error("Choose a FireRed owner for this FireRed campaign.");
  const pair = ownerNativePair(cfg, { partner, helper });
  if (pair) return pair.cartridge;
  const activePath = join(directory, "active-hunt.json");
  return selectCampaignCartridge(cfg, existsSync(activePath) ? json(activePath) : null);
}

// LeafGreen (build 124): the same story campaign on the verified LeafGreen
// cartridge, with its own knowledge pack and roster facts. It has no reviewed
// peer-trade adapter, so its campaign always binds the stock image.
function loadLeafGreenCampaignContext(config) {
  const cfg = config.games?.leafgreen, { sha1, cartridgeProfileId } = frlgGame("leafgreen");
  if (!cfg?.inputs || cfg.cartridge?.sha1 !== sha1) throw new Error("Configure the verified LeafGreen campaign cartridge and game data first.");
  const inputs = Object.fromEntries(["runtime","world","story","battle"].map(key => [key,json(cfg.inputs[key])]));
  const facts = readFireRedRosterFacts({ romBytes: readFileSync(cfg.cartridge.path),
    cartridge: { ...cfg.cartridge, id: cartridgeProfileId }, runtime: inputs.runtime, mechanics: inputs.battle });
  return {inputs, facts, romSha1:cfg.cartridge.sha1, rosterContext:createFireRedRosterContext({...inputs,mechanics:inputs.battle,facts})};
}

// owner (build 126): the FireRed owner the run is for; a helper save previews
// on its own worker's cartridge, never the main owner's.
export function loadSuiteCampaignContext(configPath, game = "firered", owner = game) {
  frlgGame(game);
  if (game === "leafgreen") return loadLeafGreenCampaignContext(json(configPath));
  const config = json(configPath), cfg = config.games?.[owner];
  if (!cfg?.inputs || cfg.cartridge?.sha1 !== STOCK) throw new Error("Configure the verified FireRed campaign cartridge and game data first.");
  const inputs = Object.fromEntries(["runtime","world","story","battle"].map(key => [key,json(cfg.inputs[key])]));
  const stock = readFireRedRosterFacts({ romBytes: readFileSync(cfg.cartridge.path),
    cartridge: { ...cfg.cartridge, id: "firered-rev1-stock" }, runtime: inputs.runtime, mechanics: inputs.battle });
  const cartridge = ownerCampaignCartridge(config, owner);
  if (![STOCK,PEER].includes(cartridge.sha1)) throw new Error("This FireRed cartridge does not have a verified campaign adapter.");
  let facts = stock;
  if (cartridge.sha1 !== STOCK) {
    facts = readFireRedRosterFacts({romBytes:readFileSync(cartridge.path),cartridge:{...cartridge,id:"firered-rev1-peer-trade-v2"},runtime:inputs.runtime,mechanics:inputs.battle});
    if (!isDeepStrictEqual(facts.species,stock.species)) throw new Error("The trade cartridge's roster tables differ from the verified story game.");
  }
  return {inputs, facts, romSha1:cartridge.sha1, rosterContext:createFireRedRosterContext({...inputs,mechanics:inputs.battle,facts})};
}
