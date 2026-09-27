#!/usr/bin/env node
// Ranks candidate team members for a Crystal starter from cartridge data
// (games/crystal/player/team-score.mjs) and prints the greedy coverage team.
//
//   node games/crystal/cli/score-teams.mjs [--starter CYNDAQUIL] [--size 5] [--json]

import { loadCrystalKnowledge } from '../knowledge.mjs';
import { scoreTeamPlan } from '../player/team-score.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const starters = option('--starter', null) ? [option('--starter')] : ['CHIKORITA', 'CYNDAQUIL', 'TOTODILE'];
const size = Number(option('--size', '5'));
const knowledge = loadCrystalKnowledge();
const results = starters.map((starter) => scoreTeamPlan({ knowledge, starter, size }));
if (args.includes('--json')) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }
for (const result of results) {
  console.log(`\n== ${result.starter} ==`);
  console.log('species      final        from                 method   p      growth battle det   HMs score');
  for (const entry of result.scored) {
    console.log(`${entry.species.padEnd(12)} ${entry.finalForm.padEnd(12)} ${entry.availableFrom.padEnd(20)} ${entry.method.padEnd(8)} ${String(entry.encounterProbability).padEnd(6)} ${String(entry.growthRatio).padEnd(6)} ${String(entry.battle).padEnd(6)} ${String(entry.determinism).padEnd(5)} ${String(entry.hmCoverage.length).padEnd(3)} ${entry.score}`);
  }
  console.log(`team: ${result.team.map((entry) => `${entry.species}→${entry.finalForm}`).join(', ')}`);
  console.log(`coverage: ${Object.entries(result.coverage).map(([boss, value]) => `${boss}=${value.toFixed(2)}`).join(' ')}`);
}
