/* Saved, game-specific defaults for new tasks; campaign rules remain explicit. */
(() => {
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stats={hp:'HP',attack:'Attack',defense:'Defense',specialAttack:'Sp. Attack',specialDefense:'Sp. Defense',speed:'Speed'};
  const option=(v,label)=>`<option value="${escape(v)}">${escape(label)}</option>`;
  const select=(id,label,options)=>`<label><span>${label}</span><select id="bot-pref-${id}">${options}</select></label>`;
  const numeric=(id,label,min,max)=>`<label><span>${label}</span><input id="bot-pref-${id}" type="number" min="${min}" max="${max}" step="1" required></label>`;
  function create({root}) {
    const host=root.querySelector('#suite-bot-preferences'),profile=root.querySelector('#suite-bot-profile');
    let game=null,revision=0,owner=false,loaded=null,saving=false,profileKey='';
    const $=s=>host.querySelector(s);
    function renderProfile(current,session){
      if(session?.campaign){profile.replaceChildren();profileKey="";return;}
      const key=JSON.stringify([current,session?.gameProgress?.leagueComplete,session?.spectator?.party?.map(p=>[p.speciesName,p.sprite,p.level,p.shiny])]);
      if(key===profileKey)return;profileKey=key;
      const bot=session?.bot,fire=current==='firered',emerald=current==='emerald';
      const title=fire?'Postgame and Pokémon collection':emerald?'Evolution and trade partner':'Manual game';
      const description=fire?'A single task finishes, saves, and waits for your next command. Shiny collection runs until stopped and keeps starting forms as caught by default. Requested evolved stages use separate new catches.':emerald?'This bot prepares Emerald’s story and National Dex, receives a Pokémon from FireRed, performs its native evolution, and returns it. It waits between paired tasks.':'An automatic campaign bot is not implemented for this game. Available farming defaults are for new requests; the request preview checks execution support.';
      const team=(session?.spectator?.party||[]).map(p=>`<li><img src="${escape(p.sprite)}" alt="" width="40" height="40"><span>${escape(p.speciesName)}${p.shiny?' · Shiny':''}<small>Lv. ${escape(p.level)}</small></span></li>`).join('');
      profile.innerHTML=`<section class="bot-rule-section"><h2>${title}</h2><p>${description}</p>${team?`<ul class="bot-settings-team" aria-label="Current saved team">${team}</ul>`:''}</section>
        ${fire||emerald?`<details class="bot-rule-section"><summary>Hard mode, team and training</summary><dl class="bot-rule-list"><div><dt>Current mode</dt><dd>Normal${session?.gameProgress?.leagueComplete?' · League complete':''}</dd></div><div><dt>Team</dt><dd>The current saved team. Campaign rosters are chosen at the start and are not rerolled when resumed.</dd></div><div><dt>Hard mode</dt><dd>Separate fresh-campaign experiment. Every member enters audited major battles at least two levels below the opponent’s strongest Pokémon; preparation keeps another level of buffer. Healing, items and switching are allowed. A saved run cannot qualify retrospectively; hard mode requires a fresh campaign.</dd></div>${fire?'<div><dt>Training</dt><dd>The normal first-League policy targets level 65 and five ready battlers. It compares safe reachable trainer rematches, uses wild encounters as a fallback, and prepares healing and PP supplies. Postgame preparation follows the current task.</dd></div>':''}</dl></details>
        <details class="bot-rule-section"><summary>Capture and completion rules</summary><dl class="bot-rule-list"><div><dt>Shiny protection</dt><dd>${fire?'Preserve and catch encountered shinies even when their nature, IVs or ball differ from preferences.':'Preserve an unexpected shiny and pause for review.'}</dd></div><div><dt>Capture strategy</dt><dd>${fire?'Compare supported RNG methods for expected time to a saved catch. Weaken or apply status when safe; use a suitable ball. Handle trapped encounters before continuing.':'The FireRed owner performs hunting; Emerald supplies the compatible native evolution and trade route.'}</dd></div><div><dt>Save and trade</dt><dd>Verify the Pokémon in the native save. A paired trade must finish both saves, normal link exit, and the return journey before completion.</dd></div></dl></details>`:''}`;
    }
    async function load(next){
      game=next;loaded=null;const current=++revision;host.innerHTML='<p role="status">Loading bot settings…</p>';
      try{
        const response=await fetch(`./api/pokemon-suite/bot-settings?game=${encodeURIComponent(next)}`,{cache:'no-store'}),data=await response.json();
        if(current!==revision)return;
        if(!response.ok||data.game!==next)throw Error(data.error||'Settings are unavailable for this game.');
        loaded=data;if(!data.editable){host.innerHTML='<p>No configurable bot is installed for this game yet. Use Live game for manual play.</p>';return;}
        const p=data.preferences,options=data.options,gen2=options.generation===2;
        host.innerHTML=`<form id="bot-settings-form"><fieldset><legend><img src="./assets/pokemon/items/ultra_ball.png" width="28" height="28" alt="">New hunt defaults</legend><p>Used when creating a new Pokémon request in Farming. Existing drafts, running hunts and automatic collection requests keep their own requirements.</p><div class="bot-setting-fields">
          ${select('shiny','Shininess',option('any','Any')+option('required','Shiny required'))}
          ${select('ball','Preferred Poké Ball',option('any','Any suitable ball')+options.balls.map(b=>option(b.id,b.name)).join(''))}
          ${select('ball-rule','Ball requirement',option('preferred','Prefer this ball')+option('required','Require this ball'))}
          ${select('nature','Nature',option('any',gen2?'No natures in Crystal':'Any nature')+options.natures.map(n=>option(n.id,n.name)).join(''))}
          ${select('gender','Gender',option('any','Any')+option('male','Male')+option('female','Female')+option('genderless','Genderless'))}
          ${select('after','After a saved catch',option('stop-save','Finish hunt after saving')+option('prepare-trade','Prepare for trading'))}
        </div><p class="bot-setting-help">A shiny takes priority over other preferences. A single task waits for your next command after saving; continuous collection runs until you stop it. Choose the Pokémon, ability, moves, held items, evolution route and competitive build in Farming.</p></fieldset>
        <fieldset><legend><img src="./assets/pokemon/items/rare_candy.png" width="28" height="28" alt="">Minimum ${gen2?'DVs':'IVs'}</legend><p>Leave blank for no minimum. These filter naturally generated Pokémon; they do not edit stats.</p><div class="bot-stat-fields">${Object.entries(gen2?{attack:'Attack',defense:'Defense',special:'Special',speed:'Speed'}:stats).map(([key,label])=>`<label><span>${label}</span><input data-bot-stat="${key}" type="number" min="0" max="${gen2?15:31}" step="1" placeholder="Any"></label>`).join('')}</div></fieldset>
        <fieldset><legend><img src="./assets/pokemon/items/poke_ball.png" width="28" height="28" alt="">Search limits and supplies</legend><div class="bot-setting-fields">${numeric('maxEncounters','Maximum encounters',1,1000000)}${numeric('maxMinutes','Maximum minutes',1,10080)}${numeric('minBalls','Ball reserve',0,999)}${numeric('maxSpend','Maximum in-game spending',0,999999)}</div><p>Hunts stop or request attention when limits are reached. A protected shiny remains reserved for capture and saving.</p></fieldset>
        ${next==='firered'?`<fieldset><legend><img src="./assets/pokemon/items/rare_candy.png" width="28" height="28" alt="">Rare Candy supply</legend><label><input id="bot-pref-qmm" type="checkbox"> Duplicate Rare Candies with the question-mark Mail glitch</label><p>Off by default. Uses ordinary button input only: a one-time double battle reserves a party Mail slot, then each Retro Mail (₽50) returns one Rare Candy. Box 3 slot 1 is kept empty while Mail is handed out, and all Mail is taken back before saving.</p></fieldset><fieldset><legend><img src="./assets/pokemon/items/exp_share.png" width="28" height="28" alt="">League training</legend><label><input id="bot-pref-league-training" type="checkbox"> Train a Pokémon with the League Exp. Share</label><p>On by default. After the stronger League victory, a Pokémon that still needs levels holds the Exp. Share through League rounds and never battles. A fainted battler, a lost round or another League problem pauses it, and the postgame checklist shows why. To resume, turn this off and save, then turn it on and save again. A resume applies to every FireRed save paused before it.</p></fieldset>`:''}
        <div class="bot-settings-save"><button id="bot-settings-save" type="submit" class="suite-primary">Save bot settings</button><p id="bot-settings-status" role="status" aria-live="polite"></p></div></form>`;
        for(const [key,value] of Object.entries({shiny:p.shiny,ball:p.ball.id,'ball-rule':p.ball.requirement,nature:p.natures[0]||'any',gender:p.gender,after:p.afterCompletion,...p.limits}))$('#bot-pref-'+key).value=value;
        $('#bot-pref-nature').disabled=gen2;
        if($('#bot-pref-qmm'))$('#bot-pref-qmm').checked=p.qmmRareCandySupply===true;
        if($('#bot-pref-league-training'))$('#bot-pref-league-training').checked=p.leagueExpShareTraining!==false;
        for(const input of host.querySelectorAll('[data-bot-stat]'))input.value=(gen2?p.minDvs:p.minIvs)[input.dataset.botStat]??'';
        $('#bot-settings-form').addEventListener('submit',save);
        enable();
      }catch(error){if(current===revision){host.innerHTML='<p role="status"></p><button type="button" class="suite-secondary">Retry settings</button>';host.querySelector('p').textContent=error.message;host.querySelector('button').onclick=()=>load(next);}}
    }
    function enable(){
      if(!loaded?.editable)return;
      for(const field of host.querySelectorAll('input,select,button'))field.disabled=!owner||saving||(field.id==='bot-pref-nature'&&loaded.options.generation===2);
    }
    async function save(event){
      event.preventDefault();if(!owner||saving)return;const current=game,currentRevision=revision;
      const value=id=>$('#bot-pref-'+id).value,ivs={};
      for(const field of host.querySelectorAll('[data-bot-stat]'))if(field.value!=='')ivs[field.dataset.botStat]=Number(field.value);
      const preferences={shiny:value('shiny'),natures:value('nature')==='any'?[]:[value('nature')],gender:value('gender'),ball:{id:value('ball'),requirement:value('ball-rule')},minIvs:loaded.options.generation===2?{}:ivs,minDvs:loaded.options.generation===2?ivs:{},limits:Object.fromEntries(['maxEncounters','maxMinutes','minBalls','maxSpend'].map(k=>[k,Number(value(k))])),afterCompletion:value('after'),collectionStages:loaded.preferences.collectionStages||'base-forms',qmmRareCandySupply:$('#bot-pref-qmm')?$('#bot-pref-qmm').checked:loaded.preferences.qmmRareCandySupply===true,leagueExpShareTraining:$('#bot-pref-league-training')?$('#bot-pref-league-training').checked:loaded.preferences.leagueExpShareTraining!==false};
      saving=true;enable();$('#bot-settings-status').textContent='Saving…';
      try{
        const response=await fetch('./api/pokemon-suite/bot-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game:current,preferences})}),result=await response.json();
        if(!response.ok)throw Error(result.error||'Settings could not be saved.');
        window.dispatchEvent(new CustomEvent('pokemon-bot-settings-saved',{detail:{game:current,preferences:result.preferences}}));
        if(revision===currentRevision){loaded=result;$('#bot-settings-status').textContent=result.notice?'Bot settings saved. '+result.notice:'Bot settings saved for new requests.';}
      }catch(error){if(revision===currentRevision)$('#bot-settings-status').textContent=error.message;}
      finally{saving=false;enable();}
    }
    return {update(state){owner=state.owner;if(!state.active)return;renderProfile(state.game,state.session);if(state.game&&state.game!==game)void load(state.game);else enable();}};
  }
  window.SuiteBotSettings={create};
})();
