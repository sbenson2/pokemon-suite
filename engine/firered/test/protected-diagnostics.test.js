import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunDiagnosticRecorder } from "../src/player/diagnostics.js";

test("valuable encounters keep dedicated replay evidence outside the rotating ordinary journal", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-protected-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recorder = await createRunDiagnosticRecorder({ outputDirectory: root, runId: "protected-test",
    sessionId: "test", session: { saveState: () => new Uint8Array([1]), saveSram: () => new Uint8Array([2]),
      videoFrame: () => ({ width: 1, height: 1, rgba: new Uint8Array(4) }) } });
  const update = (n, capture = null) => ({ decisions: n, observation: { captureId: `c${n}`, frame: n,
    phase: "stable", emulator: { mode: "battle" }, playerMemory: {}, sram: {} },
    decision: { kind: "blocked", reason: "protected-encounter-pause", protectedEncounter: capture,
      action: { buttons: [], holdFrames: 1, releaseFrames: 1 } } });
  await recorder.recordUpdate(update(1));
  await recorder.recordUpdate(update(2, { id: "initial:1", observationId: "c2", pokemon: { shiny: true } }));
  const status = recorder.status();
  assert.match(status.latestBundlePath, /protected-encounter$/);
  assert.ok(await readFile(join(status.latestBundlePath, "emulator.state")));
  const bundle = JSON.parse(await readFile(join(status.latestBundlePath, "decision.json"), "utf8"));
  assert.equal(bundle.protectedEncounter.pokemon.shiny, true);
  await recorder.close({ result: "blocked" });
});
