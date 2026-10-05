// Link faults a FireRed partner replay injects into one trade (controller and
// process control only; nothing in either game's memory is written).
//
// A fault fires when both owners reach the named `callback2` on the named leg:
// - `stall`: the named owner's whole process is stopped (SIGSTOP) for `ms`.
//   A stall clearly shorter than the link heartbeat must complete without a
//   retry (restarts 0, 500–3500 ms): the paired frame clocks hold the running
//   game. A stall clearly longer ends the link before the exchange (restarts 1,
//   5000–8000 ms): both owners cold-boot, prove their saves and retry the leg.
// - `reset`: the partner console takes its own soft-reset chord while it is
//   still choosing its Pokémon (scripts/replay-console-reset.mjs). Before any
//   exchange that is a lost link, so it always costs one verified retry.
//
// Faults run in order, one per trade attempt: the next fault is armed only
// after the previous one's retry was verified. A fault without a retry ends
// the sequence. The game refuses a fourth retry (local-evolution.js
// verifyLocalTradeRestart), so a list may cost at most three.
const KINDS=new Set(['stall','reset']);
const LEGS=new Set(['outbound','return']);
const MAX_RETRIES=3;

function check(condition,message){if(!condition)throw Error(message);}

export function parseLinkFaults(fixture,partnerOwner){
 const legacy=[fixture?.partnerStall?{kind:'stall',...fixture.partnerStall}:null,fixture?.partnerReset?{kind:'reset',...fixture.partnerReset}:null].filter(Boolean);
 check(!(fixture?.linkFaults&&legacy.length),'A fixture names its link faults either as linkFaults or as one legacy partnerStall/partnerReset.');
 check(legacy.length<2,'The legacy fields name one fault; use linkFaults for a sequence.');
 const list=fixture?.linkFaults??legacy;
 check(Array.isArray(list),'linkFaults is a list.');
 let restarts=0,resets=0,ended=false;
 return list.map((fault,index)=>{
  check(KINDS.has(fault?.kind),`Link fault ${index+1} has an unknown kind.`);
  check(!ended,'A fault that completes without a retry ends the sequence; it must come last.');
  check(/^CB2_\w+$/.test(fault.callback2??''),`Link fault ${index+1} names its callback (CB2_…).`);
  check(LEGS.has(fault.leg),`Link fault ${index+1} names the outbound or return leg.`);
  if(fault.kind==='stall'){
   check(['firered',partnerOwner].includes(fault.owner),`Link fault ${index+1} stalls one of the two owners.`);
   check(Number.isInteger(fault.ms)&&(fault.restarts===0&&fault.ms>=500&&fault.ms<=3500||fault.restarts===1&&fault.ms>=5000&&fault.ms<=8000),
    `Link fault ${index+1}: a stall stays clearly under the link heartbeat without a retry (500–3500 ms) or clearly past it with one retry (5000–8000 ms).`);
  }else{
   check(fault.owner===partnerOwner,'Only the partner console takes the soft-reset chord.');
   check(fault.restarts===1,'A console reset before the exchange always costs one verified retry.');
   check(++resets===1,'One console-reset request serves one reset per replay.');
  }
  const attempt=restarts;restarts+=fault.restarts;
  check(restarts<=MAX_RETRIES,`The faults would need ${restarts} verified retries; the game allows ${MAX_RETRIES}.`);
  ended||=fault.restarts===0;
  return {...fault,index:index+1,attempt,restartsAfter:restarts};
 });
}

// A fresh extra-save loan can stop and restart both owners at one reviewed
// point: the Day Care withdrawal after the Egg was received (where native run 1
// of the loan stopped, preserved as the old `-loan-resume` checkpoint).
export function loanRestartPoint(fixture){
 const point=fixture?.restartAt??null;
 if(point===null)return null;
 check(point==='daycare-withdrawal','A loan replay restarts its owners only at the Day Care withdrawal.');
 check(fixture.resume!==true,'A resumed loan already starts mid-loan; it takes no restart point.');
 return point;
}
