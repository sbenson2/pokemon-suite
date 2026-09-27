/* Resolve the Suite preference before paint; it is separate from the gallery. */
(() => {
  const key='pokemon-suite-theme';
  const normalize=value=>value==='dark'?'dark':'light';
  let theme='light';
  try {theme=normalize(localStorage.getItem(key));} catch {}
  function sync() {
    document.documentElement.dataset.pokemonTheme=theme;
    const button=document.querySelector('#suite-theme-toggle');
    if(!button)return;
    const dark=theme==='dark',next=dark?'light':'dark';
    button.hidden=document.body.dataset.pokemonSuite!=='true';
    button.setAttribute('aria-label',`Switch Pokémon Suite to ${next} mode`);
    button.title=`Switch to ${next} mode`;
    button.setAttribute('aria-pressed',String(dark));
    button.querySelector('span').textContent=dark?'Light mode':'Dark mode';
    button.querySelector('img').src=`./assets/pokemon/items/${dark?'sun_stone':'moon_stone'}.png`;
  }
  function toggle() {
    theme=theme==='dark'?'light':'dark';
    try {localStorage.setItem(key,theme);} catch {}
    sync();
  }
  window.addEventListener('storage',event=>{if(event.key===key||event.key===null){theme=normalize(event.newValue);sync();}});
  document.addEventListener('DOMContentLoaded',()=>{document.querySelector('#suite-theme-toggle')?.addEventListener('click',toggle);sync();},{once:true});
  window.SuiteTheme={sync};
  sync();
})();
