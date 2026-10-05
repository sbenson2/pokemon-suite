import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLinkFaults,loanRestartPoint} from '../test-support/link-faults.js';

const OWNER='firered-partner';
const reset={kind:'reset',owner:OWNER,callback2:'CB2_TradeMenu',leg:'outbound',restarts:1};
const longStall={kind:'stall',owner:OWNER,callback2:'CB2_TradeMenu',leg:'outbound',ms:6000,restarts:1};
const shortStall={kind:'stall',owner:OWNER,callback2:'CB2_TradeMenu',leg:'outbound',ms:2500,restarts:0};

test('one replay can inject a console reset, a long stall and a short stall in sequence', () => {
 const faults=parseLinkFaults({linkFaults:[reset,longStall,shortStall]},OWNER);
 assert.deepEqual(faults.map(f=>[f.kind,f.attempt,f.restartsAfter]),[['reset',0,1],['stall',1,2],['stall',2,2]]);
 assert.equal(faults.at(-1).restartsAfter,2,'two verified retries in total, under the game\'s limit of three');
});

test('the old single-fault fixtures keep working', () => {
 assert.deepEqual(parseLinkFaults({},OWNER),[]);
 const stall=parseLinkFaults({partnerStall:{owner:OWNER,callback2:'CB2_TradeMenu',leg:'outbound',ms:6000,restarts:1}},OWNER);
 assert.deepEqual(stall.map(f=>[f.kind,f.ms,f.restarts,f.attempt]),[['stall',6000,1,0]]);
 const consoleReset=parseLinkFaults({partnerReset:{owner:OWNER,callback2:'CB2_TradeMenu',leg:'outbound',restarts:1}},OWNER);
 assert.deepEqual(consoleReset.map(f=>[f.kind,f.restarts]),[['reset',1]]);
});

test('fault lists that cannot be replayed faithfully are refused', () => {
 const refuse=(linkFaults,why)=>assert.throws(()=>parseLinkFaults({linkFaults},OWNER),Error,why);
 refuse([shortStall,longStall],'a fault that ends without a retry must come last');
 refuse([shortStall,shortStall],'only one fault may end without a retry');
 refuse([reset,{...reset}],'the console-reset request file serves one reset');
 refuse([longStall,longStall,longStall,longStall],'more retries than the game allows (three)');
 refuse([{...longStall,ms:4000}],'a stall must be clearly shorter or longer than the link heartbeat');
 refuse([{...shortStall,ms:5000}],'a stall without a retry must stay under the heartbeat');
 refuse([{...reset,owner:'firered'}],'only the partner console takes the reset chord');
 refuse([{...reset,restarts:0}],'a console reset always costs one verified retry');
 refuse([{...longStall,callback2:'TradeMenu'}],'callbacks are named CB2_…');
 refuse([{...longStall,leg:'sideways'}],'legs are outbound or return');
 refuse([{...longStall,kind:'unplug'}],'unknown fault kinds');
 assert.throws(()=>parseLinkFaults({linkFaults:[reset],partnerStall:longStall},OWNER),Error,'a fixture uses either the list or a legacy field');
});

test('a loan replay restarts both owners only at the Day Care withdrawal', () => {
 assert.equal(loanRestartPoint({}),null);
 assert.equal(loanRestartPoint({restartAt:'daycare-withdrawal'}),'daycare-withdrawal');
 assert.throws(()=>loanRestartPoint({restartAt:'daycare-withdrawal',resume:true}),Error,'a resumed loan already starts mid-loan');
 assert.throws(()=>loanRestartPoint({restartAt:'hatching'}),Error,'only the reviewed restart point');
});
