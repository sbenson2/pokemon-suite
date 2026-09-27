(() => {
  'use strict';
  const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
  const title=v=>String(v||'').toLowerCase().replace(/^map_/,'').replace(/[_-]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const methods={'current-state':'Current game timing','teachy-tv':'Teachy TV timing','title-timing':'Title-screen timing','calibrated-static':'Static encounter timing','static-reset':'Static encounter','wild-land':'Wild grass encounter','safari-land':'Safari encounter','automatic':'Comparing available methods'};
  const stage=phase=>/planning-rng/.test(phase)?1:/timing-shiny|hunting|resetting|interacting|encounter/.test(phase)?2:/capture|catch|battle|shiny/.test(phase)?3:/sav|complete/.test(phase)?4:0;
  const labels=['Prepare','Calculate','Encounter','Capture','Save'];
  const descriptions={
    'planning-rng':'Verifying encounter timing',
    'preparing-sweet-scent':'Preparing Sweet Scent for repeatable encounters',
    'catching-sweet-scent-user':'Catching a Pokémon that can use Sweet Scent',
    'timing-shiny':'Executing the verified encounter plan',
    'planning-capture':'Verifying a safe capture sequence',
    'capturing':'Catching the encountered Pokémon',
    'saving':'Saving the captured Pokémon',
    'traveling':'Travelling to the encounter location',
    'stocking-balls':'Restocking capture supplies',
    'healing':'Restoring the team at a Pokémon Center',
    'hunting':'Searching for the target Pokémon',
    'complete':'Capture saved',
  };
  const duration=ms=>{if(number(ms)===null)return '—';const s=Math.floor(Math.max(0,ms)/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h?`${h}:${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${m}:${String(s%60).padStart(2,'0')}`;};
  function project(emulator={},now=Date.now(),collection=null){
    const suite=emulator.pokemonSuite,m=suite?.mission;
    if(!m)return null;
    const t=m.timing,active=m.state==='running'&&m.phase!=='complete'&&suite?.bot?.enabled!==false;
    const training=suite?.bot?.preparation?.kind==='evolution'&&suite.bot.preparation.phase!=='complete'?suite.bot.preparation.progress:null;
    const age=t?Math.max(0,now-t.asOf):0,extra=active&&t?.active?Math.min(10000,age):0;
    const rng=m.rng||{},completed=number(rng.completed),total=number(rng.total);
    const percent=m.phase==='timing-shiny'&&completed!==null&&total>0?Math.min(100,Math.round(completed/total*100)):null;
    const target=m.name||emulator.spectator?.strategy?.campaign?.activeObjective?.id?.replace(/^Shiny /,'')||`Pokémon #${m.speciesId}`;
    const game=(emulator.game?.id||`pokemon-${suite.game||'firered'}`).replace(/^pokemon-/,'');
    const run=collection?.game===game&&collection.enabled?collection:null;
    const retry=run?.status==='recovering'&&[run.active?.requestId,`${run.active?.requestId}-source`].includes(m.id)?run.reason:null;
    const transition=run?.lastTransition;
    const cooling=run?.status==='waiting'&&!run.active&&transition?.from.speciesId===m.speciesId&&transition.retryAt;
    const remaining=transition?.retryAt?transition.retryAt*1000-now:null;
    const collectionNote=transition?`${transition.from.name} postponed: ${transition.reason}. ${transition.retryAt?transition.from.speciesId===m.speciesId&&run.active?.speciesId===m.speciesId&&m.state==='running'?'Retrying this target now.':remaining>0?`Next attempt in ${duration(remaining)}.`:'Retry queued after the current hunt.':'This target needs attention before another attempt.'}`:null;
    return {id:m.id,name:target,shiny:m.shiny==='required',sprite:`./assets/pokedex/${game}/${m.shiny==='required'?'shiny/':''}${m.speciesId}.png`,
      training,active,stale:active&&age>10000,state:retry?'recovering':cooling?'waiting':m.state||'paused',phase:m.phase,stage:stage(m.phase),collectionNote,
      now:descriptions[m.phase]||title(m.phase),
      why:retry||(cooling?run.reason:null)||m.reason||(m.phase==='preparing-sweet-scent'?'Setting up a party member with Sweet Scent so the bot can trigger encounters consistently.':m.phase==='planning-rng'?'Testing controller inputs in an isolated rehearsal before the live game advances.':m.phase==='timing-shiny'?'The live game is following the timing sequence that reproduced this encounter.':m.protected?'A shiny is protected. The bot will finish the capture and verify the save.':'Following the capture plan for this game and location.'),
      location:title(m.route),method:methods[rng.method]||methods[m.method]||title(rng.method||m.method),
      elapsedMs:t?t.elapsedMs+extra:number(m.elapsedMs),phaseElapsedMs:t&&(!t.partial||t.phaseElapsedMs>0||active)?t.phaseElapsedMs+extra:null,
      stages:labels.map((name,index)=>({name,ms:Object.entries(t?.stages||{}).filter(([phase])=>stage(phase)===index).reduce((sum,[,ms])=>sum+ms,0)+(index===stage(m.phase)?extra:0)})),
      timingKnown:Boolean(t)&&(!t.partial||active||Object.values(t.stages||{}).some(ms=>ms>0)),partial:t?.partial,percent,remainingSeconds:null,estimatedSeconds:number(rng.estimatedSeconds),
      encounters:number(m.encounters),resets:number(m.resets),caught:number(m.caught),quantity:number(m.quantity),
      protected:Boolean(m.protected),checks:number(rng.attempts),safari:m.safari,
      candidates:(rng.candidates||[]).map(c=>({method:methods[c.method]||title(c.method),seconds:number(c.expectedSeconds),qualified:c.qualified===true})),
      unmatched:rng.traits?.unmet||[],savedAt:suite.huntSave?.updatedAt||suite.save?.updatedAt||null};
  }
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let latest=null,lastKey='',collectionStatus=null;
  function paint(){
    if(typeof document==='undefined')return;
    const root=document.getElementById('journey-hunt-content');if(!root)return;
    const m=project(latest||{},Date.now(),collectionStatus),key=JSON.stringify(m&&{...m,elapsedMs:duration(m.elapsedMs),phaseElapsedMs:duration(m.phaseElapsedMs),stages:m.stages.map(s=>({...s,ms:duration(s.ms)}))});if(key===lastKey)return;lastKey=key;
    const methodsOpen=Boolean(root.querySelector('.hunt-methods[open]'));
    if(!m){root.innerHTML='<p class="hunt-idle">Hunt details appear here when a Pokémon search starts. Choose a target in Farming to begin.</p>';return;}
    const stat=(label,value)=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
    const count=n=>n===null?'—':n.toLocaleString('en-US');
    root.innerHTML=`${m.training?.required?`<div class="hunt-evolution"><img src="./assets/pokemon/items/rare_candy.png" width="24" height="24" alt=""><span>Evolution training</span><strong>Lv${esc(m.training.level)} / ${esc(m.training.required)}</strong><progress max="${Number(m.training.required)}" value="${Number(m.training.level)}" aria-label="Evolution training level"></progress></div><p class="hunt-last-label">Captured source Pokémon</p>`:m.state==='complete'?'<p class="hunt-last-label">Last completed hunt</p>':''}<div class="hunt-target"><img src="${esc(m.sprite)}" width="64" height="64" alt="${esc(m.name)} game sprite"><div><strong>${esc(m.name)}</strong><span>${m.shiny?'Shiny required':'Target hunt'}</span></div><span class="hunt-state" data-active="${m.active&&!m.stale}">${m.stale?'Reconnecting':title(m.state)}</span></div>
      <p class="hunt-explanation">${esc(m.why)}</p>
      ${m.collectionNote?`<p class="hunt-explanation hunt-collection-change" role="status">${esc(m.collectionNote)}</p>`:''}
      <div class="hunt-clocks">${stat('Hunt time',duration(m.elapsedMs))}${stat('This stage',duration(m.phaseElapsedMs))}</div>
      <ol class="hunt-stages">${m.stages.map((s,i)=>`<li data-current="${i===m.stage}" data-done="${i<m.stage}"><span>${esc(s.name)}</span><time>${m.timingKnown?duration(s.ms):'—'}</time></li>`).join('')}</ol>
      ${m.percent!==null?`<div class="hunt-progress"><progress max="100" value="${m.percent}" aria-label="Verified input sequence completed"></progress><span>${m.percent}% of inputs</span></div>`:''}
      <dl class="hunt-facts">${stat('Method',m.method)}${stat('Location',m.location||'Current game')}${m.estimatedSeconds!==null?stat('Plan duration at 5×',`≈ ${duration(m.estimatedSeconds*1000)}`):''}</dl>
      <dl class="hunt-counts">${stat('Encounters',count(m.encounters))}${stat('Resets',count(m.resets))}${stat('Caught',`${count(m.caught)} / ${count(m.quantity)}`)}</dl>
      ${m.protected&&m.state!=='complete'?'<p class="hunt-protected"><img src="./assets/pokemon/items/premier_ball.png" alt="" width="24" height="24">Shiny protected through capture and saving</p>':''}
      ${m.candidates.length?`<details class="hunt-methods" ${methodsOpen?'open':''}><summary>Compared methods</summary>${m.candidates.map(c=>`<p>${esc(c.method)} <span>${c.qualified?`≈ ${duration(c.seconds*1000)}`:'Not qualified'}</span></p>`).join('')}</details>`:''}
      ${m.unmatched.length?`<p class="hunt-explanation">Shiny takes priority. Unmatched preferences: ${esc(m.unmatched.join(', '))}.</p>`:''}
      ${m.partial?'<small class="hunt-timing-note">Stage breakdown measured since timing telemetry began. Hunt time includes earlier recorded activity.</small>':''}`;
  }
  globalThis.SuiteHuntPanel=Object.freeze({project,duration,update(emulator){latest=emulator;paint();},updateCollection(value){collectionStatus=value;paint();}});
  if(typeof document!=='undefined')setInterval(()=>{if(!document.hidden)paint();},1000);
})();
