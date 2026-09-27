// Source: battle_main.c, battle_ai_script_commands.c, Cmd_handleballthrow.
// Compare bait/ball continuations using the observed bait counter. The enemy's
// flee action is chosen before this turn's bait takes effect. No ordinary bag,
// status move, damaging move or Master Ball is legal inside a Safari battle.
export function chooseSafariCapture(s){
 if(s?.validity!=='valid'||!Number.isInteger(s.balls)||s.balls<1||s.balls>30||
  ![s.bait,s.rocks,s.catchFactor,s.escapeFactor].every(Number.isInteger)||s.rocks!==0||s.bait<0||s.bait>6||s.catchFactor<1||s.catchFactor>20||s.escapeFactor<2||s.escapeFactor>20)return null;
 const memo=new Map(),catchProb=new Map();
 const caught=factor=>{
  if(catchProb.has(factor))return catchProb.get(factor);
  const rate=Math.floor(factor*1275/100),a=Math.floor(Math.floor(rate*15/10)/3);
  const threshold=Math.floor(1048560/Math.floor(Math.sqrt(Math.floor(Math.sqrt(Math.floor(16711680/a))))));
  const p=Math.min(1,threshold/65536)**4;catchProb.set(factor,p);return p;
 };
 const value=(balls,bait,factor,turns)=>{
  if(!balls||!turns)return {probability:0,action:'ball'};
  const key=[balls,bait,factor,turns].join(':');if(memo.has(key))return memo.get(key);
  const survive=1-(bait?Math.max(1,Math.floor(s.escapeFactor/4)):s.escapeFactor)*.05;
  const p=caught(factor),ball=p+(1-p)*survive*value(balls-1,Math.max(0,bait-1),factor,turns-1).probability;
  const reduced=Math.max(3,factor>>1);
  let feed=0;
  for(let duration=2;duration<=6;duration++)feed+=survive*.2*value(balls,Math.min(6,bait+duration)-1,reduced,turns-1).probability;
  const result=feed>ball+1e-12?{action:'bait',probability:feed}:{action:'ball',probability:ball};memo.set(key,result);return result;
 };
 return value(s.balls,s.bait,s.catchFactor,60);
}

