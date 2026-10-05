// Replay-only preload for one owner process (node --import). Gates 118-02 and
// 122-01: the FireRed partner restarted itself in the trade room. This presses
// the console's own soft-reset chord (A+B+Start+Select; FireRed's main loop
// calls DoSoftReset) on the owner's linked session once the replay writes the
// request file. Controller input only: no memory write, save or ROM change.
import {registerHooks} from 'node:module';
import {existsSync,unlinkSync,writeFileSync} from 'node:fs';

const request=process.env.SUITE_REPLAY_CONSOLE_RESET;
if(!request)throw Error('SUITE_REPLAY_CONSOLE_RESET names the reset request file.');
const CHORD=['a','b','start','select'];
let steps=0,held=0;
globalThis.suiteReplayConsoleReset=(session,buttons)=>{
 if(held>0){held--;return [...new Set([...buttons,...CHORD])];}
 if(++steps%10||!existsSync(request))return buttons;
 unlinkSync(request);writeFileSync(request+'.done',JSON.stringify({frame:session.frame})+'\n');
 console.error(`# console reset chord at frame ${session.frame}`);
 held=3;return [...new Set([...buttons,...CHORD])];
};
// Only the session that owns the native link (the running game) takes the chord;
// verification sessions in the same process never do.
const WRAP=`
;{const step=MgbaSession.prototype.step,attach=MgbaSession.prototype.attachWireless;
MgbaSession.prototype.attachWireless=function(){this.suiteReplayLinked=true;return attach.call(this);};
MgbaSession.prototype.step=function(buttons=[]){return step.call(this,this.suiteReplayLinked?globalThis.suiteReplayConsoleReset(this,buttons):buttons);};}
`;
registerHooks({load(url,context,nextLoad){
 const result=nextLoad(url,context);
 return url.endsWith('/engine/firered/src/emulator/mgba-session.js')?{...result,source:String(result.source)+WRAP}:result;
}});
