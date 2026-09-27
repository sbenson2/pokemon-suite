import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveViewServer } from "../src/player/continuous-player.js";
import { createLiveViewBindings } from "../src/emulator/autonomous-emulator-worker-runtime.js";
import { createCampaignViewer } from "../src/presentation/campaign-viewer.js";
import { createFrameDecoder } from "../src/presentation/campaign-video-client.js";
import * as videoClient from "../src/presentation/campaign-video-client.js";

test("research sidebar separates XP measurement from hard-mode boss proof", () => {
  const details = videoClient.campaignTestDetails({ target: "training-window", status: "running",
    experiment: { config: { purpose: "Catch-up: baseline" }, nativeFrames: 300, windowFrames: 600,
      totalExperienceGained: 700, experiencePerNativeMinute: 100 } });
  assert.equal(details.purpose, "Catch-up: baseline");
  assert.match(details.progressLabel, /700 XP/);
  assert.equal(details.progressValue, 300);
  const hard = videoClient.campaignTestDetails({ target: "underlevel-hall-of-fame", status: "running",
    experiment: { config: { purpose: "Under-level campaign" }, bosses: [{ objectiveId: "badge-boulder", underlevel: true, outcome: "won" }],
      missingBosses: Array(20).fill("boss"), capViolations: 1, losses: 2 } });
  assert.match(hard.milestoneLabel, /1 cap violation.*2 loss/);
  assert.match(hard.progressLabel, /1\/21/);
});

test("the sidebar distinguishes badge progress from a verified League finish and explains each test", () => {
  assert.equal(typeof videoClient.campaignTestDetails, "function");
  const campaign = videoClient.campaignTestDetails({ target: "hall-of-fame", status: "running", badgeCount: 8,
    milestones: { oakParcel: true, brock: true, hallOfFame: false } });
  assert.match(campaign.purpose, /new game/i);
  assert.match(campaign.purpose, /training|healing/i);
  assert.equal(campaign.progressLabel, "8/8 badges · League not yet confirmed");
  assert.equal(campaign.statusLabel, "Running");
  const brock = videoClient.campaignTestDetails({ target: "brock", status: "pending", milestones: {} });
  assert.match(brock.purpose, /Parcel/);
  assert.equal(brock.progressLabel, "Waiting to start");
  const replay = videoClient.campaignTestDetails({ target: "party-restored", status: "passed", targetReached: true,
    evidenceKind: "checkpoint-diagnostic", milestones: { baseline: true, recovery: true } });
  assert.match(replay.purpose, /same injured team/i);
  assert.match(replay.purpose, /diagnostic/i);
  assert.equal(replay.progressLabel, "Original team fully restored");
  assert.match(replay.statusLabel, /review/i);
  const failed = videoClient.campaignTestDetails({ target: "hall-of-fame", status: "failed", badgeCount: 1,
    stopReason: "no-meaningful-progress", milestones: { oakParcel: true, brock: true } });
  assert.equal(failed.statusLabel, "Stopped / failed");
  assert.equal(failed.stopLabel, "No meaningful progress");
});

test("the tracker describes continued campaigns honestly and names the actual safety error", () => {
  const details = videoClient.campaignTestDetails({ target: "hall-of-fame", evidenceKind: "continued-campaign",
    status: "failed", stopReason: "safety-stop", failureReason: "repeated-menu-transaction" });
  assert.match(details.purpose, /checkpoint|continu/i);
  assert.doesNotMatch(details.purpose, /from a new game/i);
  assert.match(details.stopLabel, /repeated menu transaction/i);
});

