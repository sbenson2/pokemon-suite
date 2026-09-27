// "Ask the bot" field in the bot task panel: real interpreter (standalone
// service), stubbed task options and commit (no game or goal supervisor needed).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ChromePage,CHROME} from './helpers/chrome-page.mjs';

test('Ask the bot: clarification chips, confirmation and commit', {skip:!existsSync(CHROME),timeout:45000}, async()=>{
  const data=mkdtempSync(join(tmpdir(),'suite-ask-'));
  const server=spawn(process.env.PYTHON||'python3',['-m','pokemon_suite','--data-dir',data,'serve','--port','0']);
  let page;
  try {
    const address=await new Promise((resolve,reject)=>{
      server.stdout.once('data',bytes=>{try{resolve(JSON.parse(String(bytes)).url);}catch(error){reject(error);}});
      server.once('error',reject);server.once('exit',code=>reject(Error('server exited '+code)));
    });
    page=await ChromePage.open();await page.command('Runtime.enable');await page.command('Page.enable');
    await page.command('Page.navigate',{url:address});
    await page.waitFor("Boolean(window.SuiteBotTasks)",'The bot task module did not load');
    await page.evaluate(`(()=>{
      const real=window.fetch.bind(window);window.__commits=[];window.__cancels=[];window.__warms=[];
      window.fetch=async(url,options={})=>{
        const path=String(url).replace(/^\\.\\/api\\//,'');
        const reply=body=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
        if(path.startsWith('pokemon-suite/player-tasks?'))return reply({ok:true,game:'firered',supported:true,profiles:[],locations:[{id:'MAP_CINNABAR_ISLAND',name:'Cinnabar Island'}],items:[{id:2,name:'Ultra Ball'}]});
        if(path==='pokemon-farming/requests')return reply({ok:true,requests:[]});
        if(path==='pokemon-suite/requests/commit'){const body=JSON.parse(options.body);window.__commits.push(body);return reply({ok:true,goal:{id:'goal-1',status:'queued'}});}
        if(path==='pokemon-suite/requests/warm'){window.__warms.push(JSON.parse(options.body));return real(url,options);}
        if(path==='pokemon-suite/requests/cancel'){const response=await real(url,options);window.__cancels.push({body:JSON.parse(options.body),reply:await response.clone().json()});return response;}
        return real(url,options);
      };
      const root=document.createElement('div');root.id='ask-test';root.innerHTML='<div id="suite-bot-task-setup"></div>';document.body.append(root);
      window.__tasks=SuiteBotTasks.create({root,onFarming(){},onSession(){},onStart:async()=>{},onStop:async()=>{}});
      window.__tasks.update({owner:true,active:true,game:'firered',session:{game:'firered',bot:{enabled:false}}});
    })()`);
    const $=selector=>`document.querySelector('#ask-test ${selector}')`;
    await page.waitFor(`Boolean(${$('#bot-ask-text')})`,'The ask field did not render');
    assert.equal(await page.evaluate(`Boolean(${$('#bot-ask-form')}.compareDocumentPosition(${$('#bot-task-kind')})&Node.DOCUMENT_POSITION_FOLLOWING)`),true,'the ask field sits above the task select');
    // Opening Ask starts Laya loading (no body, no waiting); focusing the field again soon after does not repeat it.
    await page.waitFor('window.__warms.length===1','Opening Ask did not start Laya loading');
    assert.deepEqual(await page.evaluate('window.__warms[0]'),{});
    await page.evaluate(`${$('#bot-ask-text')}.dispatchEvent(new FocusEvent('focus'))`);
    assert.equal(await page.evaluate('window.__warms.length'),1,'a warm-up covers the next 30 seconds');
    await page.evaluate(`(()=>{const real=Date.now;Date.now=()=>real()+31000;${$('#bot-ask-text')}.dispatchEvent(new FocusEvent('focus'));Date.now=real;})()`);
    await page.waitFor('window.__warms.length===2','Coming back to Ask later did not warm Laya again');
    const send=async text=>{await page.evaluate(`${$('#bot-ask-text')}.value=${JSON.stringify(text)};${$('#bot-ask-form')}.requestSubmit()`);};

    await send('catch a mewt');
    await page.waitFor(`!${$('#bot-ask-choices')}.hidden`,'No clarification chips appeared');
    const chips=await page.evaluate(`[...${$('#bot-ask-choices')}.querySelectorAll('button')].map(b=>b.textContent)`);
    assert.ok(chips.includes('Mew')&&chips.includes('Mewtwo'),String(chips));
    assert.match(await page.evaluate(`${$('#bot-ask-result')}.textContent`),/Which Pokémon/);
    await page.evaluate(`[...${$('#bot-ask-choices')}.querySelectorAll('button')].find(b=>b.textContent==='Mewtwo').click()`);
    await page.waitFor(`!${$('#bot-ask-actions')}.hidden`,'The resolved request did not offer to run');
    assert.match(await page.evaluate(`${$('#bot-ask-result')}.textContent`),/Mewtwo/);
    assert.equal(await page.evaluate(`${$('#bot-ask-confirm')}.textContent`),'Run');
    await page.evaluate(`${$('#bot-ask-confirm')}.click()`);
    await page.waitFor(`/Goal queued/.test(${$('#bot-ask-result')}.textContent)`,'The commit result was not shown');
    const first=await page.evaluate('window.__commits[0]');
    assert.match(first.idempotencyKey,/^web-/);assert.ok(first.draftId);assert.deepEqual(first.answers,{});

    await send('start a new game as NOVA with squirtle');
    await page.waitFor(`!${$('#bot-ask-actions')}.hidden`,'The new-game request did not offer to run');
    assert.equal(await page.evaluate(`${$('#bot-ask-confirm')}.textContent`),'Confirm');
    assert.match(await page.evaluate(`${$('#bot-ask-notes')}.textContent`),/new save/i);
    assert.equal(await page.evaluate(`!${$('#bot-ask-notes')}.hidden&&Boolean(${$('#bot-ask-notes')}.compareDocumentPosition(${$('#bot-ask-confirm')})&Node.DOCUMENT_POSITION_FOLLOWING)`),true,'the reason line sits above Confirm');
    await page.evaluate(`${$('#bot-ask-confirm')}.click()`);
    await page.waitFor('window.__commits.length===2','The confirmed commit was not sent');
    assert.deepEqual(await page.evaluate('window.__commits[1].answers'),{confirm:'yes'});

    await send('heal then save');
    await page.waitFor(`!${$('#bot-ask-actions')}.hidden`,'The heal request did not offer to run');
    await page.evaluate(`${$('#bot-ask-cancel')}.click()`);
    await page.waitFor('window.__cancels.length===1','Cancel did not tell the Suite (a logged request outcome)');
    const cancelled=await page.evaluate('window.__cancels[0]');
    assert.ok(cancelled.body.draftId);assert.deepEqual(Object.keys(cancelled.body),['draftId']);
    assert.deepEqual(cancelled.reply,{ok:true,cancelled:true},'the real service dropped the draft');
    assert.equal(await page.evaluate(`${$('#bot-ask-actions')}.hidden`),true);assert.equal(await page.evaluate(`${$('#bot-ask-result')}.textContent`),'');
    assert.equal(await page.evaluate('window.__commits.length'),2,'Cancel never commits');

    await send('make me a sandwich');
    await page.waitFor(`/can’t/.test(${$('#bot-ask-result')}.textContent)`,'Nonsense was not rejected');
    assert.ok(await page.evaluate(`${$('#bot-ask-choices')}.querySelectorAll('button').length`)>=2,'suggestions are offered');
    assert.equal(await page.evaluate(`${$('#bot-ask-actions')}.hidden`),true);

    await send("what's my team");
    await page.waitFor(`/not running/.test(${$('#bot-ask-result')}.textContent)`,'The status answer was not shown');
    assert.equal(await page.evaluate(`${$('#bot-ask-actions')}.hidden`),true,'questions have nothing to run');
  } finally {
    // Stop the service even if closing the browser fails, so a cleanup error
    // cannot leave the server holding the test run open.
    try{await page?.close?.();}finally{server.kill();rmSync(data,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
  }
});
