(() => {
 'use strict';
 const words=v=>String(v??'').replaceAll('_',' ').replaceAll('-',' ');
 const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 function create({root,onSession=()=>{},onStarted=()=>{}}){
  const host=root.querySelector('#suite-campaign-runs');
  let game=null,owner=false,session=null,data=null,loading=false,busy=false,review=null,revision=0,form=null,currentKey='';
  const current=node('section','campaign-current'),setup=node('details','campaign-setup'),title=node('summary','','New adventure');
  const content=node('div','campaign-setup-content'),message=node('p','campaign-message');message.setAttribute('role','status');
  setup.append(title,content);host.append(current,setup,message);
  async function api(path,body){const response=await fetch(`./api/pokemon-suite/${path}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const r=await response.json();if(!response.ok||r.ok===false)throw Error(r.error||r.message||'The request could not be completed.');return r;}
  function members(team,cls='campaign-team'){
   const list=node('ol',cls);
   for(const p of team||[]){const li=node('li','campaign-member'),img=node('img');img.src=p.sprite||`./assets/pokedex/firered/${p.species}.png`;img.alt='';img.width=48;img.height=48;img.loading='lazy';
    const copy=node('span');copy.append(node('strong','',words(p.name||p.label||p.species)),node('small','',p.targetName&&p.targetName!==p.name?`→ ${words(p.targetName)}`:p.helperRole?`${words(p.helperRole)} helper`:words(p.afterObjectiveId||'Permanent team')));li.append(img,copy);list.append(li);
   }return list;
  }
  function invalidate(){revision++;review=null;content.querySelector('.campaign-preview')?.remove();message.textContent='';}
  function permissions(){host.querySelectorAll('button,input,select').forEach(e=>{e.disabled=busy||!owner;});if(form){form.querySelector('#campaign-helpers').disabled=busy||!owner||form.elements.teamMode.value==='balanced';form.querySelectorAll('[data-replay] input').forEach(e=>{e.disabled=busy||!owner||form.elements.seedMode.value!=='replay';});}}
  function renderCurrent(){
   const c=session?.campaign,key=JSON.stringify([c?.id,c?.status,c?.objective,c?.reason,owner,busy]);if(key===currentKey)return;currentKey=key;current.replaceChildren();current.hidden=!c;if(!c)return;
   const h=node('header');h.append(node('h3','',c.label||'Current adventure'),node('span','campaign-state',words(c.status)));current.append(h,node('p','',c.reason||words(c.objective?.id)||'The selected campaign is saved.'),members(c.team));
   const seeds=node('details','campaign-seeds');seeds.append(node('summary','','Run seeds'),node('p','',`Opening: ${c.seed} · Team: ${c.teamSeed}`));current.append(seeds);
   if(c.status!=='complete'){
    const actions=node('div','campaign-actions'),pause=['running','finishing'].includes(c.status),button=node('button','suite-secondary',pause?'Pause adventure':'Resume adventure');button.type='button';button.disabled=busy||!owner;
    button.onclick=async()=>{if(busy)return;busy=true;permissions();try{const r=await api(pause?'stop-game':'start-game',pause?{game,sessionId:session.sessionId}:{game});session=r.session;onSession(session);message.textContent=pause?'Adventure paused and saved.':'Resuming the saved adventure.';}catch(e){message.textContent=e.message;}finally{busy=false;currentKey='';renderCurrent();permissions();}};actions.append(button);current.append(actions);
   }
  }
  function field(label,id,name,type='text',value=''){
   const wrap=node('label','campaign-field'),input=node('input');input.id=id;input.name=name;input.type=type;input.value=value;wrap.append(node('span','',label),input);return {wrap,input};
  }
  function select(label,id,name,options,value){const wrap=node('label','campaign-field'),input=node('select');input.id=id;input.name=name;for(const [v,t]of options){const o=node('option','',t);o.value=v;input.append(o);}input.value=value;wrap.append(node('span','',label),input);return {wrap,input};}
  function renderForm(){
   content.replaceChildren();form=null;review=null;
   if(!data?.supported){content.append(node('p','',data?.reason||'Fresh campaign automation is currently available for FireRed.'));return;}
   const s=data.settings||data.defaults;form=node('form');form.id='campaign-run-form';
   content.append(node('p','campaign-intro','Pick a starter and draw five other evolutionary families. Review the team before creating its separate save.'));
   const label=field('Run name','campaign-label','label','text',s.label);label.input.maxLength=50;label.input.required=true;form.append(label.wrap);
   const starters=node('fieldset','campaign-starters');starters.append(node('legend','','Starter'));
   for(const p of [{id:'random',name:'Random',sprite:'./assets/pokemon/items/poke_ball.png'},...data.starters]){
    const tile=node('label','campaign-starter'),input=node('input');input.type='radio';input.name='starter';input.value=p.id;input.checked=s.starter===p.id;
    const img=node('img');img.src=p.sprite||`./assets/pokedex/firered/${p.species}.png`;img.alt='';img.width=40;img.height=40;tile.append(input,img,node('span','',words(p.name)));starters.append(tile);
   }form.append(starters);
   const fields=node('div','campaign-fields');
   const mode=select('Team selection','campaign-team-mode','teamMode',[['random','Random Adventure'],['balanced','Balanced Adventure']],s.teamMode);
   const helpers=select('Temporary helpers','campaign-helpers','helpers',[['allowed','Field and early battle helpers'],['field-only','Field moves only'],['none','Permanent six only']],s.helpers);
   const explain=node('p','campaign-explanation');
   const describe=()=>{if(mode.input.value==='balanced')helpers.input.value='none';explain.textContent=mode.input.value==='random'?'Every eligible family has the same chance in the draw. Strength, type balance and arrival time do not weight the team. Helpers stay outside the permanent six.':'The existing generator selects a team with coverage, field moves and early battle support within its six members.';permissions();};
   mode.input.onchange=describe;fields.append(mode.wrap,helpers.wrap);form.append(fields,explain);
   const advanced=node('details','campaign-advanced');advanced.append(node('summary','','Seeds and eligible Pokémon'));
   const seedMode=select('New draw or replay','campaign-seed-mode','seedMode',[['fresh','Fresh seeds for this run'],['replay','Replay specific seeds']],s.seedMode);advanced.append(seedMode.wrap);
   const seeds=node('div','campaign-fields');seeds.dataset.replay='';const opening=field('Opening seed (0–4294967295)','campaign-seed','seed','number',s.seed??'');opening.input.min='0';opening.input.max='4294967295';opening.input.step='1';opening.input.required=true;
   const team=field('Team seed (uint32 or hex: plus 64 digits)','campaign-team-seed','teamSeed','text',s.teamSeed??'');team.input.required=true;seeds.append(opening.wrap,team.wrap);advanced.append(seeds);
   const seedVisibility=()=>{seeds.hidden=seedMode.input.value!=='replay';permissions();};seedMode.input.onchange=seedVisibility;
   advanced.append(node('p','',`${data.pool.length} acquisition choices. ${data.poolScope}`));
   const pool=node('ul','campaign-pool');pool.tabIndex=0;pool.setAttribute('aria-label','Eligible Pokémon');for(const p of data.pool)pool.append(node('li','',`${words(p.name)} · ${words(p.afterObjectiveId)}`));advanced.append(pool);form.append(advanced);
   const actions=node('div','campaign-actions'),preview=node('button','suite-secondary','Review team');preview.type='submit';actions.append(preview);form.append(actions);content.append(form);
   form.addEventListener('input',invalidate);form.addEventListener('change',invalidate);
   form.onsubmit=async event=>{
    event.preventDefault();if(busy||!owner)return;invalidate();const version=revision,chosenGame=game;
    const settings={label:form.elements.label.value.trim(),starter:form.elements.starter.value,teamMode:mode.input.value,helpers:helpers.input.value,seedMode:seedMode.input.value,seed:seedMode.input.value==='replay'?Number(opening.input.value):null,teamSeed:seedMode.input.value==='replay'?(/^\d+$/.test(team.input.value.trim())?Number(team.input.value.trim()):team.input.value.trim()):null};
    busy=true;permissions();message.textContent='Checking the acquisition plan…';
    try{const r=await api('campaign-runs/preview',{game:chosenGame,settings});if(game!==chosenGame||revision!==version)return;review=r.preview;renderPreview();message.textContent='Team reviewed. Starting creates a separate save and backs up the current profile.';}
    catch(e){message.textContent=e.message;}finally{busy=false;permissions();}
   };describe();seedVisibility();
  }
  function renderPreview(){
   content.querySelector('.campaign-preview')?.remove();if(!review)return;
   const box=node('section','campaign-preview');box.append(node('h4','','Your permanent six'),members(review.team));
   if(review.helpers?.length){box.append(node('h4','','Temporary helpers'),members(review.helpers,'campaign-helpers-list'));}
   const seeds=node('details','campaign-seeds');seeds.append(node('summary','','Seeds for this draw'),node('p','',`Opening: ${review.seed} · Team: ${review.teamSeed}`));box.append(seeds);
   const actions=node('div','campaign-actions'),start=node('button','suite-primary','Start new run');start.type='button';start.id='campaign-start';start.onclick=async()=>{
    if(busy||!owner||!review)return;busy=true;permissions();const chosenGame=game,id=review.id;message.textContent='Backing up the current profile and starting the reviewed team…';
    try{const r=await api('campaign-runs/start',{game:chosenGame,previewId:id});session=r.session;review=null;box.remove();setup.open=false;onSession(session);await onStarted(chosenGame);message.textContent='Adventure started. Its team and seeds are saved for resume.';}
    catch(e){message.textContent=e.message;}finally{busy=false;currentKey='';renderCurrent();permissions();}
   };actions.append(start);box.append(actions);content.append(box);permissions();
  }
  async function load(){
   if(loading||!owner)return;loading=true;const requested=game;message.textContent='Loading adventure settings…';
   try{const r=await api(`campaign-runs?game=${encodeURIComponent(game)}`);if(game!==requested)return;data=r;renderForm();message.textContent='';}
   catch(e){if(game===requested){message.textContent=e.message;const retry=node('button','suite-secondary','Retry settings');retry.type='button';retry.onclick=()=>{retry.remove();void load();};content.replaceChildren(retry);}}
   finally{loading=false;if(game!==requested&&owner&&game==='firered')void load();}
  }
  return {update(next){
   owner=next.owner;session=next.session;host.hidden=!next.active;if(game!==next.game){game=next.game;data=null;form=null;review=null;revision++;content.replaceChildren();message.textContent='';currentKey='';}
   renderCurrent();permissions();
   if(next.active&&owner&&!data&&!loading){if(game!=='firered'){data={supported:false};renderForm();}else void load();}
  }};
 }
 window.SuiteCampaignRuns={create};
})();
