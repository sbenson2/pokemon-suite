(() => {
  'use strict';
  const STATS = {hp:'HP',attack:'Attack',defense:'Defense',specialAttack:'Sp. Attack',specialDefense:'Sp. Defense',speed:'Speed'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const option = (value,label) => `<option value="${escape(value)}">${escape(label)}</option>`;
  const field = (id,label,options) => `<label class="farm-field" for="${id}"><span>${label}</span><select id="${id}">${options}</select></label>`;
  const clone = value => value ? JSON.parse(JSON.stringify(value)) : null;
  let pending;
  function load() {
    if (!pending) pending = fetch('./data/champions.json',{cache:'no-cache'}).then(r=>{
      if (!r.ok) throw Error('Recommendations could not be loaded.');
      return r.json();
    }).catch(error=>{pending=null;throw error;});
    return pending;
  }
  function create({onChange}) {
    let root, source, data, selection=null, format='doubles', revision=0;
    const $ = selector => root?.querySelector(selector);
    const available = () => data.presets.filter(p=>p.format===format && p.sourceSpeciesIds.includes(source.id));
    const preset = () => available().find(p=>p.id===$('#competitive-build')?.value);
    function changed() {onChange?.();}
    function status(message) {if($('#competitive-status')) $('#competitive-status').textContent=message;}
    function selectedStatus() {
      status(selection ? 'Champions build attached to this request.' : 'Choose alternatives, then attach this build to the farming request.');
      if($('#competitive-remove')) $('#competitive-remove').hidden=!selection;
    }
    function resetSelection() {if(selection){selection=null;changed();}selectedStatus();}
    function renderSpread() {
      const spread=preset()?.spreads[Number($('#competitive-spread')?.value)||0];if(!spread)return;
      $('#competitive-points').innerHTML=Object.entries(STATS).map(([key,label])=>`<div><dt>${label}</dt><dd>${spread[key]}</dd></div>`).join('');
    }
    function renderBuild(restore=false) {
      const p=preset();const body=$('#competitive-details');
      if(!p){body.innerHTML=`<p class="competitive-empty">No sourced ${format==='singles'?'Singles':'Doubles'} build is available for ${escape(source.name)} or a supported evolution in this snapshot. You can still save a custom catch request.</p><p class="farm-help">This is a gap in recommendations, not a decision about Ranked Battle eligibility.</p>`;return;}
      const choices=(id,label,values)=>field(id,label,values.length?values.map(v=>option(v,v)).join(''):option('','Choose in Champions'));
      body.innerHTML=`<div class="competitive-target"><h4>${escape(p.pokemon)}</h4><p>${p.targetSpeciesId===source.id ? 'Review any form and item requirements before battle.' : `Farm ${escape(source.name)}; prepare its ${escape(p.pokemon)} evolution for battle.`}</p></div>
        <div class="competitive-attributes">${choices('competitive-nature','Champions nature',p.natures)}${choices('competitive-ability','Champions ability',p.abilities)}${choices('competitive-item','Champions held item',p.items)}</div>
        <div class="farm-fields competitive-moves">${p.moves.map((values,i)=>choices('competitive-move-'+i,'Battle move '+(i+1),values)).join('')}</div>
        <div class="competitive-spread-heading">${field('competitive-spread','Stat-point spread',p.spreads.map((s,i)=>option(i,`Spread ${i+1} · ${Object.values(s).reduce((a,b)=>a+b,0)} / 66 points`)).join(''))}<p>Champions stat points<br>Up to 32 per stat · 66 total</p></div><dl id="competitive-points" class="competitive-points"></dl>
        <p class="competitive-source"><a id="competitive-source" href="${escape(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">Smogon Champions build</a><span>Community recommendation · checked ${escape(data.checkedAt.slice(0,10))}</span></p>
        <p class="farm-help">Choose a set for the rest of your team. Confirm the selected move combination, visitor eligibility, and full team in Champions before online play.</p>
        <div class="competitive-actions"><button type="button" id="competitive-apply" class="suite-primary">Use this Champions build</button><button type="button" id="competitive-remove" class="suite-text-button" hidden>Remove build</button></div><p id="competitive-status" class="farm-message" role="status" aria-live="polite"></p>`;
      if(restore && selection){
        for(const key of ['nature','ability','item']) $('#competitive-'+key).value=selection[key]||'';
        selection.moves.forEach((m,i)=>$('#competitive-move-'+i).value=m);
        $('#competitive-spread').value=Math.max(0,p.spreads.findIndex(s=>Object.keys(STATS).every(k=>s[k]===selection.statPoints[k])));
      }
      renderSpread();selectedStatus();
    }
    function render() {
      if(data.availability==='not-bundled'){
        root.innerHTML='<header class="competitive-heading"><div><h3>Competitive preparation</h3></div></header><p class="farm-help">Choose the nature, ability, IVs, moves, and capture preferences for your own build in the fields below. Community presets are not included in this edition.</p>';
        return;
      }
      const entries=available();
      const stale=Date.now()>=Date.parse(data.regulation.reviewAfter);
      root.innerHTML=`<header class="competitive-heading"><div><h3>Pokémon Champions</h3><p>Recommended setups for online play</p></div><span class="competitive-regulation">${stale?'Review required':'Regulation '+escape(data.regulation.id)}</span></header>
        <p class="competitive-boundary">Catch ${escape(source.name)} in ${escape(source.game)} with your chosen shiny and ball settings. Prepare battle stats, nature, moves, and ability in Champions. Source-game IVs are not used in Champions.</p>
        <div class="competitive-picker">${field('competitive-format','Battle format',option('doubles','Doubles · VGC')+option('singles','Singles · Battle Stadium'))}${entries.length?field('competitive-build','Recommended build',entries.map(p=>option(p.id,p.pokemon+' · '+p.name)).join('')):''}</div>
        <p class="competitive-freshness">${stale?'The regulation has changed since this snapshot. Recheck these builds.':`Regulation ${escape(data.regulation.next)} starts ${escape(data.regulation.reviewAfter.slice(0,10))}; these builds need review at that change.`} <a href="${escape(data.regulation.sourceUrl)}" target="_blank" rel="noopener noreferrer">Rules update</a></p><div id="competitive-details"></div>
        <details class="competitive-preparation"><summary>What to prepare where</summary><ul><li>Source game: species, shiny status, ball, and any extra catch requirements you choose below.</li><li>Evolution and transfer: verify the route to Pokémon HOME and Champions for this individual. A ROM catch alone does not establish transfer eligibility.</li><li>Champions: apply the selected build through training, equip its item, and check the complete team against the current rules.</li></ul><a href="${escape(data.mechanics.trainingUrl)}" target="_blank" rel="noopener noreferrer">Champions training and HOME details</a></details>`;
      $('#competitive-format').value=format;
      if(selection && entries.some(p=>p.id===selection.presetId)) $('#competitive-build').value=selection.presetId;
      renderBuild(Boolean(selection));
    }
    function apply() {
      const p=preset();if(!p)return;
      const moves=[0,1,2,3].map(i=>$('#competitive-move-'+i).value);
      if(new Set(moves).size!==4){status('Choose four different battle moves.');return;}
      selection={destination:'pokemon-champions',format,presetId:p.id,catalogRevision:data.revision,
        nature:$('#competitive-nature').value,ability:$('#competitive-ability').value||null,
        item:$('#competitive-item').value||null,moves,statPoints:clone(p.spreads[Number($('#competitive-spread').value)])};
      changed();selectedStatus();
    }
    return {
      get:()=>clone(selection),
      async mount(container, context, saved) {
        root=container;source=context;selection=clone(saved);format=selection?.format||'doubles';
        const token=++revision;root.innerHTML='<p class="farm-help">Loading Champions recommendations…</p>';
        root.onchange=event=>{
          if(event.target.id==='competitive-format'){resetSelection();format=event.target.value;render();}
          else if(event.target.id==='competitive-build'){resetSelection();renderBuild();}
          else {resetSelection();if(event.target.id==='competitive-spread')renderSpread();}
        };
        root.onclick=event=>{
          const id=event.target.closest('button')?.id;
          if(id==='competitive-apply')apply();
          if(id==='competitive-remove'){selection=null;changed();selectedStatus();}
        };
        try {
          data=await load();if(token!==revision)return;
          if(selection && (selection.catalogRevision!==data.revision || !available().some(p=>p.id===selection.presetId))){
            // Preserve stale intent for validation; do not silently drop a saved build.
            root.innerHTML='<p class="farm-help">This saved build needs review because the recommendation catalog changed.</p><button type="button" id="competitive-reload" class="suite-secondary">Choose a current build</button>';
            $('#competitive-reload').onclick=()=>{selection=null;changed();render();};return;
          }
          render();
        } catch(error) {if(token===revision)root.innerHTML=`<p class="farm-help">${escape(error.message)} Existing saved build settings are preserved.</p><button type="button" id="competitive-retry" class="suite-secondary">Retry recommendations</button>`;
          if(token===revision)$('#competitive-retry').onclick=()=>this.mount(root,source,selection);
        }
      },
    };
  }
  window.SuiteCompetitive={create};
})();