test("sidebar progress comes from fresh reports and keeps queued and finished test identities", async t => {
  const root = await mkdtemp(join(tmpdir(), "master-red-sidebar-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const episodes = [
    { id: "full-a", jobId: "full-charmander-a", seed: 2026090502, target: "hall-of-fame", status: "running",
      progress: { gameSeconds: 200, wallSeconds: 25, updatedAt: "2026-09-05T06:00:10Z", badgeCount: 1,
        milestones: { oakParcel: { gameSeconds: 60 }, brock: { gameSeconds: 190 } }, targetReached: false } },
    { id: "brock-a", jobId: "brock-bulbasaur-a", target: "brock", status: "pending" },
  ];
  const publish = () => writeFile(join(root, "summary.json"), JSON.stringify({ id: "sidebar-suite", episodes }));
  await writeFile(join(root, "suite.json"), JSON.stringify({ id: "sidebar-suite", episodes }));
  await publish();
  const viewer = await createCampaignViewer({ suiteDirectory: root, port: 0 });
  t.after(() => viewer.close());
  const getStatus = () => fetch(new URL("api/status", viewer.url)).then(r => r.json());
  let status = await getStatus();
  assert.deepEqual(status.episodes.map(e => [e.number, e.jobId, e.status]), [[1, "full-charmander-a", "running"], [2, "brock-bulbasaur-a", "pending"]]);
  assert.equal(status.episodes[0].milestones.brock, true);
  assert.equal(status.episodes[0].milestones.hallOfFame, false);
  assert.equal(status.episodes[0].wallSeconds, 25);
  assert.equal(status.episodes[0].updatedAt, "2026-09-05T06:00:10Z");
  episodes[0].status = "passed";
  episodes[0].progress = { ...episodes[0].progress, badgeCount: 8, targetReached: true,
    milestones: { ...episodes[0].progress.milestones, hallOfFame: { gameSeconds: 90000 } } };
  await publish();
  status = await getStatus();
  assert.equal(status.episodes.length, 2);
  assert.equal(status.episodes[0].status, "passed");
  assert.equal(status.episodes[0].targetReached, true);
  assert.equal(status.episodes[0].milestones.hallOfFame, true);
  assert.equal(status.episodes[1].number, 2);
  episodes[0].status = "failed";
  episodes[0].sourceRunId = "original-campaign";
  episodes[0].progress = { ...episodes[0].progress, evidenceKind: "continued-campaign",
    stopReason: "safety-stop", failure: { reason: "repeated-menu-transaction", frame: 300 },
    metadata: { untilTarget: true, sourceRunId: "original-campaign" } };
  await publish();
  const continued = (await getStatus()).episodes[0];
  assert.equal(continued.sourceRunId, "original-campaign");
  assert.equal(continued.untilTarget, true);
  assert.equal(continued.failureReason, "repeated-menu-transaction");
  assert.match(videoClient.campaignTestDetails(continued).stopLabel, /Repeated menu transaction/);
});

test("the live grid removes finished previews even when no games remain active", () => {
  assert.equal(typeof videoClient.visibleCampaignEpisodes, "function");
  const episodes = [
    { id: "passed", status: "passed", hasVideo: true },
    { id: "failed", status: "failed", hasVideo: true },
    { id: "queued", status: "pending", hasVideo: true },
    { id: "starting", status: "running", hasVideo: false },
    { id: "playing", status: "running", hasVideo: true },
  ];
  assert.deepEqual(videoClient.visibleCampaignEpisodes(episodes).map(e => e.id), ["playing"]);
  episodes[4].status = "passed";
  assert.deepEqual(videoClient.visibleCampaignEpisodes(episodes), []);
  assert.equal(episodes.length, 5, "completed results must remain available in the summary");
});

test("the AgentTV canvas grid fits up to sixteen previews without overlapping the header", () => {
  assert.equal(typeof videoClient.fleetCanvasLayout, "function");
  for (const count of [1, 2, 4, 6, 16]) {
    const cells = videoClient.fleetCanvasLayout(count);
    assert.equal(cells.length, count);
    for (const cell of cells) {
      assert.ok(cell.x >= 0 && cell.y >= 70 && cell.x + cell.width <= 960 && cell.y + cell.height <= 600);
      assert.ok(cell.width > 0 && cell.height > 0);
    }
  }
});

test("view-only live feeds reject controller requests while continuing to supply real frames", async t => {
  const emulator = { latest:()=>({width:1,height:1,rgba:Buffer.from([11,22,33,255]),sequence:8}),
    subscribe:()=>()=>{}, metrics:()=>({publishedFrames:8}), controlState:()=>({mode:"bot"}) };
  const server=await createLiveViewServer({...createLiveViewBindings({emulator,viewOnly:true}),port:0});
  t.after(()=>server.close());
  for(const path of ["control/mode","control/input"]){
    const response=await fetch(new URL(path,server.url),{method:"POST",headers:{"content-type":"application/json"},body:'{"mode":"manual","buttons":["a"]}'});
    assert.equal(response.status,503);
  }
  const frame=await fetch(new URL("frame",server.url));
  assert.deepEqual([...new Uint8Array(await frame.arrayBuffer())],[11,22,33,255]);
  assert.equal((await fetch(new URL("status",server.url)).then(r=>r.json())).control.viewOnly,true);
});

test("the campaign window proxies only known video feeds and exposes no control routes", async t => {
  const root=await mkdtemp(join(tmpdir(),"master-red-viewer-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const live=await createLiveViewServer({session:{videoFrame:()=>({width:1,height:1,rgba:new Uint8Array([8,6,4,255])})},port:0});
  t.after(()=>live.close());
  await writeFile(join(root,"suite.json"),JSON.stringify({id:"video-suite",episodes:[{id:"video-01",livePort:live.port}]}));
  await writeFile(join(root,"summary.json"),JSON.stringify({id:"video-suite",running:true,plan:{hostId:"mini"},control:{mode:"drain"},emulationSpeed:5,episodes:[
    {id:"video-01",target:"brock",status:"running",livePort:live.port,progress:{map:"MAP_ROUTE1",gameSeconds:65,badgeCount:0,
      evidenceKind:"cold-campaign",performance:{observedFramesPerSecond:298.6375,staleActions:3},
      metadata:{runProfile:{starter:{name:"BULBASAUR"}}}}},
  ]}));
  const viewer=await createCampaignViewer({suiteDirectory:root,port:0});
  assert.ok(viewer,"viewer must start");
  t.after(()=>viewer.close());
  const page=await fetch(viewer.url);
  assert.equal(page.status,200);
  assert.match(page.headers.get("content-type"),/text\/html/);
  const status=await fetch(new URL("api/status",viewer.url)).then(r=>r.json());
  assert.equal((await fetch(new URL("api/status",viewer.url))).headers.get("access-control-allow-origin"), "*");
  assert.equal(status.episodes[0].starter,"BULBASAUR");
  assert.equal(status.episodes[0].gameSeconds,65);
  assert.equal(status.hostId,"mini");
  assert.equal(status.control.mode,"drain");
  assert.equal(status.episodes[0].performance.staleActions,3);
  assert.equal(status.episodes[0].evidenceKind,"cold-campaign");
  const frame=await fetch(new URL("feeds/video-01/frame",viewer.url));
  assert.equal(frame.status,200);
  assert.deepEqual([...new Uint8Array(await frame.arrayBuffer())],[8,6,4,255]);
  assert.equal((await fetch(new URL("feeds/video-01/control",viewer.url))).status,404);
  assert.equal((await fetch(new URL("feeds/not-a-run/frame",viewer.url))).status,404);
  assert.equal((await fetch(new URL("feeds/video-01/status",viewer.url),{method:"POST"})).status,405);
});

test("video decoding handles split packets and rejects oversized or invalid frames", () => {
  const received=[];
  const decoder=createFrameDecoder(frame=>received.push(frame));
  assert.ok(decoder,"frame decoder must be created");
  const packet=Buffer.alloc(20);
  packet.write("MRF1");packet.writeUInt16BE(1,4);packet.writeUInt16BE(1,6);packet.writeUInt32BE(4,8);packet.writeUInt32BE(12,12);
  packet.set([9,8,7,255],16);
  decoder.push(packet.subarray(0,11));
  assert.equal(received.length,0);
  decoder.push(packet.subarray(11));
  assert.equal(received.length,1);
  assert.deepEqual([...received[0].rgba],[9,8,7,255]);
  assert.equal(received[0].sequence,12);
  const malformed=Buffer.from(packet);malformed.writeUInt16BE(4096,4);
  assert.throws(()=>decoder.push(malformed),/invalid frame/);
});

test("stop report route requires configured secret and rejects mismatched run without stopping", async t => {
  const root = await mkdtemp(join(tmpdir(), "master-red-auth-stop-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "suite.json"), JSON.stringify({ id: "bound-suite", episodes: [{ id: "expected-run" }] }));
  await writeFile(join(root, "summary.json"), JSON.stringify({ id: "bound-suite", running: true,
    episodes: [{ id: "expected-run", status: "running" }] }));
  const viewer = await createCampaignViewer({ suiteDirectory: root, port: 0, stopReportToken: "fixture-secret" });
  t.after(() => viewer.close());
  const path = new URL("api/stop-report", viewer.url);
  const body = JSON.stringify({ requestId: "abcd1234-abcd-abcd-abcd-123456789abc", expectedRunId: "wrong-run" });
  assert.equal((await fetch(path, { method: "POST", body })).status, 401);
  assert.equal((await fetch(path, { method: "POST", headers: { "X-Fleet-Control-Token": "wrong" }, body })).status, 401);
  assert.equal((await fetch(path, { method: "POST", headers: { "X-Fleet-Control-Token": "fixture-secret" }, body })).status, 409);
  assert.equal((await fetch(path, { method: "POST", headers: { "X-Fleet-Control-Token": "fixture-secret" }, body: "x" })).status, 400);
  assert.equal((await fetch(new URL("api/stop-report/abcd1234-abcd-abcd-abcd-123456789abc", viewer.url))).status, 401);
});

test("six browser streams use separate loopback origins so live video cannot exhaust the dashboard connection pool", async t => {
  const root=await mkdtemp(join(tmpdir(),"master-red-six-streams-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const feeds=[];
  for(let index=0;index<6;index++){
    const live=await createLiveViewServer({session:{videoFrame:()=>({width:1,height:1,rgba:new Uint8Array([index,6,4,255])})},port:0});
    t.after(()=>live.close());
    feeds.push({id:`video-${index}`,livePort:live.port,status:"running"});
  }
  await writeFile(join(root,"suite.json"),JSON.stringify({id:"six",episodes:feeds}));
  await writeFile(join(root,"summary.json"),JSON.stringify({id:"six",episodes:feeds}));
  const viewer=await createCampaignViewer({suiteDirectory:root,port:0});
  t.after(()=>viewer.close());
  const status=await fetch(new URL("api/status",viewer.url)).then(r=>r.json());
  for(const episode of status.episodes)assert.equal(typeof episode.streamUrl,"string","each game needs its own stream origin");
  const urls=status.episodes.map(e=>new URL(e.streamUrl));
  assert.equal(new Set(urls.map(u=>u.origin)).size,6);
  assert.ok(urls.every(u=>u.hostname==="127.0.0.1"&&u.origin!==new URL(viewer.url).origin));
  await Promise.all(urls.map(async url=>{
    const abort=new AbortController();
    try {
      const response=await fetch(url,{signal:abort.signal});
      assert.equal(response.status,200);
      assert.equal(response.headers.get("access-control-allow-origin"),"*");
      const reader=response.body.getReader();
      const first=await reader.read();
      assert.equal(Buffer.from(first.value).subarray(0,4).toString(),"MRF1");
      await reader.cancel();
    } finally {abort.abort();}
  }));
});
