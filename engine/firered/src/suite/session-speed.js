// Wireless and paired emulator clocks keep their separately qualified pacing.
export function sessionTiming({game,speed,manual=false,radio=false,local=false}) {
 if(speed!==undefined&&(!Number.isFinite(speed)||speed<1||speed>10))throw Error('Choose an emulation speed from 1 through 10.');
 const emulationSpeed=manual||radio?1:speed??(game==='firered'&&!local?10:5);
 return {emulationSpeed,adaptiveTiming:game==='firered'&&!local&&!radio&&!manual&&emulationSpeed>1};
}

export function estimatedEmulationSeconds(frames,control={}) {
 const measured=control.achievedEmulationSpeed;
 const speed=Number.isFinite(measured)&&measured>0?measured:control.effectiveEmulationSpeed??1;
 return frames/(59.7275*speed);
}
