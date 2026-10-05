// Scheduling for the native replays: ordered phases of cases, run one at a time
// (serial) or in parallel lanes, each case under its own watchdog. A failure
// stops new cases only once `maxFailures` is reached, so the real-time exclusive
// phase still runs after an ordinary lane failure.
//
// startCase(fixture, {phase}) returns a promise of {pass, reused, evidence, error, ms},
// or {promise, abort} so a watchdog can stop the case's worker.
// onResult(fixture, result, phaseName) runs before the freed slot starts another case,
// which is where the caller journals the case's evidence.

const settled = value => value && typeof value.then === 'function' ? {promise: value, abort: () => {}} : value;

function runOne(fixture, phase, startCase) {
  const started = Date.now();
  const limit = Number(fixture.watchdogMs ?? phase.watchdogMs ?? Infinity);
  return new Promise(resolve => {
    let done = false, timer = null, handle = null;
    const finish = result => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({...result, id: fixture.id, ms: result.ms ?? Date.now() - started});
    };
    try {
      handle = settled(startCase(fixture, {phase: phase.name}));
    } catch (error) {
      finish({pass: false, error: String(error?.stack ?? error?.message ?? error)});
      return;
    }
    if (Number.isFinite(limit)) {
      timer = setTimeout(() => {
        const reason = `watchdog: ${fixture.id} exceeded ${Math.round(limit / 60000)} min (${limit} ms)`;
        try { handle.abort?.(reason); } catch {}
        finish({pass: false, watchdog: true, error: reason});
      }, limit);
    }
    handle.promise.then(
      result => finish(result ?? {pass: false, error: 'the case returned no result'}),
      error => finish({pass: false, error: String(error?.stack ?? error?.message ?? error)}));
  });
}

export async function runPlan({phases, lanes = 1, maxFailures = 1, startCase, onResult = () => {}}) {
  const results = [], notRun = [];
  let failures = 0;
  const limitReached = () => failures >= maxFailures;
  for (const phase of phases) {
    const queue = [...phase.cases];
    if (limitReached()) { notRun.push(...queue.map(c => c.id)); continue; }
    const width = phase.mode === 'lanes' ? Math.max(1, lanes) : 1;
    await new Promise(phaseDone => {
      let running = 0;
      const fill = () => {
        while (running < width && queue.length && !limitReached()) {
          const fixture = queue.shift();
          running += 1;
          runOne(fixture, phase, startCase).then(result => {
            running -= 1;
            if (!result.pass) failures += 1;
            results.push(result);
            onResult(fixture, result, phase.name);
            fill();
          });
        }
        if (!running) {
          notRun.push(...queue.splice(0).map(c => c.id));
          phaseDone();
        }
      };
      fill();
    });
  }
  return {results, failures, notRun};
}
