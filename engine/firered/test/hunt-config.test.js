import assert from "node:assert/strict";
import test from "node:test";
import { validateHuntConfig, evaluateHuntTarget } from "../src/player/hunt-config.js";

test("hunting defaults to inspection, pauses on every shiny, and has finite session limits", () => {
  const config = validateHuntConfig({});
  assert.equal(config.observeOnly, true);
  assert.equal(config.onShiny, "pause");
  assert.equal(config.rngMode, "off");
  assert.equal(config.preserveEveryShiny, true);
  assert.ok(config.limits.maxEncounters > 0 && config.limits.maxFrames > 0);
  assert.ok(Object.isFrozen(config.targets));
});

test("a shiny failing all secondary requirements is protected, while preferences never discard a match", () => {
  const config = validateHuntConfig({ targets: [{ required: { species: [16], shiny: true },
    preferred: { natures: ["Jolly"], minIvs: { speed: 31 } } }] });
  const pokemon = { validity: "valid", species: 19, shiny: true, nature: { name: "Hardy" }, ivs: { speed: 0 } };
  assert.deepEqual(evaluateHuntTarget(pokemon, config), { known: true, protected: true, matched: false, preferred: false });
  assert.deepEqual(evaluateHuntTarget({ ...pokemon, species: 16 }, config),
    { known: true, protected: true, matched: true, preferred: false });
  assert.equal(evaluateHuntTarget({ validity: "unknown", shiny: null }, config).known, false);
  assert.equal(evaluateHuntTarget({ ...pokemon, shiny: false }, config).protected, false);
});

test("configuration rejects typos, destructive shiny filtering, invalid attributes and unbounded budgets", () => {
  for (const config of [{ preservEveryShiny: true }, { preserveEveryShiny: false }, { observeOnly: "false" },
    { rngMode: "seed-edit" }, { limits: { maxFrames: 0 } }, { resources: { minBalls: -1 } },
    { targets: [] }, { targets: [{ required: { minIvs: { speed: 32 } } }] },
    { targets: [{ required: { species: [9999] } }] }, { targets: [{ required: { natures: ["Happy"] } }] },
    { targets: [{ required: {} }] }, { targets: [{ required: { iv: 31 } }] }]) {
    assert.throws(() => validateHuntConfig(config));
  }
});

test('Unown form targets use the native personality formula and preserve every incidental shiny',()=>{
 const config=validateHuntConfig({targets:[{required:{species:[201],unownForms:[27]}}]});
 const p={validity:'valid',species:201,personality:0x03030303,shiny:false};
 assert.equal(evaluateHuntTarget(p,config).matched,false);
 const question={...p,personality:0x00010203};
 assert.equal(evaluateHuntTarget(question,config).matched,true);
 assert.equal(evaluateHuntTarget({...p,shiny:true},config).protected,true);
 assert.throws(()=>validateHuntConfig({targets:[{required:{unownForms:[28]}}]}));
});
