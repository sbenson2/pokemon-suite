// Explicit local canary: exercise the real installed owner through the Suite UI.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {ChromePage} from '../tests/helpers/chrome-page.mjs';
const page=await ChromePage.open(),errors=[];
page.socket.addEventListener('message',event=>{const value=JSON.parse(String(event.data));if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.exception?.description||value.params.exceptionDetails.text);});
try {
  await page.command('Runtime.enable');await page.command('Page.enable');
  await page.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await page.command('Page.navigate',{url:process.argv[2]||'http://127.0.0.1:8765/'});
  await page.waitFor("document.querySelector('#suite-current-game')?.textContent.includes('FireRed')",'FireRed was not selected');
  await page.evaluate("document.querySelector('[data-suite-view=workspace]').click()");
  await page.waitFor("document.querySelector('canvas').width===240 && document.querySelector('.suite-screen-message').hidden",'The live emulator frame did not arrive');
  await page.evaluate("document.querySelector('[data-journey-tab=manual]').click();document.querySelector('#suite-manual-toggle').click()");
  await page.waitFor("document.querySelector('#suite-manual-toggle').getAttribute('aria-pressed')==='true'",'Manual takeover did not succeed');
  const input=await page.evaluate("fetch('/api/pokemon-suite/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game:'firered',buttons:['up','left']})}).then(async r=>({status:r.status,body:await r.json()}))");
  assert.equal(input.status,200,JSON.stringify(input));
  await page.evaluate("fetch('/api/pokemon-suite/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game:'firered',buttons:[]})})");
  await page.evaluate("document.querySelector('[data-journey-tab=bot]').click()");
  mkdirSync('.local/verification',{recursive:true});
  const shot=await page.command('Page.captureScreenshot',{format:'png'});writeFileSync('.local/verification/live-firered.png',Buffer.from(shot.data,'base64'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({liveFrame:true,manualTakeover:true,simultaneousDirectionalInput:true,consoleErrors:errors,screenshot:'.local/verification/live-firered.png'}));
} finally {await page.close();}
