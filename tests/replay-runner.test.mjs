import test from 'node:test';
import assert from 'node:assert/strict';
import {runPlan} from '../scripts/replay-runner.mjs';

const cases = ids => ids.map(id => ({id}));
const settle = (ms = 1) => new Promise(done => setTimeout(done, ms));

test('exclusive cases still run after a lane failure', async () => {
  const started = [];
  const startCase = async fixture => {
    started.push(fixture.id);
    await settle();
    return fixture.id === 'lane-b' ? {pass: false, error: 'replay failed'} : {pass: true, reused: false, evidence: {id: fixture.id}};
  };
  const outcome = await runPlan({lanes: 2, maxFailures: 3, startCase, phases: [
    {name: 'lanes', mode: 'lanes', cases: cases(['lane-a', 'lane-b', 'lane-c'])},
    {name: 'exclusive', mode: 'serial', cases: cases(['trade-1', 'trade-2'])}]});
  assert.deepEqual(started.slice(-2), ['trade-1', 'trade-2']);
  assert.equal(outcome.failures, 1);
  assert.deepEqual(outcome.notRun, []);
  assert.deepEqual(outcome.results.filter(r => !r.pass).map(r => r.id), ['lane-b']);
});

test('the failure limit stops new cases in every later phase', async () => {
  const startCase = async fixture => ({pass: !fixture.id.startsWith('bad'), error: 'replay failed'});
  const outcome = await runPlan({lanes: 1, maxFailures: 1, startCase, phases: [
    {name: 'lanes', mode: 'lanes', cases: cases(['ok-1', 'bad-1', 'ok-2'])},
    {name: 'exclusive', mode: 'serial', cases: cases(['trade-1'])}]});
  assert.equal(outcome.failures, 1);
  assert.deepEqual(outcome.notRun, ['ok-2', 'trade-1']);
});

test('the watchdog fails a hung case and aborts its worker', async () => {
  let aborted = null;
  const startCase = fixture => fixture.id === 'hung'
    ? {promise: new Promise(() => {}), abort: reason => { aborted = reason; }}
    : {promise: Promise.resolve({pass: true, reused: false, evidence: {}}), abort: () => {}};
  const outcome = await runPlan({lanes: 1, maxFailures: 3, startCase, phases: [
    {name: 'lanes', mode: 'lanes', cases: [{id: 'hung', watchdogMs: 20}, {id: 'next', watchdogMs: 20}]}]});
  const hung = outcome.results.find(r => r.id === 'hung');
  assert.equal(hung.pass, false);
  assert.equal(hung.watchdog, true);
  assert.match(hung.error, /watchdog/);
  assert.match(aborted, /hung/);
  // The lane carries on with the next case after the watchdog.
  assert.equal(outcome.results.find(r => r.id === 'next').pass, true);
});

test('each result is journaled before the next case starts', async () => {
  const journal = [];
  const startCase = async fixture => {
    if (fixture.id === 'second') assert.deepEqual(journal, ['first'], 'the first case must be journaled first');
    await settle();
    return {pass: true, reused: false, evidence: {id: fixture.id}};
  };
  await runPlan({lanes: 1, maxFailures: 3, startCase, onResult: fixture => journal.push(fixture.id), phases: [
    {name: 'lanes', mode: 'lanes', cases: cases(['first', 'second'])}]});
  assert.deepEqual(journal, ['first', 'second']);
});

test('lanes run cases concurrently up to the lane count, serial phases one at a time', async () => {
  let running = 0, peak = {lanes: 0, serial: 0};
  const startCase = async (fixture, {phase}) => {
    running += 1; peak[phase] = Math.max(peak[phase], running);
    await settle(5); running -= 1;
    return {pass: true, reused: false, evidence: {}};
  };
  await runPlan({lanes: 3, maxFailures: 3, startCase, phases: [
    {name: 'lanes', mode: 'lanes', cases: cases(['a', 'b', 'c', 'd', 'e'])},
    {name: 'serial', mode: 'serial', cases: cases(['x', 'y'])}]});
  assert.equal(peak.lanes, 3);
  assert.equal(peak.serial, 1);
});
