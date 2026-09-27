// L1.1 "Why it stopped": the host's read-only stop triage for the selected game (session.triage).
// A suggested fix shows what it will do and runs only when the owner taps it. The host re-checks the
// suggestion against fresh state before running it (HTTP 409 when the stop changed).
(()=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const BUCKETS={'transient-retry':'Temporary — the bot retries on its own','known-bug-family':'Known bug','needs-code-fix':'Needs a code fix','needs-owner':'Needs you'};
  const canTap=action=>Boolean(action?.safe&&action.playerTask&&action.token&&action.label);
  function html(triage){
    if(!triage)return '';
    const action=triage.suggestedAction||{},evidence=triage.evidence||[];
    return `<h3>Why it stopped</h3>`+
      `<p><strong class="bot-stop-triage-title">${esc(triage.title)}</strong> <small class="bot-stop-triage-bucket">${esc(BUCKETS[triage.bucket]||triage.bucket)}</small></p>`+
      `<p class="bot-stop-triage-explanation">${esc(triage.explanation)}</p>`+
      (evidence.length?`<details class="bot-stop-triage-evidence"><summary>Evidence</summary><ul>${evidence.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></details>`:'')+
      (canTap(action)
        ?`<p class="bot-stop-triage-effect">${esc(action.confirm)}</p><button type="button" class="suite-secondary" data-triage-action="${esc(action.playerTask)}" data-triage-token="${esc(action.token)}">${esc(action.label)}</button>`
        :`<p class="bot-stop-triage-next">${esc(action.why)}</p>`);
  }
  // host: the card's element; post(body) sends the existing player-tasks request; done(error) reports the outcome.
  function render(host,{game,triage,post,done,details}){
    if(!host)return;
    const key=triage?JSON.stringify([game,triage.bucket,triage.family,triage.explanation,triage.suggestedAction]):'';
    if(host.dataset.key===key)return;
    host.dataset.key=key;host.hidden=!triage;host.innerHTML=html(triage);
    const evidence=host.querySelector('.bot-stop-triage-evidence');
    if(evidence&&details)evidence.addEventListener('toggle',async()=>{
      if(!evidence.open||evidence.dataset.loaded)return;evidence.dataset.loaded='true';
      try{const full=await details(game);if(full?.evidence?.length)evidence.querySelector('ul').innerHTML=full.evidence.map(e=>`<li>${esc(e)}</li>`).join('');}catch{/* The short evidence stays. */}
    });
    const button=host.querySelector('[data-triage-action]');
    if(button)button.addEventListener('click',async()=>{
      button.disabled=true;
      try{await post({game,action:button.dataset.triageAction,triage:button.dataset.triageToken});done?.('');}
      catch(error){button.disabled=false;done?.(error?.message||String(error));}
    });
  }
  window.SuiteStopTriage={html,render,canTap};
})();
