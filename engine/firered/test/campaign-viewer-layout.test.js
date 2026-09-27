import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const browser = process.env.MASTER_RED_TEST_BROWSER ?? "";

// This catches clipped/uneven implicit rows when six live games occupy the desktop viewer.
for (const {width,columns,rows} of [{width:1400,columns:3,rows:2},{width:1000,columns:2,rows:3}]) {
test(`six video cards have equal visible rows at a ${width}px window width`, {
  skip: !browser || !existsSync(browser) ? "set MASTER_RED_TEST_BROWSER to a Chromium executable" : false,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), "master-red-layout-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const html = await readFile(new URL("../src/presentation/campaign-viewer.html", import.meta.url), "utf8");
  const fixture = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace("</body>", `<script>
    const grid=document.querySelector('#games');
    for(let i=0;i<6;i++)grid.append(document.querySelector('#game-template').content.firstElementChild.cloneNode(true));
    document.querySelector('#empty').hidden=true;
    const cards=[...grid.children].map(e=>e.getBoundingClientRect());
    const screens=[...grid.querySelectorAll('.screen')].map(e=>e.getBoundingClientRect());
    const output=document.createElement('output');output.id='layout-result';output.hidden=true;
    output.textContent=JSON.stringify({columns:new Set(cards.map(r=>Math.round(r.left))).size,
      rows:new Set(cards.map(r=>Math.round(r.top))).size,
      visible:cards.every(r=>r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight),
      minimumScreenHeight:Math.min(...screens.map(r=>r.height)),
      screenHeightDifference:Math.max(...screens.map(r=>r.height))-Math.min(...screens.map(r=>r.height))});
    document.body.append(output);
  </script></body>`);
  const page = join(root, "six-games.html");
  await writeFile(page, fixture);
  const result = spawnSync(browser, ["--headless", "--disable-background-networking", "--disable-sync",
    "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(root, "profile")}`,
    `--window-size=${width},980`, "--dump-dom", pathToFileURL(page).href], {
    encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "ignore"],
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const match = /<output id="layout-result"[^>]*>(.*?)<\/output>/.exec(result.stdout);
  assert.ok(match, "the browser must execute the layout probe");
  const layout = JSON.parse(match[1]);
  assert.equal(layout.columns, columns);
  assert.equal(layout.rows, rows);
  assert.equal(layout.visible, true);
  assert.ok(layout.minimumScreenHeight >= 160, "each game needs a usable video area");
  assert.ok(layout.screenHeightDifference < 2, "all six screens should have equal-height rows");
});
}

test("the right sidebar tracks live, queued and completed tests without reopening finished video", {
  skip: !browser || !existsSync(browser) ? "set MASTER_RED_TEST_BROWSER to a Chromium executable" : false,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), "master-red-sidebar-layout-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const html = await readFile(new URL("../src/presentation/campaign-viewer.html", import.meta.url), "utf8");
  const client = await readFile(new URL("../src/presentation/campaign-video-client.js", import.meta.url), "utf8");
  const episodes = Array.from({ length: 12 }, (_, index) => ({
    id: `sidebar-run-${index + 1}`, number: index + 1, jobId: `job-${index + 1}`,
    target: index < 6 ? "hall-of-fame" : "brock", starter: "BULBASAUR",
    status: index < 6 ? "running" : "pending", hasVideo: true, evidenceKind: "cold-campaign",
    gameSeconds: 200, wallSeconds: 25, map: "MAP_VIRIDIAN_CITY", party: [{ level: 12 }], badgeCount: 1,
    milestones: { oakParcel: true, brock: true, hallOfFame: false },
  }));
  const setup = `<script>
    const fixtureEpisodes=${JSON.stringify(episodes)};
    let statusReads=0;
    window.fetch=async url=>{
      if(url!=='/api/status')return new Response(null,{status:503});
      statusReads++;
      if(statusReads>=2){fixtureEpisodes[0].status='passed';fixtureEpisodes[0].targetReached=true;
        fixtureEpisodes[0].milestones.hallOfFame=true;fixtureEpisodes[0].badgeCount=8;}
      return new Response(JSON.stringify({id:'sidebar-suite',hostId:'desktop',configuredSpeed:8,episodes:fixtureEpisodes}));
    };
    window.sidebarProbe={};
    const probeTimer=setInterval(()=>{
      const grid=document.querySelector('#games');
      if(statusReads===1&&grid.children.length===6&&!sidebarProbe.first){
        const sidebar=document.querySelector('#test-sidebar'),rect=sidebar?.getBoundingClientRect(),games=grid.getBoundingClientRect();
        sidebarProbe.first={exists:!!sidebar,rows:document.querySelectorAll('#test-list [data-test-id]').length,
          onRight:!!rect&&rect.left>=games.right&&rect.right<=innerWidth&&rect.bottom<=innerHeight,
          scrollable:!!sidebar&&document.querySelector('#test-list').scrollHeight>document.querySelector('#test-list').clientHeight,
          noPageOverflow:document.documentElement.scrollWidth<=innerWidth,
          purpose:sidebar?.textContent.includes('new game'),queued:sidebar?.textContent.includes('Queued')};
      }
      if(statusReads>=2&&grid.children.length===5){
        const row=document.querySelector('#test-list [data-test-id="sidebar-run-1"]');
        sidebarProbe.final={rows:document.querySelectorAll('#test-list [data-test-id]').length,
          finishedRetained:!!row,finishedText:row?.textContent,activeVideos:grid.children.length,
          sameNumber:row?.querySelector('.test-name')?.textContent.includes('01')};
        const output=document.createElement('output');output.id='sidebar-result';output.hidden=true;
        output.textContent=JSON.stringify(sidebarProbe);document.body.append(output);clearInterval(probeTimer);
      }
    },50);
  </script>`;
  const page = join(root, "sidebar.html");
  await writeFile(page, html.replace('<script type="module" src="/viewer.js"></script>', `${setup}<script type="module">${client}</script>`));
  const result = spawnSync(browser, ["--headless", "--disable-background-networking", "--disable-sync",
    "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(root, "profile")}`,
    "--window-size=1400,980", "--virtual-time-budget=4500", "--dump-dom", pathToFileURL(page).href], {
    encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "ignore"],
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  const match = /<output id="sidebar-result"[^>]*>(.*?)<\/output>/.exec(result.stdout);
  assert.ok(match, "the real viewer must render and process the second status update");
  const probe = JSON.parse(match[1]);
  assert.equal(probe.first.exists, true, "the dashboard needs a test sidebar");
  assert.equal(probe.first.rows, 12);
  assert.equal(probe.first.onRight, true);
  assert.equal(probe.first.scrollable, true);
  assert.equal(probe.first.noPageOverflow, true);
  assert.equal(probe.first.purpose, true);
  assert.equal(probe.first.queued, true);
  assert.equal(probe.final.rows, 12);
  assert.equal(probe.final.finishedRetained, true);
  assert.equal(probe.final.sameNumber, true);
  assert.match(probe.final.finishedText, /review/i);
  assert.equal(probe.final.activeVideos, 5);
});
