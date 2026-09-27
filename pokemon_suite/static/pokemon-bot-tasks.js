(() => {
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const option=(value,label)=>`<option value="${esc(value)}">${esc(label)}</option>`;
 const descriptions={postgame:'Work through unfinished postgame objectives from this save. Completed milestones are saved; unavailable routes remain listed. Keep PC space for unexpected shinies.',hunt:'Catch the selected Pokémon with the saved requirements. Existing collection members stay yours.','national-dex':'Actively collect an owned shiny of every National Pokédex entry in this game’s generation. Evolved entries use separate new catches, preserving earlier stages. Unavailable routes stay listed and are checked again.',collection:'Catch starting-form shinies and save them as found. Evolved forms use separate new catches when requested.',travel:'Travel to this location, save in game, then return control to you.',item:'Find this many additional items from reachable pickups or supported shops, then save.',heal:'Restore the party’s health, status and PP at a reachable healing location, then save.',save:'Save through the game’s own save menu and verify it completed.',resume:'Resume the paused task with its saved progress and requirements.', 'new-save':'Keep a restorable backup of the current game, then open a fresh save at the title screen under manual control.', 'restore-save':'Back up the current game and reopen the selected saved checkpoint under manual control.'};
 async function api(path,body){const r=await fetch('./api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});const d=await r.json();if(!r.ok||d.ok===false)throw Error(d.error||'The task could not be started.');return d;}
 function create({root,onFarming,onSession,onStart,onStop}){
  const host=root.querySelector('#suite-bot-task-setup');let game=null,owner=false,busy=false,revision=0,data=null,requests=[],session=null;
  // "Ask the bot": natural-language requests -> interpret (draft, clarification chips) -> confirm -> commit to the goal supervisor.
  const ask={text:'',answers:{},draft:null,key:null,warmed:0};
  const askForm='<form id="bot-ask-form" class="bot-task-form bot-ask-form" autocomplete="off"><label><span>Ask the bot</span><input id="bot-ask-text" maxlength="1000" enterkeyhint="send" placeholder="Try “get me a shiny Mewtwo” or “heal then go to Cinnabar and save”"></label><div class="suite-control-actions"><button id="bot-ask-send" class="suite-secondary" type="submit">Send</button></div><p id="bot-ask-result" role="status" aria-live="polite"></p><div id="bot-ask-choices" class="bot-ask-choices" role="group" aria-label="Choose an answer" hidden></div><ul id="bot-ask-notes" class="bot-ask-notes" hidden></ul><div id="bot-ask-actions" class="suite-control-actions" hidden><button id="bot-ask-confirm" class="suite-primary" type="button">Run</button><button id="bot-ask-cancel" class="suite-secondary" type="button">Cancel</button></div></form>';
  const $=s=>host.querySelector(s);
  async function load(next){
   game=next;data=null;const rev=++revision;host.innerHTML='<p role="status">Loading tasks…</p>';
   try{
    const [available,saved]=await Promise.all([api('pokemon-suite/player-tasks?game='+encodeURIComponent(next)),api('pokemon-farming/requests')]);
    if(rev!==revision)return;data=available;requests=(saved.requests||[]).filter(r=>r.request.game===game&&r.state!=='complete');
    host.innerHTML='<section class="bot-rule-section bot-lifecycle"><div class="suite-control-actions"><button id="bot-lifecycle-start" class="suite-primary" type="button">Start bot</button><button id="bot-lifecycle-stop" class="suite-secondary" type="button">Stop bot</button></div><p>Start loads the current save and waits for your command. Run task begins the task you choose below.</p></section><div id="bot-storage-progress"></div><div id="bot-postgame-progress"></div><div id="bot-dex-progress"></div>';
    $('#bot-lifecycle-start').onclick=()=>lifecycle(true);$('#bot-lifecycle-stop').onclick=()=>lifecycle(false);
    if(!data.supported){host.insertAdjacentHTML('beforeend','<section class="bot-rule-section"><p>This game supports manual play. Use FireRed for hunting and player tasks; Emerald can participate in requested evolution trades.</p></section>');enable();return;}
    host.insertAdjacentHTML('beforeend',askForm);ask.draft=null;
    $('#bot-ask-form').onsubmit=askSend;$('#bot-ask-confirm').onclick=askCommit;$('#bot-ask-cancel').onclick=askCancel;$('#bot-ask-text').onfocus=askWarm;askWarm();
    host.insertAdjacentHTML('beforeend',`<form id="bot-task-form" class="bot-task-form"><label><span>What should the bot do?</span><select id="bot-task-kind">${Object.entries({postgame:'Complete the postgame checklist',hunt:'Catch a Pokémon','national-dex':'Complete the shiny National Pokédex',collection:'Collect selected shiny stages',travel:'Go to a location',item:'Find an item',heal:'Heal the team',save:'Save the game',resume:'Resume current task','new-save':'New manual save','restore-save':'Restore a save backup'}).map(([k,v])=>option(k,v)).join('')}</select></label><p id="bot-task-help"></p><div id="bot-task-fields" class="bot-setting-fields"></div><div class="suite-control-actions"><button id="bot-task-start" class="suite-primary" type="submit">Run task</button></div><p id="bot-task-message" role="status" aria-live="polite"></p></form>`);
    $('#bot-task-kind').onchange=renderFields;$('#bot-task-form').onsubmit=start;
    renderFields();
   }catch(error){if(rev===revision){host.innerHTML='<p role="status"></p>';host.querySelector('p').textContent=error.message;}}
  }
  function askChip(label,onclick){const b=document.createElement('button');b.type='button';b.className='suite-secondary';b.textContent=label;b.disabled=!owner||busy;b.onclick=onclick;return b;}
  function renderAsk(r){
   const result=$('#bot-ask-result'),choices=$('#bot-ask-choices'),notes=$('#bot-ask-notes'),actions=$('#bot-ask-actions');if(!result)return;
   choices.replaceChildren();notes.replaceChildren();choices.hidden=notes.hidden=actions.hidden=true;result.textContent='';
   if(!r)return;
   if(r.clarification){
    result.textContent=r.clarification.question;
    for(const c of r.clarification.choices||[])choices.append(askChip(c.label,()=>{ask.answers[r.clarification.id]=String(c.id);void interpretAsk();}));
    choices.hidden=!choices.children.length;return;
   }
   if(!r.understood){
    result.textContent=r.message||'I didn’t understand that.';
    for(const text of r.suggestions||[])choices.append(askChip(text,()=>{$('#bot-ask-text').value=text;ask.text=text;ask.answers={};void interpretAsk();}));
    choices.hidden=!choices.children.length;return;
   }
   const runnable=Boolean(r.goal||(r.direct||[]).length);
   result.textContent=runnable?r.summary:(r.answer||r.summary);
   const lines=[...(r.confirmation?.required?r.confirmation.reasons:[]),...(r.preview||[]).flatMap(p=>(p.limitations||[]).slice(0,1)),...(r.warnings||[])];
   for(const line of lines){const li=document.createElement('li');li.textContent=line;notes.append(li);}
   notes.hidden=!lines.length;
   if(runnable){actions.hidden=false;$('#bot-ask-confirm').textContent=r.confirmation?.required?'Confirm':'Run';}
  }
  async function interpretAsk(){
   if(!owner||busy||!ask.text)return;busy=true;enable();$('#bot-ask-result').textContent='Reading your request…';
   try{const r=await api('pokemon-suite/requests/interpret',{text:ask.text,via:'typed',answers:ask.answers});ask.draft=r;ask.key='web-'+(window.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2));renderAsk(r);}
   catch(error){ask.draft=null;renderAsk(null);$('#bot-ask-result').textContent=error.message;}
   finally{busy=false;enable();}
  }
  // Opening Ask (or coming back to it) starts Laya loading on the Suite without waiting; one warm-up covers 30 s (best effort).
  function askWarm(){if(!owner||Date.now()-ask.warmed<30000)return;ask.warmed=Date.now();api('pokemon-suite/requests/warm',{}).catch(()=>{ask.warmed=0;});}
  function askSend(event){event.preventDefault();const text=$('#bot-ask-text').value.trim();if(!text)return;if(text!==ask.text){ask.text=text;ask.answers={};}void interpretAsk();}
  async function askCommit(){
   const r=ask.draft;if(!r||!owner||busy)return;busy=true;enable();$('#bot-ask-result').textContent='Sending…';$('#bot-ask-actions').hidden=true;
   try{
    const out=await api('pokemon-suite/requests/commit',{draftId:r.draftId,idempotencyKey:ask.key,answers:r.confirmation?.required?{confirm:'yes'}:{}});
    ask.draft=null;$('#bot-ask-notes').hidden=true;$('#bot-ask-choices').hidden=true;
    $('#bot-ask-result').textContent=out.goal?`Goal ${out.goal.status||'queued'}: ${r.summary}`:`Done: ${r.summary}`;
   }catch(error){$('#bot-ask-result').textContent=error.message;$('#bot-ask-actions').hidden=false;}
   finally{busy=false;enable();}
  }
  // Cancel drops the draft on the Suite too: the owner's "no" is a logged request outcome (best effort; the form resets at once).
  function askCancel(){const id=ask.draft?.draftId;ask.draft=null;ask.answers={};renderAsk(null);if(id)api('pokemon-suite/requests/cancel',{draftId:id}).catch(()=>{});}
  function renderFields(){
   const kind=$('#bot-task-kind').value;$('#bot-task-message').textContent='';$('#bot-task-help').textContent=descriptions[kind];
   $('#bot-task-fields').innerHTML=kind==='hunt'?`<label class="bot-task-wide"><span>Saved Pokémon request</span><select id="bot-task-request">${option('','Choose a request')+requests.map(r=>option(r.id,`${r.plan.pokemon.name}${r.request.shiny==='required'?' · Shiny':''} · ${r.request.quantity} new · ${r.request.ball.id.replaceAll('-',' ')}`)).join('')}</select></label><button type="button" id="bot-task-configure" class="suite-secondary">Configure a Pokémon request</button>`:
    kind==='travel'?`<label class="bot-task-wide"><span>Destination</span><input id="bot-task-location" list="bot-task-locations" placeholder="Search a town, route or building" required autocomplete="off"><datalist id="bot-task-locations">${data.locations.map(m=>option(m.name,m.name)).join('')}</datalist></label>`:
    kind==='item'?`<label><span>Item</span><input id="bot-task-item" list="bot-task-items" placeholder="Search items" required autocomplete="off"><datalist id="bot-task-items">${data.items.map(i=>option(i.name,i.name)).join('')}</datalist></label><label><span>Additional quantity</span><input id="bot-task-quantity" type="number" value="1" min="1" max="99" required></label>`:
    kind==='new-save'?`<label class="bot-task-wide"><span>Save name</span><input id="bot-task-save-label" maxlength="50" placeholder="My new FireRed game" required></label>`:kind==='restore-save'?`<label class="bot-task-wide"><span>Save backup</span><select id="bot-task-profile" required>${option('','Choose a backup')+(data.profiles||[]).map(p=>option(p.id,p.label+' · '+new Date(p.createdAt).toLocaleString())).join('')}</select></label>`:kind==='collection'?`<label class="bot-task-wide"><span>Evolution stages to collect</span><select id="bot-task-stages">${option('base-forms','Starting forms, kept as caught')+option('each-stage','Each stage, using separate new catches')}</select></label>`:'';
   $('#bot-task-start').textContent=kind==='new-save'?'Create new save':kind==='restore-save'?'Restore save':kind==='national-dex'?'Run collection goal':'Run task';
   $('#bot-task-configure')?.addEventListener('click',onFarming);enable();
  }
  function enable(){
   if(!$('#bot-lifecycle-start'))return;
   for(const el of host.querySelectorAll('input,select,button'))el.disabled=!owner||busy;
   const automated=['firered','emerald'].includes(game)&&session?.capabilities?.bot!==false;
   const started=automated?Boolean(session?.bot?.enabled):window.SuiteConsolePower.isPowered(session);
   $('#bot-lifecycle-start').textContent=automated?'Start bot':'Start game';
   $('#bot-lifecycle-stop').textContent=automated?'Stop bot':'Stop game';
   $('#bot-lifecycle-start').disabled=!owner||busy||started;
   $('#bot-lifecycle-stop').disabled=!owner||busy||!started;
   const campaign=session?.campaign&&session.campaign.status!=='complete';
   const kind=$('#bot-task-kind');
   if(kind){
    for(const option of kind.options)option.disabled=Boolean(campaign&&!['new-save','restore-save'].includes(option.value));
    const unavailable=campaign&&!['new-save','restore-save'].includes(kind.value);
    $('#bot-task-start').disabled=!owner||busy||unavailable;
    $('#bot-task-help').textContent=unavailable?'This save has an unfinished adventure. Resume it above, or restore another save before choosing a separate task.':descriptions[kind.value];
   }
   const explanation=host.querySelector('.bot-lifecycle p');
   if(explanation)explanation.textContent=campaign?'Start resumes this adventure with its saved team and progress. Stop pauses and preserves it.':'Start loads the current save and waits for your command. Run task begins the task you choose below.';
   renderPostgame();renderProgress();
  }
  function renderPostgame(){
   const storage=$('#bot-storage-progress'),checklist=$('#bot-postgame-progress');if(!storage||!checklist)return;
   const capacity=session?.storage,agenda=session?.postgame;
   const key=JSON.stringify([capacity,agenda]);if(storage.dataset.key===key)return;storage.dataset.key=key;
   storage.innerHTML=capacity?.known?`<section class="bot-rule-section bot-dex-goal"><h3>PC space</h3><p class="bot-dex-count"><strong>${capacity.pcUsed} / ${capacity.pcCapacity}</strong> box slots used</p><progress value="${capacity.pcUsed}" max="${capacity.pcCapacity}" aria-label="Occupied PC slots"></progress><p>${capacity.free} spaces free. Keep ${capacity.reserveSlots} for unexpected shinies and transfers.</p>${capacity.shortfall?`<p>Keeping every current Pokémon and completing the shiny National Pokédex needs ${capacity.shortfall} more spaces, including the reserve.</p>`:''}${capacity.reason?`<p role="status">${esc(capacity.reason)}</p>`:''}<p>Pokémon are never released automatically.</p></section>`:'';
   const entries=agenda?.entries||[];
   checklist.innerHTML=entries.length?`<section class="bot-rule-section bot-dex-goal"><h3>Postgame checklist</h3><p>${entries.filter(e=>e.status==='complete').length} / ${entries.filter(e=>!e.conditional).length} objectives complete${agenda.enabled?' · Active':''}</p><ul class="bot-dex-blocked suite-scroll" aria-label="Postgame objectives">${entries.map(e=>`<li><span>${esc(e.label)}</span><small>${e.status==='complete'?'Complete':e.id===agenda.active&&agenda.enabled?'In progress':e.paused?'Paused':e.storageBlocked?'Waiting for PC space':e.conditional?'Conditional':e.status==='unknown'?'Needs verification':e.executable?'Pending':'Workflow needed'}${e.reason?' — '+esc(e.reason):''}${e.retry?' — '+esc(e.retry.reason):''}</small></li>`).join('')}</ul></section>`:'';
  }
  function renderProgress(){
   const host=$('#bot-dex-progress');if(!host)return;
   const run=session?.collectionRun,progress=run?.dexProgress;
   const key=JSON.stringify([run?.goal,run?.enabled,progress]);
   if(host.dataset.key===key){const reason=host.querySelector('.bot-dex-reason');if(reason)reason.textContent=run.reason;return;}host.dataset.key=key;
   if(run?.goal!=='national-dex'||!progress){host.replaceChildren();return;}
   host.innerHTML=`<section class="bot-rule-section bot-dex-goal"><h3>Shiny National Pokédex</h3><p class="bot-dex-count"><strong>${progress.owned} / ${progress.total}</strong> owned and save verified</p><progress value="${progress.owned}" max="${progress.total}" aria-label="Owned shiny National Pokédex entries"></progress><p class="bot-dex-reason">${esc(run.reason)}</p><p>${progress.available} available to hunt · ${progress.unavailable} unavailable · ${progress.deferred} deferred</p>${progress.blocked?.length?`<details><summary>Unavailable entries and required routes</summary><ul class="bot-dex-blocked suite-scroll">${progress.blocked.map(p=>`<li><span>#${String(p.speciesId).padStart(3,'0')} ${esc(p.name)}</span><small>${esc(p.reason)}</small></li>`).join('')}</ul></details>`:''}</section>`;
  }
  async function lifecycle(starting){
   if(!owner||busy)return;busy=true;enable();
   try{await (starting?onStart(game):onStop(game,session));}finally{busy=false;enable();}
  }
  async function run(body){
   const current=game,rev=revision;busy=true;enable();$('#bot-task-message').textContent='Applying your task…';
   try{const result=await api('pokemon-suite/player-tasks',{game:current,...body});if(result.session)onSession(result.session);if(['new-save','restore-save'].includes(body.action)&&rev===revision){await load(current);$('#bot-task-kind').value='restore-save';renderFields();}if(current===game)$('#bot-task-message').textContent=['new-save','restore-save'].includes(body.action)?'Save opened with manual control. The previous game is available in Restore a save backup.':body.action==='stop'?'Bot stopped. Manual control is available when the game is unlinked.':'Bot started with your selected task.';}
   catch(error){if(rev===revision)$('#bot-task-message').textContent=error.message;}
   finally{busy=false;enable();}
  }
  async function start(event){
   event.preventDefault();if(!owner||busy)return;const kind=$('#bot-task-kind').value;
   if(kind==='hunt'){
    const id=$('#bot-task-request').value;if(!id){$('#bot-task-message').textContent='Choose or configure a Pokémon request first.';return;}
    busy=true;enable();try{const r=await api('pokemon-farming/start',{id});if(r.session)onSession(r.session);$('#bot-task-message').textContent='Bot started with the saved Pokémon requirements.';}catch(error){$('#bot-task-message').textContent=error.message;}finally{busy=false;enable();}return;
   }
   if(kind==='new-save')return run({action:'new-save',task:{label:$('#bot-task-save-label').value}});
   if(kind==='restore-save')return run({action:'restore-save',task:{profileId:$('#bot-task-profile').value}});
   if(kind==='resume')return run({action:'resume'});
   if(kind==='postgame')return run({action:'postgame'});
   if(kind==='national-dex')return run({action:'collection',task:{goal:'national-dex',collectionStages:'each-stage'}});
   if(kind==='collection')return run({action:'collection',task:{collectionStages:$('#bot-task-stages').value}});
   const task={kind};
   if(kind==='travel'){task.map=data.locations.find(m=>m.name===$('#bot-task-location').value)?.id;if(!task.map){$('#bot-task-message').textContent='Choose a destination from this game’s location list.';return;}}
   if(kind==='item'){task.itemId=data.items.find(i=>i.name===$('#bot-task-item').value)?.id;task.quantity=Number($('#bot-task-quantity').value);if(!task.itemId){$('#bot-task-message').textContent='Choose an item from the list.';return;}}
   return run({action:'start',task});
  }
  window.addEventListener('pokemon-farming-request-saved',event=>{if(event.detail?.game===game)void load(game);});
  return {update(state){owner=state.owner;session=state.session;if(state.active&&state.game!==game)void load(state.game);else enable();}};
 }
 window.SuiteBotTasks={create};
})();
