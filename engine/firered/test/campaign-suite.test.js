import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareCampaignSuite, runCampaignSuite } from "../src/player/campaign-suite.js";

async function fixture(t, {startBarrier=0}={}) {
  const root = await mkdtemp(join(tmpdir(), "master-red-suite-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  const barrierDirectory=join(root,'start-barrier');
  if(startBarrier)await mkdir(barrierDirectory);
  await mkdir(join(project, "src", "cli"), { recursive: true });
  await mkdir(join(project, "research"));
  await writeFile(join(project, "package.json"), '{"type":"module"}');
  await writeFile(join(project, "research", "policy.json"), '{"frozen":true}');
  // A real child process exercises scheduling, output ownership, failures and deadlines.
  await writeFile(join(project, "src", "cli", "run-player.js"), `
    import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
    import {join,basename} from 'node:path';
    const arg = name => process.argv[process.argv.indexOf(name)+1];
    const output = arg('--output');
    await mkdir(output);
    const startedAt = Date.now();
    const seed = Number(arg('--seed'));
    // Measure actual simultaneous children, independently of process startup
    // speed under the full gate. Five children cannot satisfy a six-party barrier.
    if(${startBarrier}) {
      const barrier=${JSON.stringify(barrierDirectory)};
      await writeFile(join(barrier,basename(output)),String(startedAt));
      while((await readdir(barrier)).length<${startBarrier}) {
        if(Date.now()-startedAt>10000)throw Error('The required concurrent children did not start.');
        await new Promise(r=>setTimeout(r,10));
      }
    }
    await new Promise(r=>setTimeout(r,150));
    await writeFile(join(output,'episode.json'),JSON.stringify({
      running:false, targetReached:seed!==2, stopReason:seed===2?'safety-stop':'target-reached',
      startedAt, endedAt:Date.now(), metadata:{runId:arg('--run-id')},
      video:process.argv.includes('--view-only'),livePort:process.argv.includes('--live-port')?Number(arg('--live-port')):null,
      emulationSpeed:Number(arg('--emulation-speed')), videoFps:Number(arg('--video-fps')),
      qualification:process.argv.includes('--qualification-target'),
      experiment:process.argv.includes('--experiment')?JSON.parse(await readFile(arg('--experiment'),'utf8')):null,
      untilTarget:process.argv.includes('--until-target'),
      maxDecisions:process.argv.includes('--max-decisions')?arg('--max-decisions'):null,
      scenario:process.argv.includes('--scenario-target')?arg('--scenario-target'):null,
      continuation:process.argv.includes('--continuation-target')?arg('--continuation-target'):null,
      sourceRunId:process.argv.includes('--source-run-id')?arg('--source-run-id'):null,
      rosterMode:process.argv.includes('--roster-mode')?arg('--roster-mode'):null,
      teamSeed:process.argv.includes('--team-seed')?Number(arg('--team-seed')):null,
      teamSeedText:process.argv.includes('--team-seed')?arg('--team-seed'):null,
      state:process.argv.includes('--state')?arg('--state'):null
    }));
    process.exitCode = seed===2?2:0;
  `);
  return { root, project };
}

test("suite preparation isolates controller files and preselects all twenty independent seeds", async t => {
  const { root, project } = await fixture(t);
  const manifest = await prepareCampaignSuite({ projectRoot: project, suiteDirectory: join(root, "suite"),
    seedBase: 0, concurrency: 4, inputs: { rom: "/private/cartridge", core: "/private/core" } });
  assert.ok(manifest, "suite must be prepared");
  assert.equal(manifest.episodes.length, 20);
  assert.equal(new Set(manifest.episodes.map(x=>x.seed)).size, 20);
  assert.deepEqual(manifest.episodes.filter(x=>x.target==="hall-of-fame").map(x=>x.seed), [0,2,4]);
  await writeFile(join(project, "research", "policy.json"), '{"frozen":false}');
  assert.equal(await readFile(join(root, "suite", "controller", "research", "policy.json"), "utf8"), '{"frozen":true}');
  await assert.rejects(prepareCampaignSuite({projectRoot:project,suiteDirectory:join(root,"suite")}), /exist/i);
});

test("five research lanes freeze matched configs and keep the fresh hard campaign separate", async t => {
  const { root, project } = await fixture(t);
  const directory = join(root, "research-suite");
  const checkpoint = { state: join(root, "input.state"), sram: join(root, "input.sav") };
  await writeFile(checkpoint.state, "state"); await writeFile(checkpoint.sram, "sram");
  const cfg = { schema: "master-red/training-experiment/v1", mode: "efficiency", purpose: "Matched test", readiness: "baseline", windowFrames: 600 };
  const jobs = [0, 1, 2, 3].map(i => ({ id: `window-${i}`, host: "desktop", game: "firered-rev1-stock",
    kind: "experiment", target: "training-window", seed: 0, checkpoint: "matched", sourceRunId: "parent-run",
    experiment: { ...cfg, readiness: i % 2 ? "ace-match" : "baseline" } }));
  jobs.push({ id: "hard", host: "desktop", game: "firered-rev1-stock", kind: "experiment", target: "underlevel-hall-of-fame",
    seed: 0, experiment: { schema: cfg.schema, mode: "underlevel", purpose: "Under-level campaign" } });
  const plan = { schema: "pokemon/test-plan/v1", id: "research", hosts: { desktop: {
    concurrency: 5, emulationSpeed: 5, videoFramesPerSecond: 15, videoPortBase: 17840 } }, jobs };
  const manifest = await prepareCampaignSuite({ projectRoot: project, suiteDirectory: directory,
    plan, hostId: "desktop", checkpoints: { matched: checkpoint }, budgets: { wallMs: null } });
  assert.equal(manifest.episodes[4].checkpoint, undefined);
  assert.equal(manifest.episodes[0].evidenceKind, "training-experiment");
  assert.equal(manifest.episodes[0].checkpoint.state.sha256, manifest.episodes[1].checkpoint.state.sha256);
  const summary = await runCampaignSuite({ suiteDirectory: directory, pollMs: 20 });
  assert.equal(summary.counts.passed, 5);
  for (const episode of summary.episodes) {
    const report = JSON.parse(await readFile(join(directory, "episodes", episode.id, "episode.json")));
    assert.equal(report.qualification, false);
    assert.equal(report.experiment.mode, episode.experiment.mode);
    assert.equal(report.untilTarget, true);
  }
  await writeFile(join(directory, "experiments", "window-0.json"), JSON.stringify({ ...cfg, readiness: "ace-match" }));
  await assert.rejects(runCampaignSuite({ suiteDirectory: directory }), /experiment.*changed/);
});

test("the unattended queue limits child concurrency and records failures without retrying saves", async t => {
  const {root,project} = await fixture(t);
  const directory = join(root,"suite");
  const manifest = await prepareCampaignSuite({projectRoot:project,suiteDirectory:directory,
    seedBase:0,concurrency:2,inputs:{rom:"rom",core:"core"}});
  assert.ok(manifest, "suite must be prepared");
  const summary = await runCampaignSuite({suiteDirectory:directory,pollMs:20});
  assert.ok(summary, "suite must return its durable result");
  assert.equal(summary.running,false);
  assert.equal(summary.episodes.filter(x=>x.status==="passed").length,19);
  assert.equal(summary.episodes.filter(x=>x.status==="failed").length,1);
  const intervals = [];
  for (const episode of summary.episodes) {
    const report = JSON.parse(await readFile(join(directory,"episodes",episode.id,"episode.json")));
    intervals.push({at:report.startedAt,change:1},{at:report.endedAt,change:-1});
  }
  intervals.sort((a,b)=>a.at-b.at||a.change-b.change);
  let active=0, peak=0;
  for (const interval of intervals) {active+=interval.change;peak=Math.max(peak,active);}
  assert.equal(peak,2);
  const again = await runCampaignSuite({suiteDirectory:directory,pollMs:20});
  assert.equal(again.episodes.filter(x=>x.status==="passed").length,19);
  assert.deepEqual(again.episodes.map(x=>x.startedAt),summary.episodes.map(x=>x.startedAt));
});

test("a changed frozen controller prevents any campaign from starting", async t => {
  const {root,project} = await fixture(t);
  const directory=join(root,"suite");
  const manifest=await prepareCampaignSuite({projectRoot:project,suiteDirectory:directory,inputs:{rom:"rom",core:"core"}});
  assert.ok(manifest, "suite must be prepared");
  await writeFile(join(directory,"controller","research","policy.json"),"changed");
  await assert.rejects(runCampaignSuite({suiteDirectory:directory}),/controller.*changed/);
});

test("a silent child is stopped by the watchdog and its failed run is not retried", async t => {
  const {root,project}=await fixture(t);
  await writeFile(join(project,"src","cli","run-player.js"),"setInterval(()=>{},1000);");
  const directory=join(root,"suite");
  const manifest=await prepareCampaignSuite({projectRoot:project,suiteDirectory:directory,inputs:{rom:"rom",core:"core"},
    budgets:{heartbeatMs:60,shutdownMs:100,wallMs:5000}});
  assert.equal(manifest.budgets.heartbeatMs,60);
  manifest.episodes=manifest.episodes.slice(0,1);
  await writeFile(join(directory,"suite.json"),JSON.stringify(manifest));
  const result=await runCampaignSuite({suiteDirectory:directory,pollMs:20});
  assert.equal(result.episodes[0].status,"failed");
  assert.equal(result.episodes[0].supervisorStop,"heartbeat-timeout");
});

test("a suite with no wall limit launches until-target campaigns and preserves failure evidence", async t => {
  const { root, project } = await fixture(t), directory = join(root, "untimed");
  const plan = fleetPlan(); plan.jobs[0].seed = 2;
  const manifest = await prepareCampaignSuite({ projectRoot: project, suiteDirectory: directory, plan, hostId: "mini",
    budgets: { wallMs: null } });
  assert.equal(manifest.budgets.wallMs, null);
  const summary = await runCampaignSuite({ suiteDirectory: directory, pollMs: 20 });
  assert.equal(summary.episodes[0].supervisorStop, undefined);
  assert.equal(summary.episodes[0].progress.untilTarget, true);
  assert.equal(summary.episodes[0].progress.maxDecisions, null);
  assert.equal(summary.issues?.[0].reason, "safety-stop");
  assert.equal(summary.issues[0].runId, manifest.episodes[0].id);
  assert.match(summary.issues[0].diagnosticsDirectory, /\.diagnostics$/);
  const repeated = await runCampaignSuite({ suiteDirectory: directory, pollMs: 20 });
  assert.equal(repeated.episodes[0].startedAt, summary.episodes[0].startedAt);
});

test("removing wall limits does not remove the silent-child watchdog", async t => {
  const { root, project } = await fixture(t), directory = join(root, "untimed-silent");
  await writeFile(join(project, "src", "cli", "run-player.js"), "setInterval(()=>{},1000);");
  await prepareCampaignSuite({ projectRoot: project, suiteDirectory: directory, plan: fleetPlan(), hostId: "mini",
    budgets: { wallMs: null, heartbeatMs: 80, shutdownMs: 100 } });
  const result = await runCampaignSuite({ suiteDirectory: directory, pollMs: 20 });
  assert.equal(result.episodes[0].supervisorStop, "heartbeat-timeout");
  assert.equal(result.issues[0].reason, "heartbeat-timeout");
});

test("campaign CLI explains the create and run modes without requiring a cartridge", () => {
  const result=spawnSync(process.execPath,["src/cli/run-campaign-suite.js","--help"],{
    cwd:new URL("..",import.meta.url),encoding:"utf8"});
  assert.equal(result.status,0);
  assert.match(result.stdout,/create/);
  assert.match(result.stdout,/run/);
});

test("video episodes receive distinct view-only ports without changing cold-start seed selection", async t => {
  const {root,project}=await fixture(t);
  const directory=join(root,"suite");
  const manifest=await prepareCampaignSuite({projectRoot:project,suiteDirectory:directory,seedBase:0,concurrency:2,
    inputs:{rom:"rom",core:"core"},videoPortBase:17440});
  assert.deepEqual(manifest.episodes.slice(0,3).map(e=>e.livePort),[17440,17441,17442]);
  manifest.episodes=manifest.episodes.slice(0,3);
  await writeFile(join(directory,"suite.json"),JSON.stringify(manifest));
  const result=await runCampaignSuite({suiteDirectory:directory,pollMs:20});
  for(const episode of result.episodes){
    assert.equal(episode.status,"passed");
    assert.equal(episode.progress.video,true);
    assert.equal(episode.progress.livePort,episode.livePort);
  }
});

test("a six-player queue forwards its recorded speed to every real child process", async t => {
  const {root,project}=await fixture(t,{startBarrier:6});
  const directory=join(root,"speed-suite");
  const manifest=await prepareCampaignSuite({projectRoot:project,suiteDirectory:directory,
    seedBase:0,concurrency:6,emulationSpeed:6,videoPortBase:17440});
  assert.equal(manifest.emulationSpeed,6);
  const summary=await runCampaignSuite({suiteDirectory:directory,pollMs:20});
  const intervals=[];
  for(const episode of summary.episodes){
    assert.equal(episode.progress.emulationSpeed,6);
    assert.equal(episode.progress.video,true);
    intervals.push({at:episode.progress.startedAt,change:1},{at:episode.progress.endedAt,change:-1});
  }
  intervals.sort((a,b)=>a.at-b.at||a.change-b.change);
  let active=0,peak=0;
  for(const event of intervals){active+=event.change;peak=Math.max(peak,active);}
  assert.equal(peak,6);
});

test("unsupported batch speeds are rejected before allocating a suite or launching children", async t => {
  const {root,project}=await fixture(t);
  for(const [index,speed] of [0,0.5,10.1,NaN,Infinity,"6",null].entries()){
    const directory=join(root,`invalid-${index}`);
    await assert.rejects(prepareCampaignSuite({projectRoot:project,suiteDirectory:directory,emulationSpeed:speed}),/emulation speed/i);
    await assert.rejects(readFile(join(directory,"suite.json")),{code:"ENOENT"});
  }
  const directory=join(root,"invalid-launch");
  const manifest=await prepareCampaignSuite({projectRoot:project,suiteDirectory:directory});
  manifest.emulationSpeed=0;
  await writeFile(join(directory,"suite.json"),JSON.stringify(manifest));
  await assert.rejects(runCampaignSuite({suiteDirectory:directory,pollMs:20}),/emulation speed/i);
  await assert.rejects(readFile(join(directory,"supervisor.lock")),{code:"ENOENT"});
});

test("default and legacy suites retain 5x while supported endpoint and fractional speeds reach children", async t => {
  const {root,project}=await fixture(t);
  for(const [label,speed,want] of [["default",undefined,5],["legacy",undefined,5],["native",1,1],["maximum",10,10],["fractional",6.5,6.5]]){
    const directory=join(root,label);
    const manifest=await prepareCampaignSuite({projectRoot:project,suiteDirectory:directory,emulationSpeed:speed});
    manifest.episodes=manifest.episodes.slice(0,1);
    if(label==="legacy")delete manifest.emulationSpeed;
    await writeFile(join(directory,"suite.json"),JSON.stringify(manifest));
    const result=await runCampaignSuite({suiteDirectory:directory,pollMs:20});
    assert.equal(result.episodes[0].progress.emulationSpeed,want,label);
  }
});

test("campaign CLI persists an explicit speed in a separately created suite", async t => {
  const {root}=await fixture(t);
  const directory=join(root,"cli-speed");
  const result=spawnSync(process.execPath,["src/cli/run-campaign-suite.js","create",directory,
    "--rom",join(root,"unused.gba"),"--core",join(root,"unused-core"),"--concurrency","6","--emulation-speed","6"],
    {cwd:new URL("..",import.meta.url),encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
  const manifest=JSON.parse(await readFile(join(directory,"suite.json"),"utf8"));
  assert.equal(manifest.emulationSpeed,6);
  assert.equal(manifest.concurrency,6);
});

function fleetPlan() {
  return { schema: "pokemon/test-plan/v1", id: "firered-proof",
    hosts: { mini: { concurrency: 1, emulationSpeed: 5, videoFramesPerSecond: 15, videoPortBase: 17500 },
      desktop: { concurrency: 2, emulationSpeed: 6, videoFramesPerSecond: 20, videoPortBase: 17520 } },
    jobs: [
      { id: "opening-mini", host: "mini", game: "firered-rev1-stock", kind: "campaign", target: "brock", seed: 1 },
      { id: "full-desktop", host: "desktop", game: "firered-rev1-stock", kind: "campaign", target: "hall-of-fame", seed: 4 },
    ] };
}

test("fleet jobs freeze and forward explicit roster choices, including a zero team seed", async t => {
  const { root, project } = await fixture(t), plan = fleetPlan();
  plan.jobs[0].rosterMode = "origins";
  plan.jobs[0].teamSeed = 0;
  const directory = join(root, "roster-options");
  const manifest = await prepareCampaignSuite({ projectRoot: project, suiteDirectory: directory, plan, hostId: "mini" });
  const result = await runCampaignSuite({ suiteDirectory: directory, pollMs: 20 });
  assert.equal(result.episodes[0].progress.rosterMode, "origins");
  assert.equal(result.episodes[0].progress.teamSeed, 0);
  assert.equal(manifest.episodes[0].rosterMode, "origins");
  manifest.episodes[0].teamSeed = 12;
  await writeFile(join(directory, "suite.json"), JSON.stringify(manifest));
  await assert.rejects(runCampaignSuite({ suiteDirectory: directory }), /partition.*changed/);
});

test("invalid fleet roster settings fail before preparing a suite", async t => {
  const { root, project } = await fixture(t);
  for (const [index, settings] of [{ rosterMode: "anything" }, { teamSeed: -1 }, { teamSeed: "0" },
    { teamSeed: 0x1_0000_0000 }, { rosterMode: null }].entries()) {
    const plan = fleetPlan(); Object.assign(plan.jobs[0], settings);
    await assert.rejects(prepareCampaignSuite({ projectRoot: project, suiteDirectory: join(root, `bad-roster-${index}`),
      plan, hostId: "mini" }), /roster|team seed/i);
  }
});

test("fleet preserves a 256-bit team seed without numeric truncation", async t => {
  const { root, project } = await fixture(t), plan = fleetPlan();
  const teamSeed = `hex:${"0123456789abcdef".repeat(4)}`;
  plan.jobs[0].teamSeed = teamSeed;
  const directory = join(root, "wide-roster-seed");
  const manifest = await prepareCampaignSuite({ projectRoot: project, suiteDirectory: directory, plan, hostId: "mini" });
  assert.equal(manifest.episodes[0].teamSeed, teamSeed);
  const result = await runCampaignSuite({ suiteDirectory: directory, pollMs: 20 });
  assert.equal(result.episodes[0].progress.teamSeedText, teamSeed);
});

test("one portable plan partitions explicit jobs across hosts without duplicate identities", async t => {
  const { root, project } = await fixture(t); const plan = fleetPlan();
  const mini = await prepareCampaignSuite({ projectRoot: project, suiteDirectory: join(root, "mini"), plan, hostId: "mini" });
  const desktop = await prepareCampaignSuite({ projectRoot: project, suiteDirectory: join(root, "desktop"), plan, hostId: "desktop" });
  assert.equal(mini.episodes.length, 1); assert.equal(desktop.episodes.length, 1);
  assert.equal(mini.plan.revision, desktop.plan.revision);
  assert.equal(mini.concurrency, 1); assert.equal(desktop.emulationSpeed, 6);
  assert.equal(mini.episodes[0].jobId, "opening-mini");
  assert.equal(desktop.episodes[0].jobId, "full-desktop");
  assert.equal(mini.episodes[0].livePort, 17500);
  assert.equal(mini.videoFramesPerSecond, 15);
});

test("unsupported games and invalid host assignments fail before creating any suite", async t => {
  const { root, project } = await fixture(t);
  for (const change of [p => { p.jobs[0].game = "emerald"; }, p => { p.jobs[0].host = "unknown"; },
    p => { p.jobs[1].id = p.jobs[0].id; }, p => { p.jobs[0].checkpoint = "not-a-cold-start"; }]) {
    const plan = fleetPlan(); change(plan);
    await assert.rejects(prepareCampaignSuite({ projectRoot: project, suiteDirectory: join(root, "invalid-plan"), plan, hostId: "mini" }), /game|host|duplicate|checkpoint/);
  }
});

test("draining a queue preserves pending jobs and resuming never restarts finished jobs", async t => {
  const { root, project } = await fixture(t); const directory = join(root, "drain");
  const manifest = await prepareCampaignSuite({ projectRoot: project, suiteDirectory: directory, plan: fleetPlan(), hostId: "mini" });
  await writeFile(join(directory, "control.json"), JSON.stringify({ mode: "drain" }));
  const drained = await runCampaignSuite({ suiteDirectory: directory, pollMs: 20 });
  assert.ok(drained.episodes.every(e => e.status === "pending"));
  assert.equal(drained.control.mode, "drain");
  await writeFile(join(directory, "control.json"), JSON.stringify({ mode: "run" }));
  const resumed = await runCampaignSuite({ suiteDirectory: directory, pollMs: 20 });
  assert.equal(resumed.episodes.length, manifest.episodes.length);
  assert.equal(resumed.episodes[0].status, "passed");
  const again = await runCampaignSuite({ suiteDirectory: directory, pollMs: 20 });
  assert.equal(again.episodes[0].startedAt, resumed.episodes[0].startedAt);
});

test("replay checkpoint inputs are copied, hashed, checked and passed only to diagnostic jobs", async t => {
  const { root, project } = await fixture(t); const plan = fleetPlan();
  plan.jobs = [{ ...plan.jobs[0], kind: "replay", target: "party-restored", checkpoint: "silph" }];
  const state = join(root, "original.state"), sram = join(root, "original.sav");
  await writeFile(state, "state"); await writeFile(sram, "sram");
  const directory = join(root, "replay");
  const manifest = await prepareCampaignSuite({ projectRoot: project, suiteDirectory: directory, plan, hostId: "mini", checkpoints: { silph: { state, sram } } });
  assert.equal(manifest.episodes[0].evidenceKind, "checkpoint-diagnostic");
  const result = await runCampaignSuite({ suiteDirectory: directory, pollMs: 20 });
  assert.equal(result.episodes[0].progress.qualification, false);
  assert.equal(result.episodes[0].progress.scenario, "party-restored");
  assert.equal(result.episodes[0].progress.state, join(directory, manifest.episodes[0].checkpoint.state.path));
  assert.equal(result.episodes[0].progress.videoFps, 15);
  await writeFile(state, "changed original");
  const frozen = join(directory, manifest.episodes[0].checkpoint.state.path);
  assert.equal(await readFile(frozen, "utf8"), "state");
  await writeFile(frozen, "tampered copy");
  await assert.rejects(runCampaignSuite({ suiteDirectory: directory, pollMs: 20 }), /checkpoint.*changed/);
});

test("untimed continuation jobs preserve their source link and checkpoint without claiming a cold start", async t => {
  const { root, project } = await fixture(t), plan = fleetPlan();
  plan.jobs = [{ ...plan.jobs[0], kind: "continuation", target: "hall-of-fame", checkpoint: "resume", sourceRunId: "previous-run" }];
  const state = join(root, "input.state"), sram = join(root, "input.sav");
  await writeFile(state, "state"); await writeFile(sram, "sram");
  const directory = join(root, "continued");
  const manifest = await prepareCampaignSuite({ projectRoot: project, suiteDirectory: directory, plan, hostId: "mini",
    budgets: { wallMs: null }, checkpoints: { resume: { state, sram } } });
  assert.equal(manifest.episodes[0].evidenceKind, "continued-campaign");
  const result = await runCampaignSuite({ suiteDirectory: directory, pollMs: 20 });
  assert.equal(result.episodes[0].progress.qualification, false);
  assert.equal(result.episodes[0].progress.continuation, "hall-of-fame");
  assert.equal(result.episodes[0].progress.sourceRunId, "previous-run");
  assert.equal(result.episodes[0].progress.untilTarget, true);
  assert.equal(result.episodes[0].progress.state, join(directory, manifest.episodes[0].checkpoint.state.path));
  const altered = JSON.parse(await readFile(join(directory, "suite.json")));
  altered.episodes[0].sourceRunId = "invented-parent";
  await writeFile(join(directory, "suite.json"), JSON.stringify(altered));
  await assert.rejects(runCampaignSuite({ suiteDirectory: directory, pollMs: 20 }), /partition.*changed/);
});

test("the suite CLI supports an explicit none wall limit", async t => {
  const { root } = await fixture(t), directory = join(root, "no-wall");
  const result = spawnSync(process.execPath, ["src/cli/run-campaign-suite.js", "create", directory,
    "--rom", "unused.gba", "--core", "unused-core", "--wall-ms", "none"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(join(directory, "suite.json"))).budgets.wallMs, null);
});

test("CLI creates a host partition and offers a durable drain control", async t => {
  const { root } = await fixture(t), directory = join(root, "cli-plan"), plan = join(root, "plan.json");
  await writeFile(plan, JSON.stringify(fleetPlan()));
  const created = spawnSync(process.execPath, ["src/cli/run-campaign-suite.js", "create", directory,
    "--rom", "unused.gba", "--core", "unused-core", "--plan", plan, "--host", "mini"], { encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  const manifest = JSON.parse(await readFile(join(directory, "suite.json")));
  assert.equal(manifest.episodes.length, 1);
  const drained = spawnSync(process.execPath, ["src/cli/run-campaign-suite.js", "control", directory, "--mode", "drain"], { encoding: "utf8" });
  assert.equal(drained.status, 0, drained.stderr);
  assert.equal(JSON.parse(await readFile(join(directory, "control.json"))).mode, "drain");
});

test("a declared host partition cannot silently change its seed, target or concurrency", async t => {
  const { root, project } = await fixture(t);
  for (const [index, change] of [m => { m.episodes[0].seed++; }, m => { m.episodes[0].target = "hall-of-fame"; },
    m => { m.concurrency = 16; }, m => { m.episodes[0].rosterMode = "origins"; },
    m => { m.episodes[0].teamSeed = 0; }].entries()) {
    const directory = join(root, `changed-partition-${index}`);
    const manifest = await prepareCampaignSuite({ projectRoot: project, suiteDirectory: directory, plan: fleetPlan(), hostId: "mini" });
    change(manifest); await writeFile(join(directory, "suite.json"), JSON.stringify(manifest));
    await assert.rejects(runCampaignSuite({ suiteDirectory: directory, pollMs: 20 }), /partition.*changed/);
    await assert.rejects(readFile(join(directory, "supervisor.lock")), { code: "ENOENT" });
  }
});
