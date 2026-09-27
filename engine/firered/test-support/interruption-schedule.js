// Reproducible fault schedules shared by generated controller tests and native
// replays. The seed identifies the input sequence; it never changes game RAM.
export function interruptionSchedule(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('invalid interruption seed');
  let state=seed>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/0x100000000;};
  return ()=>({restartBefore:random()<0.25,restartAfter:random()<0.25,
    transitionSamples:Math.floor(random()*3),pause:random()<0.2});
}
