import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readFireRedRosterFacts } from "../player/fire-red-roster-facts.js";
import { createFireRedRosterContext } from "../player/fire-red-roster.js";

const json = path => JSON.parse(readFileSync(path,"utf8"));
const STOCK = "dd5945db9b930750cb39d00c84da8571feebf417";
const PEER = "85a259c7b7a74d4f2322e5b9f89d22a53dfd6fce";

export function selectCampaignCartridge(cfg, active) {
  // Profiles retain their adapter after the configured hunt changes. Match the
  // emulator owner's selection so preview and execution bind the same ROM.
  const native = active && (active.nativeRadio === true || cfg.nativeRadio?.huntId === active.id);
  return native ? cfg.nativeRadio?.cartridge ?? cfg.cartridge : cfg.cartridge;
}

export function loadSuiteCampaignContext(configPath) {
  const config = json(configPath), cfg = config.games?.firered;
  if (!cfg?.inputs || cfg.cartridge?.sha1 !== STOCK) throw new Error("Configure the verified FireRed campaign cartridge and game data first.");
  const inputs = Object.fromEntries(["runtime","world","story","battle"].map(key => [key,json(cfg.inputs[key])]));
  const stock = readFireRedRosterFacts({ romBytes: readFileSync(cfg.cartridge.path),
    cartridge: { ...cfg.cartridge, id: "firered-rev1-stock" }, runtime: inputs.runtime, mechanics: inputs.battle });
  const activePath = join(config.directory,"firered","active-hunt.json");
  const active = existsSync(activePath) ? json(activePath) : null;
  const cartridge = selectCampaignCartridge(cfg, active);
  if (![STOCK,PEER].includes(cartridge.sha1)) throw new Error("This FireRed cartridge does not have a verified campaign adapter.");
  let facts = stock;
  if (cartridge.sha1 !== STOCK) {
    facts = readFireRedRosterFacts({romBytes:readFileSync(cartridge.path),cartridge:{...cartridge,id:"firered-rev1-peer-trade-v2"},runtime:inputs.runtime,mechanics:inputs.battle});
    if (!isDeepStrictEqual(facts.species,stock.species)) throw new Error("The trade cartridge's roster tables differ from the verified story game.");
  }
  return {inputs, facts, romSha1:cartridge.sha1, rosterContext:createFireRedRosterContext({...inputs,mechanics:inputs.battle,facts})};
}
