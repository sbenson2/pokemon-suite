(() => {
  'use strict';
  const STATS = {hp:'HP',attack:'Attack',defense:'Defense',specialAttack:'Sp. Attack',specialDefense:'Sp. Defense',speed:'Speed'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const title = value => String(value).replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const option = (value,label) => `<option value="${escape(value)}">${escape(label)}</option>`;
  const types = mon => mon.types.map(t=>`<span class="dex-type" data-type="${escape(t)}">${escape(title(t))}</span>`).join('');
  function create({root,selectView,openGame}) {
    const $ = selector => root.querySelector(selector);
    let dex=null, game='firered', selected=1, page=0, shiny=false, loadRevision=0, loaded=false;
    let owner=false, activeViewer=null, view='pokedex', farmSignature='', busy=false, saved=[], draftKey='';
    const cache=new Map(), drafts=new Map(),botDefaults=new Map();
    window.addEventListener('pokemon-bot-settings-saved',event=>botDefaults.set(event.detail.game,event.detail.preferences));
    let review=null, savedSignature='', dataChanged=false;
    window.addEventListener('suite-data-updated',()=>{dataChanged=true;});
    const competitive=window.SuiteCompetitive.create({onChange:()=>{draftKey=crypto.randomUUID();$('#farm-plan')?.replaceChildren();}});
    const mon = () => dex?.species.find(p=>p.id===selected);
    const move = id => dex?.moves.find(m=>m.id===id);
    const number = p => String($('#dex-scope').value==='regional' ? p.regionalNumber : p.id).padStart(3,'0');
    async function api(path,body) {
      const response=await fetch(`./api/pokemon-farming/${path}`,body===undefined ? {cache:'no-store'} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();
      if(!response.ok || result.ok===false) throw new Error(result.error || 'The request could not be processed.');
      return result;
    }
    function remember() {
      if(!dex || !$('#farm-form') || farmSignature!==`${game}:${selected}`) return;
      drafts.set(farmSignature,readForm());
    }
    async function load(next) {
      remember();loaded=false;game=next;$('#dex-game').value=game;
      if(!['firered','leafgreen','emerald','crystal'].includes(game)) {
        ++loadRevision;dex=null;farmSignature='';$('#dex-grid').replaceChildren();$('#dex-detail').replaceChildren();
        const message='Game-specific Pokédex and bot tasks are not implemented for this title yet. Check its game details for available playback and save features, or choose another Pokédex.';
        $('#dex-message').textContent=message;$('#dex-subtitle').textContent='Selected game data unavailable';$('#suite-farming').textContent=message;return;
      }
      const revision=++loadRevision;$('#dex-message').textContent=`Loading ${$('#dex-game').selectedOptions[0].text} Pokédex…`;
      $('#dex-grid').replaceChildren();$('#dex-detail').replaceChildren();$('#suite-farming').innerHTML='<p class="suite-empty">Loading game information…</p>';
      try {
        const settings=await fetch(`./api/pokemon-suite/bot-settings?game=${encodeURIComponent(game)}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
        if(revision!==loadRevision)return;
        if(settings?.game===game&&settings.preferences)botDefaults.set(game,settings.preferences);
        {
          const response=await fetch(`./data/pokedex/${game}.json`,{cache:'no-store'});
          if(!response.ok) throw new Error('The Pokédex could not load. Reopen the tab to try again.');
          const value=await response.json();if(value.schema!=='pokemon-suite/pokedex/v1' || value.game!==game) throw new Error('Pokédex data is unavailable.');
          cache.set(game,value);
        }
        if(revision!==loadRevision)return;
        dex=cache.get(game);loaded=true;page=0;shiny=false;farmSignature='';
        selected=dex.defaultDex==='regional' ? dex.species.find(p=>p.regionalNumber===1).id : 1;
        $('#dex-scope').innerHTML=option('national','National Dex')+option('regional',dex.regionalLabel+' Dex');$('#dex-scope').value=dex.defaultDex;
        $('#dex-search').value='';$('#dex-availability').value='all';
        $('#dex-type').innerHTML=option('any','All types')+[...new Set(dex.species.flatMap(p=>p.types))].sort().map(t=>option(t,title(t))).join('');
        root.dataset.dexGame=game;$('#dex-subtitle').textContent=`${dex.label} locations, encounter levels, stats and learnsets.`;
        $('#dex-message').textContent='';renderGrid();renderDetail();renderFarm();
      } catch(error) {if(revision===loadRevision){loaded=false;$('#dex-message').textContent=error.message;$('#suite-farming').textContent=error.message;}}
    }
    function filtered() {
      const query=$('#dex-search').value.trim().toLocaleLowerCase().replace(/^#0*/,''), scope=$('#dex-scope').value, type=$('#dex-type').value, availability=$('#dex-availability').value;
      return dex.species.filter(p=>(scope!=='regional'||p.regionalNumber) && (type==='any'||p.types.includes(type)) && (availability==='all'||(availability==='encounter')===Boolean(p.encounters.length)) && (!query||p.name.toLocaleLowerCase().includes(query)||String(p.id)===query||number(p)===query||p.types.some(t=>t.includes(query))||p.encounters.some(e=>e.location.toLocaleLowerCase().includes(query))))
        .sort((a,b)=>scope==='regional'?a.regionalNumber-b.regionalNumber:a.id-b.id);
    }
    function renderGrid() {
      if(!dex)return;
      const list=filtered(),pages=Math.max(1,Math.ceil(list.length/24));page=Math.min(page,pages-1);
      const displayed=list.slice(page*24,(page+1)*24);
      $('#dex-count').textContent=`${list.length} Pokémon`;
      $('#dex-range').textContent=list.length ? `${page*24+1}–${Math.min((page+1)*24,list.length)}` : '';
      $('#dex-grid').innerHTML=displayed.map(p=>`<button type="button" class="dex-tile" data-species-id="${p.id}" aria-pressed="${p.id===selected}"><span class="dex-number">${number(p)}</span><img src="./${escape(p.sprite)}" alt="" width="72" height="72" loading="lazy"><strong>${escape(p.name)}</strong><span class="dex-tile-types">${p.types.map(title).join(' / ')}</span></button>`).join('') || '<p class="dex-no-results">No Pokémon match these filters.</p>';
      $('#dex-page').textContent=`Page ${page+1} of ${pages}`;$('#dex-previous').disabled=page===0;$('#dex-next').disabled=page>=pages-1;
    }
    function renderDetail() {
      const p=mon();if(!p)return;
      const neutralArtwork=dex.artwork!=='local-rom';
      const locationRows=p.encounters.map(e=>`<tr><td><strong>${escape(e.location)}</strong>${e.conditions.length?`<small>${escape(e.conditions.join('; '))}</small>`:''}</td><td>${escape(title(e.method))}${e.safari?'<small>Safari Ball</small>':''}</td><td>${e.minLevel===e.maxLevel?e.minLevel:`${e.minLevel}–${e.maxLevel}`}</td><td>${e.chance?e.chance+'%':'—'}</td></tr>`).join('');
      const gender=p.genderRate===-1?'Genderless':`${100-p.genderRate*12.5}% male / ${p.genderRate*12.5}% female`;
      $('#dex-detail').innerHTML=`<div class="dex-specimen"><div class="dex-sprite-well"><img src="./${escape(shiny?p.shinySprite:p.sprite)}" alt="${shiny?'Shiny ':''}${escape(p.name)}" width="160" height="160"><button type="button" id="dex-shiny" aria-pressed="${shiny}">${shiny?'Shiny sprite':'Normal sprite'}</button></div><div class="dex-identity"><span class="dex-national">National № ${String(p.id).padStart(3,'0')}</span><h2>${escape(p.name)}</h2><p>${escape(p.genus)}</p><div class="dex-types">${types(p)}</div><button type="button" id="dex-configure" class="suite-primary">Set farming requirements</button></div></div>
        <p class="dex-description">${escape(p.description)}</p>
        <section class="dex-section"><h3><img class="dex-section-icon" src="./assets/pokemon/items/rare_candy.png" width="24" height="24" alt=""> Base stats <span>${dex.label}</span></h3><div class="dex-stats">${Object.entries(STATS).map(([key,label])=>`<div><span>${label}</span><strong>${p.stats[key]}</strong><i><b style="width:${p.stats[key]/255*100}%"></b></i></div>`).join('')}</div></section>
        <dl class="dex-facts"><div><dt>Height / weight</dt><dd>${p.height} m / ${p.weight} kg</dd></div><div><dt>Gender</dt><dd>${gender}</dd></div><div><dt>Catch rate</dt><dd>${p.catchRate} / 255</dd></div><div><dt>Egg groups</dt><dd>${escape(p.eggGroups.join(', '))}</dd></div></dl>
        ${p.abilities.length?`<section class="dex-section"><h3>Abilities</h3>${p.abilities.map(a=>`<p class="dex-ability"><strong>${escape(a.name)}</strong> ${escape(a.description)}</p>`).join('')}</section>`:''}
        <section class="dex-section"><h3><img class="dex-section-icon" src="./assets/pokemon/items/town_map.png" width="24" height="24" alt=""> Where to find ${escape(p.name)}</h3>${locationRows?`<div class="dex-table-scroll"><table><thead><tr><th>Location</th><th>Method</th><th>Level</th><th>Rate</th></tr></thead><tbody>${locationRows}</tbody></table></div><p class="dex-footnote">Rates describe the encounter table, not catch success. Access depends on the selected save.</p>`:`<p class="dex-empty">No direct encounter or gift is listed in ${dex.label}.${p.evolvesFrom?' Check its earlier evolution and trading options.':' Trading or a special acquisition may be required.'}</p>`}</section>
        <section class="dex-section"><h3><img class="dex-section-icon" src="./assets/pokemon/items/moon_stone.png" width="24" height="24" alt=""> Evolution</h3>${p.evolvesFrom?`<button type="button" class="dex-evolution" data-evolution="${p.evolvesFrom}">From ${escape(dex.species.find(s=>s.id===p.evolvesFrom)?.name||'earlier form')}</button>`:''}${p.evolutions.map(e=>`<button type="button" class="dex-evolution" data-evolution="${e.speciesId}"><strong>${escape(e.name)}</strong><span>${escape(e.condition)}</span></button>`).join('')||(!p.evolvesFrom?'<p class="dex-empty">No evolution in this game.</p>':'')}</section>
        <details class="dex-section dex-moves"><summary>Moves in ${dex.label} <span>${new Set(p.learnset.map(m=>m.moveId)).size}</span></summary><div class="dex-table-scroll"><table><thead><tr><th>Move</th><th>Learn</th><th>Type</th><th>Power</th><th>PP</th></tr></thead><tbody>${p.learnset.map(m=>{const info=move(m.moveId);return `<tr><td>${escape(info.name)}</td><td>${m.method==='level-up'?'Lv. '+m.level:escape(m.machine||title(m.method))}</td><td>${escape(title(info.type))}</td><td>${info.power>1?info.power:info.power===1?'Effect':'—'}</td><td>${info.pp}</td></tr>`;}).join('')}</tbody></table></div></details>`;
      if(neutralArtwork){$('#dex-shiny').hidden=true;$('#dex-detail .dex-description').textContent='Add a supported local ROM to display this game’s artwork.';}
      $('#dex-detail .dex-description').hidden=!neutralArtwork&&!p.description;
    }
    function field(id,label,content,extra='') {return `<label class="farm-field" for="${id}"><span>${label}</span><select id="${id}" ${extra}>${content}</select></label>`;}
    function numeric(id,label,value,min,max,placeholder='') {return `<label class="farm-field" for="${id}"><span>${label}</span><input id="${id}" type="number" min="${min}" max="${max}" step="1" value="${value}" placeholder="${placeholder}"></label>`;}
    function renderFarm() {
      const p=mon();if(!p || dex.game!==game)return;
      const signature=`${game}:${selected}`;if(farmSignature===signature)return;farmSignature=signature;draftKey=crypto.randomUUID();
      const locationOptions=option('any','Choose a suitable location')+p.encounters.map(e=>option(e.id,`${e.location} · ${title(e.method)} · Lv. ${e.minLevel}–${e.maxLevel}`)).join('');
      const learnable=[...new Set(p.learnset.map(m=>m.moveId))].map(move).sort((a,b)=>a.name.localeCompare(b.name));
      const ballOptions=option('any','Any suitable ball')+dex.balls.map(b=>option(b.id,b.name)).join('');
      const genders=p.genderRate===-1?['genderless']:p.genderRate===0?['male']:p.genderRate===8?['female']:['male','female'];
      $('#suite-farming').innerHTML=`<div class="farm-target"><img src="./${escape(p.sprite)}" alt="" width="80" height="80"><div><span>${escape(dex.label)} · National № ${String(p.id).padStart(3,'0')}</span><h2>${escape(p.name)}</h2><div class="dex-types">${types(p)}</div></div><button type="button" id="farm-change" class="suite-secondary">Choose Pokémon</button></div>
        <div class="farm-setup"><form id="farm-form"><fieldset><legend><img class="suite-section-sprite" src="./assets/pokemon/items/ultra_ball.png" width="28" height="28" alt="">Find and catch</legend><div class="farm-fields"><div class="farm-wide">${field('farm-location','Location and method',locationOptions)}</div>${numeric('farm-quantity','New Pokémon to find',1,1,99)}<label>Nickname<input id="farm-nickname" maxlength="10" pattern="[A-Za-z]{1,10}" placeholder="Keep species name" aria-describedby="farm-nickname-help"></label>${field('farm-shiny','Shiny',option('any','Any')+option('required','Shiny required'))}${field('farm-ball','Poké Ball',ballOptions)}${field('farm-ball-rule','Ball requirement',option('required','Required')+option('preferred','Preferred'))}${numeric('farm-level-min','Encounter level · minimum',1,1,100)}${numeric('farm-level-max','Encounter level · maximum',100,1,100)}</div><p class="farm-help" id="farm-nickname-help">Keep the species name for a Pokémon its recipient can name. Optional nicknames use up to 10 letters. Each request catches a new Pokémon; existing shinies stay in your collection.</p><p class="farm-help">Shiny required prioritizes catching the shiny over other traits and ball settings, including use of a Master Ball if available. Safari encounters use Safari Balls.</p></fieldset>
        <fieldset><legend><img class="suite-section-sprite" src="./assets/pokemon/items/rare_candy.png" width="28" height="28" alt="">Attributes</legend><div class="farm-fields">${field('farm-nature','Nature',option('any',dex.natures.length?'Any nature':'No natures in Crystal')+dex.natures.map(n=>option(n.id,n.name+(n.increased?` (+${STATS[n.increased]}, −${STATS[n.decreased]})`:' (neutral)'))).join(''),dex.natures.length?'':'disabled')}${field('farm-gender','Gender',option('any','Any')+genders.map(g=>option(g,title(g))).join(''))}${field('farm-ability','Ability',option('any',p.abilities.length?'Any available ability':'No abilities in Crystal')+p.abilities.map(a=>option(a.id,a.name)).join(''),p.abilities.length?'':'disabled')}</div>
        <details class="farm-advanced"><summary>${dex.generation===2?'Minimum DVs':'Minimum IVs'}</summary><p class="farm-help">Leave blank for no minimum.${dex.generation===2?' HP DV is derived from the other DVs.':' These requirements filter encounters; they do not change stats.'}</p><div class="farm-iv-grid">${Object.entries(dex.generation===2?{attack:'Attack',defense:'Defense',special:'Special',speed:'Speed'}:STATS).map(([key,label])=>`<label>${label}<input type="number" data-farm-${dex.generation===2?'dv':'iv'}="${key}" min="0" max="${dex.generation===2?15:31}" step="1" placeholder="Any" aria-label="Minimum ${label} ${dex.generation===2?'DV':'IV'}"></label>`).join('')}</div></details></fieldset>
        <details class="farm-advanced farm-final"><summary>Final level, moves and held item</summary><div class="farm-fields">${numeric('farm-final-level','Final level','',1,100,'As caught')}${field('farm-held-item','Held item',option('any','None required')+(dex.heldItems||[]).map(i=>option(i.id,i.name)).join(''))}</div><div class="farm-fields">${[0,1,2,3].map(i=>field('farm-move-'+i,'Move '+(i+1),option('any','No requirement')+learnable.map(m=>option(m.id,m.name)).join(''))).join('')}</div><p class="farm-help">Moves must coexist in this game. The plan must account for leveling, evolution, breeding, TMs and tutors.</p></details>
        <fieldset><legend><img class="suite-section-sprite" src="./assets/pokemon/items/timer_ball.png" width="28" height="28" alt="">Limits and completion</legend><div class="farm-fields">${numeric('farm-limit-encounters','Maximum encounters',1000,1,1000000)}${numeric('farm-limit-minutes','Maximum minutes',60,1,10080)}${numeric('farm-limit-balls','Keep at least this many balls',10,0,999)}${numeric('farm-limit-spend','Maximum in-game spending',5000,0,999999)}<div class="farm-wide">${field('farm-after','After completion',option('stop-save','Stop and save')+option('prepare-trade','Save and prepare a trade'))}</div></div></fieldset>
        <div class="farm-actions"><button type="submit" id="farm-preview" class="suite-secondary">Preview request</button><button type="submit" id="farm-save" class="suite-primary" ${owner?'':'disabled'}>Save farming request</button></div><p id="farm-message" class="farm-message" role="status" aria-live="polite"></p><div id="farm-plan"></div></form><section id="farm-competitive" class="farm-competitive" aria-label="Champions competitive recommendations"></section></div>
        <section class="farm-saved"><h2><img class="suite-section-sprite" src="./assets/pokemon/items/poke_ball.png" width="28" height="28" alt="">Hunts</h2><p>Start or resume a saved request. Wild hunts continue in the current game and save each new catch.</p><div id="farm-requests"></div></section>`;
      if(drafts.has(signature))restoreForm(drafts.get(signature));else applyDefaults(botDefaults.get(game));renderSaved();
      competitive.mount($('#farm-competitive'),{id:p.id,name:p.name,game:dex.label},drafts.get(signature)?.competitive);
    }
    function readForm() {
      const val=id=>$('#'+id).value, num=id=>Number(val(id));
      const stats=type=>Object.fromEntries([...root.querySelectorAll(`[data-farm-${type}]`)].filter(i=>i.value!=='').map(i=>[i.dataset[type==='iv'?'farmIv':'farmDv'],Number(i.value)]));
      return {schema:'pokemon-suite/farming-request/v2',competitive:competitive.get(),game,speciesId:selected,quantity:num('farm-quantity'),nickname:val('farm-nickname')||null,locationId:val('farm-location'),shiny:val('farm-shiny'),natures:val('farm-nature')==='any'?[]:[val('farm-nature')],gender:val('farm-gender'),abilityId:val('farm-ability')==='any'?null:num('farm-ability'),ball:{id:val('farm-ball'),requirement:val('farm-ball-rule')},minIvs:stats('iv'),minDvs:stats('dv'),encounterLevel:{min:num('farm-level-min'),max:num('farm-level-max')},finalLevel:val('farm-final-level')===''?null:num('farm-final-level'),moves:[0,1,2,3].map(i=>val('farm-move-'+i)).filter(v=>v!=='any').map(Number),heldItemId:val('farm-held-item')==='any'?null:num('farm-held-item'),limits:{maxEncounters:num('farm-limit-encounters'),maxMinutes:num('farm-limit-minutes'),minBalls:num('farm-limit-balls'),maxSpend:num('farm-limit-spend')},afterCompletion:val('farm-after')};
    }
    function applyDefaults(p){
      if(!p)return;
      const values={'farm-shiny':p.shiny,'farm-ball':p.ball.id,'farm-ball-rule':p.ball.requirement,'farm-nature':p.natures[0]||'any','farm-gender':p.gender,'farm-after':p.afterCompletion,'farm-limit-encounters':p.limits.maxEncounters,'farm-limit-minutes':p.limits.maxMinutes,'farm-limit-balls':p.limits.minBalls,'farm-limit-spend':p.limits.maxSpend};
      for(const [id,value] of Object.entries(values)){
        const field=$('#'+id);if(!field)continue;
        field.value=field.tagName==='SELECT'&&![...field.options].some(o=>o.value===String(value))?'any':value;
      }
      for(const [kind,values] of [['iv',p.minIvs],['dv',p.minDvs]])for(const [key,value] of Object.entries(values)){
        const field=root.querySelector(`[data-farm-${kind}="${key}"]`);if(field)field.value=value;
      }
    }
    function restoreForm(r) {
      if(!r)return;
      const values={'farm-quantity':r.quantity,'farm-nickname':r.nickname??'','farm-location':r.locationId,'farm-shiny':r.shiny,'farm-nature':r.natures[0]||'any','farm-gender':r.gender,'farm-ability':r.abilityId??'any','farm-ball':r.ball.id,'farm-ball-rule':r.ball.requirement,'farm-level-min':r.encounterLevel.min,'farm-level-max':r.encounterLevel.max,'farm-final-level':r.finalLevel??'','farm-held-item':r.heldItemId??'any','farm-limit-encounters':r.limits.maxEncounters,'farm-limit-minutes':r.limits.maxMinutes,'farm-limit-balls':r.limits.minBalls,'farm-limit-spend':r.limits.maxSpend,'farm-after':r.afterCompletion};
      for(const [id,value] of Object.entries(values))if($('#'+id))$('#'+id).value=value;
      r.moves.forEach((id,i)=>$('#farm-move-'+i).value=id);
      for(const [type,values] of [['iv',r.minIvs],['dv',r.minDvs]])for(const [key,value] of Object.entries(values)) {const input=root.querySelector(`[data-farm-${type}="${key}"]`);if(input)input.value=value;}
    }
    const startLabel=(plan,active)=>active?.state==='running'?'Hunt running':active?.state==='queued'?'Hunt queued':active?.state==='preparing-evolution'?'Preparing evolution':active?.state==='complete'?'Hunt complete':plan.canContinue?'Prepare evolution':active?.state==='waiting-for-evolution'?'Evolution pending':active?.execution?'Resume hunt':plan.canStartSource?`Start ${plan.sourceStage.name} step`:'Start hunt';
    const canStart=(plan,active)=>Boolean((plan.canStart||plan.canStartSource||plan.canContinue)&&!['running','queued','complete','preparing-evolution'].includes(active?.state)&& (active?.state!=='waiting-for-evolution'||plan.canContinue));
    function renderResources(plan){
      const resources=plan.acquisition?.resources||[];
      if(!resources.length)return '';
      return `<details class="farm-advanced farm-evolution-supplies" open><summary>Evolution and final supplies</summary><ul>${resources.map(r=>`<li><strong>${r.quantity} × ${escape(r.item.name)}</strong> · ${escape({firered:'FireRed',leafgreen:'LeafGreen',emerald:'Emerald',crystal:'Crystal'}[r.game]||r.game)} · ${r.consumed?'Consumed by evolution':'Held by the finished Pokémon'}${r.item.sources?.length?`<br>${escape([...new Set(r.item.sources.map(s=>s.kind==='wild-held-item'?`${s.name}, wild held item`:title((s.map||'').replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' '))))].slice(0,5).join('; '))}`:''}</li>`).join('')}</ul><p class="farm-help">Check the current bag and unclaimed items before starting. One-time gifts, trade partners and game access must be verified. Evolution items and the finished held item are counted separately.</p></details>`;
    }
    function renderPlan(plan,id=null) {
      review={plan,id};
      const active=saved.find(r=>r.id===id);const label=startLabel(plan,active);
      $('#farm-plan').innerHTML=`<section class="farm-preview"><h3>${escape(plan.pokemon.name)} in ${escape(plan.game)}</h3><p>${escape(plan.location?`${plan.location.location} · ${title(plan.location.method)}`:plan.acquisition?`Destination: ${plan.game} · Source: ${plan.acquisition.source.name} in ${plan.acquisition.source.gameLabel||plan.acquisition.source.game}`:`${plan.locations.length} possible acquisition locations`)}</p>${plan.competitive?`<p class="farm-competitive-summary"><strong>Champions ${escape(plan.competitive.format)} · ${escape(plan.competitive.pokemon)}</strong><br>${escape(plan.competitive.name)} · ${escape(plan.competitive.selection.nature)}<br>${escape(plan.competitive.selection.moves.join(' / '))}</p>`:''}<ol>${plan.steps.map(s=>`<li>${escape(s)}</li>`).join('')}</ol>${plan.competitive?`<h4>Champions preparation after the catch</h4><ol>${plan.competitive.steps.map(s=>`<li>${escape(s)}</li>`).join('')}</ol>`:''}${renderResources(plan)}<h4>Hunting setup</h4><ul>${plan.limitations.map(s=>`<li>${escape(s)}</li>`).join('')}</ul><button type="button" id="farm-start" class="suite-primary" ${owner && canStart(plan,active) ? '' : 'disabled'}>${label}</button></section>`;
    }
    function renderSaved() {
      const target=$('#farm-requests');if(!target)return;
      const records=saved.filter(r=>r.request.game===game);
      const key=JSON.stringify([records,owner]);if(savedSignature===key && target.children.length)return;savedSignature=key;
      target.innerHTML=records.map(r=>{
        const e=r.execution, running=['running','queued','preparing-evolution'].includes(r.state), complete=r.state==='complete';
        const huntPhase=e?.rng?.phase==='waiting'?'Timing shiny encounter':e?.rng?.phase==='calibrating'?'Calibrating encounter timing':title(e?.phase||'');
        const methodNames={'current-state':'Current-state timing','teachy-tv':'Teachy TV + Sweet Scent','title-seed':'Timed title seed','seed-search':'New-seed search','calibrated-static':'Timed static encounter','automatic':'Selecting fastest method'};
        const rng=e?.rng,method=rng?`${methodNames[rng.method]||title(rng.method||'calibrated-static')}${Number.isFinite(rng.estimatedSeconds)?` · ${Math.ceil(rng.estimatedSeconds)} s encounter plan at 5×`:''}`:'';
        const progress=e?`${e.sourceName?`${e.sourceName}: ${e.sourceCaught} saved · `:''}${Number.isInteger(e.caught)?`${e.caught}/${r.request.quantity} ${r.plan.pokemon.name} saved · `:''}${(e.encounters??0).toLocaleString()} encounters · ${Math.floor((e.elapsedMs??0)/60000)} min · ${r.state==='running'?huntPhase:title(r.state)}`:r.plan.canStart?'Ready to start':r.plan.limitations[0];
        return `<article class="farm-saved-row"><img src="./${escape(r.plan.pokemon.sprite)}" alt="" width="64" height="64"><div><strong>${escape(r.plan.pokemon.name)}</strong><span>${r.request.competitive?'Champions '+escape(r.request.competitive.format)+' · ':''}${r.request.quantity} new · ${r.request.shiny==='required'?'Shiny required':'Any shininess'}${r.request.natures.length?' · '+escape(r.request.natures.map(title).join(', ')):''}</span><small>${escape(progress)}</small>${method?`<small>${escape(method)}</small>`:''}${rng?.traits?.unmet?.length?`<p class="farm-run-reason">Shiny preserved; unmatched preferences: ${escape(rng.traits.unmet.join(', '))}</p>`:''}${e?.reason?`<p class="farm-run-reason">${escape(e.reason)}</p>`:''}</div><div class="farm-run-actions">${running?`<button type="button" class="suite-secondary" data-farm-stop="${escape(r.id)}">${r.state==='preparing-evolution'?'Stop preparation':'Stop hunt'}</button>`:!complete?`<button type="button" class="suite-primary" data-farm-start="${escape(r.id)}" ${owner&&canStart(r.plan,r)?'':'disabled'}>${escape(startLabel(r.plan,r))}</button>`:''}${e?`<button type="button" class="suite-text-button" data-farm-view="${escape(r.request.game)}">Open hunt viewer</button>`:''}<button type="button" class="suite-text-button" data-farm-open="${escape(r.id)}">Review</button><button type="button" class="suite-text-button" data-farm-remove="${escape(r.id)}" ${running?'disabled':''}>Remove</button></div></article>`;
      }).join('')||`<p class="suite-empty">${owner?'No prepared requests for '+escape(dex?.label||game)+'.':'Sign in as the host owner to save farming requests.'}</p>`;
    }
    async function startHunt(id=null) {
      if(busy||!owner)return;busy=true;
      $('#farm-message').textContent='Starting the saved hunt request…';
      try {
        if(!id){if(!review)throw new Error('Preview the request first.');id=review.id;
          if(!id){const r=await api('requests',{request:review.plan.request,idempotencyKey:draftKey});id=r.request.id;review.id=id;}}
        const result=await api('start',{id});
        $('#farm-message').textContent=result.stage==='evolution-preparation'?'Preparing the evolution’s game prerequisites using the saved Pokémon. Native transfers remain pending.':result.stage==='source'?'Acquisition step running. Evolution and required trades remain pending after the source Pokémon is saved.':result.session?.mission?.state==='complete'?'This hunt is complete.':'Hunt running. You can open its viewer or stop and resume it here.';
        await refreshSaved();
      }catch(e){$('#farm-message').textContent=e.message;}
      finally{busy=false;}
    }
    async function refreshSaved() {
      if(!owner)return;
      try {saved=(await api('requests')).requests||[];renderSaved();const active=saved.find(r=>r.id===review?.id),start=$('#farm-start');if(start&&active){start.textContent=startLabel(active.plan,active);start.disabled=!owner||!canStart(active.plan,active);}}catch(error){if($('#farm-message'))$('#farm-message').textContent=error.message;}
    }
    $('#dex-game').addEventListener('change',()=>load($('#dex-game').value,true));
    for(const id of ['dex-search','dex-scope','dex-type','dex-availability'])$('#'+id).addEventListener(id==='dex-search'?'input':'change',()=>{page=0;renderGrid();});
    $('#dex-previous').addEventListener('click',()=>{page--;renderGrid();});$('#dex-next').addEventListener('click',()=>{page++;renderGrid();});
    root.addEventListener('click',async event=>{
      const button=event.target.closest('button');if(!button)return;
      const id=button.dataset.speciesId||button.dataset.evolution;
      if(id){remember();selected=Number(id);shiny=false;const catalogScroll=$('#dex-grid').scrollTop;renderGrid();$('#dex-grid').scrollTop=catalogScroll;renderDetail();$('#dex-detail').scrollTop=0;renderFarm();}
      if(button.id==='dex-shiny'){shiny=!shiny;renderDetail();}
      if(button.id==='dex-configure'){renderFarm();if(shiny){$('#farm-shiny').value='required';remember();}selectView('tasks');$('#farm-location')?.focus({preventScroll:true});}
      if(button.id==='farm-change')selectView('pokedex');
      if(button.id==='farm-start'||button.dataset.farmStart)await startHunt(button.dataset.farmStart||null);
      if(button.dataset.farmStop&&!busy){busy=true;try{await api('stop',{id:button.dataset.farmStop});$('#farm-message').textContent='Hunt stopped and saved. Resume hunt continues from this point.';await refreshSaved();}catch(e){$('#farm-message').textContent=e.message;}finally{busy=false;}}
      if(button.dataset.farmView){try{await openGame?.(button.dataset.farmView);}catch(e){$('#farm-message').textContent=e.message;}}
      if(button.dataset.farmRemove){try{await api('remove',{id:button.dataset.farmRemove});await refreshSaved();}catch(e){$('#farm-message').textContent=e.message;}}
      if(button.dataset.farmOpen){const r=saved.find(r=>r.id===button.dataset.farmOpen);if(r){remember();selected=r.request.speciesId;drafts.set(`${game}:${selected}`,r.request);farmSignature='';renderGrid();renderDetail();renderFarm();renderPlan(r.plan,r.id);}}
    });
    root.addEventListener('input',event=>{if(event.target.closest('#farm-form')){draftKey=crypto.randomUUID();$('#farm-plan').replaceChildren();}});
    root.addEventListener('change',event=>{if(event.target.closest('#farm-form')){draftKey=crypto.randomUUID();$('#farm-plan').replaceChildren();}});
    root.addEventListener('submit',async event=>{
      if(event.target.id!=='farm-form')return;event.preventDefault();if(busy)return;
      if(!owner){$('#farm-message').textContent='Host owner access is required to preview or save requests.';return;}
      busy=true;const key=farmSignature,request=readForm(),saving=event.submitter?.id==='farm-save';drafts.set(key,request);
      $('#farm-message').textContent=saving?'Saving requirements…':'Checking requirements…';$('#farm-save').disabled=true;$('#farm-preview').disabled=true;
      try {
        const result=saving?await api('requests',{request,idempotencyKey:draftKey}):await api('preview',request);
        if(farmSignature!==key)return;
        renderPlan(saving?result.request.plan:result.plan,saving?result.request.id:null);$('#farm-message').textContent=saving?'Farming request saved. No hunt has been started.':'Requirements checked. Review the remaining prerequisites below.';
        if(saving){await refreshSaved();window.dispatchEvent(new CustomEvent('pokemon-farming-request-saved',{detail:{game}}));}
      }catch(error){if(farmSignature===key)$('#farm-message').textContent=error.message;}
      finally {busy=false;if($('#farm-save'))$('#farm-save').disabled=!owner;if($('#farm-preview'))$('#farm-preview').disabled=!owner;}
    });
    setInterval(()=>{if(view==='tasks'&&!root.hidden&&!document.hidden&&!busy)void refreshSaved();},2000);
    async function refreshArtwork() {
      const currentGame=game,currentRevision=loadRevision;
      try {
        const response=await fetch(`./api/rom-art-status?game=${encodeURIComponent(game)}`,{cache:'no-store'});
        if(!response.ok)return;
        const status=await response.json();
        if(!loaded||game!==currentGame||loadRevision!==currentRevision||!dex)return;
        if(status.artwork===dex.artwork&&status.sha256===dex.sha256)return;
        remember();Object.assign(dex,{sha256:null},status);farmSignature='';
        renderGrid();renderDetail();renderFarm();
      } catch { /* Existing facts and draft requirements remain usable offline. */ }
    }
    return {
      async show(next){view=next;if(dataChanged){dataChanged=false;loaded=false;}if(!loaded)await load(game);else await refreshArtwork();if(view==='tasks'&&loaded){renderFarm();await refreshSaved();}},
      update(state){owner=Boolean(state.controlAvailable);const nextGame=state.game||null;if(activeViewer!==state.selected){activeViewer=state.selected;if(nextGame&&nextGame!==game){if(loaded)load(nextGame);else game=nextGame;}}if($('#farm-save'))$('#farm-save').disabled=!owner||busy;if($('#farm-preview'))$('#farm-preview').disabled=!owner||busy;},
    };
  }
  window.SuiteFarming={create};
})();
