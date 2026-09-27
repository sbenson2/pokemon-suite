/* Original hardware photographs, rectified only in CSS around a flat native LCD.
   Asset credits and licenses: assets/pokemon/hardware/SOURCE.md. */
(() => {
  const profiles = {
    gb: {name:'Game Boy',file:'gb-photo.png',width:1500,aspect:10/9,corners:[[347,387],[1050,435],[1047,1105],[347,1052]]},
    'gb-pocket': {name:'Game Boy Pocket',file:'gb-pocket-photo.png',width:960,aspect:10/9,corners:[[429,174],[779,269],[668,588],[314,484]]},
    'gb-light': {name:'Game Boy Light',file:'gb-light-photo.png',width:960,aspect:10/9,corners:[[449,180],[774,275],[658,580],[333,473]]},
    gbc: {name:'Game Boy Color',file:'gbc-photo.png',width:1280,aspect:10/9,corners:[[274,219],[1004,219],[1004,873],[274,873]]},
    gba: {name:'Game Boy Advance',file:'gba-photo.png',width:1280,aspect:1.5,corners:[[503,203],[925,341],[790,603],[355,448]]},
    'gba-sp': {name:'Game Boy Advance SP',file:'gba-sp-photo.png',width:1280,aspect:1.5,corners:[[811,109],[1149,282],[942,500],[603,322]]},
    'gb-micro': {name:'Game Boy Micro',file:'gb-micro-photo.png',width:500,aspect:1.5,corners:[[177,57],[352,83],[312,184],[136,155]]},
  };
  const defaultShell = platform => platform==='gb'||platform==='gbc' ? platform : 'gba';

  // Solve the eight homography coefficients from the four LCD corners. The
  // perspective transform affects the photograph only, never emulator pixels.
  function project(source,destination) {
    const rows=[];
    source.forEach(([x,y],i)=>{
      const [u,v]=destination[i];
      rows.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);
    });
    for(let col=0;col<8;col++) {
      let pivot=col;
      for(let row=col+1;row<8;row++) if(Math.abs(rows[row][col])>Math.abs(rows[pivot][col])) pivot=row;
      [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
      const divisor=rows[col][col];
      for(let j=col;j<9;j++) rows[col][j]/=divisor;
      for(let row=0;row<8;row++) if(row!==col) {
        const factor=rows[row][col];
        for(let j=col;j<9;j++) rows[row][j]-=factor*rows[col][j];
      }
    }
    const [a,b,c,d,e,f,g,h]=rows.map(row=>row[8]);
    return [a,d,0,g,b,e,0,h,0,0,1,0,c,f,0,1];
  }
  function layout(profile,width,height,gameAspect) {
    // A close crop leaves a recognizable bezel and its printed logo, while
    // using the available screen space.
    const top=Math.min(12,height*.035),bottom=Math.min(76,Math.max(40,height*.18));
    const side=Math.min(34,width*.07);
    const apertureWidth=Math.max(1,Math.min(width-side*2,(height-top-bottom)*profile.aspect));
    const apertureHeight=apertureWidth/profile.aspect;
    const aperture={left:(width-apertureWidth)/2,top:top+(height-top-bottom-apertureHeight)/2,width:apertureWidth,height:apertureHeight};
    const gameWidth=Math.min(apertureWidth,apertureHeight*gameAspect),gameHeight=gameWidth/gameAspect;
    const game={left:aperture.left+(apertureWidth-gameWidth)/2,top:aperture.top+(apertureHeight-gameHeight)/2,width:gameWidth,height:gameHeight};
    const x=aperture.left,y=aperture.top,w=aperture.width,h=aperture.height;
    return {game,aperture,matrix:project(profile.corners,[[x,y],[x+w,y],[x+w,y+h],[x,y+h]])};
  }
  function mount(stage,platform) {
    const key=`pokemon-suite-photo-shell-${platform}`;
    let saved='auto';
    try {saved=localStorage.getItem(key)||'auto';} catch {}
    if(saved!=='auto'&&!profiles[saved]) saved='auto';
    stage.classList.add('gba-stage');
    stage.dataset.shellView='screen'; // Supersedes the old miniature SVG preference.
    const surround=document.createElement('div');
    surround.className='gba-surround';surround.setAttribute('aria-hidden','true');
    const photo=document.createElement('img');
    photo.className='hardware-shell';photo.alt='';photo.draggable=false;
    const lcd=document.createElement('div');lcd.className='hardware-lcd';
    surround.append(photo,lcd);stage.prepend(surround);
    const controls=document.createElement('div');controls.className='hardware-controls';
    const label=document.createElement('label');label.textContent='Hardware shell';
    const select=document.createElement('select');select.setAttribute('aria-label','Handheld shell');
    for(const [value,text] of [['auto','Auto · game hardware'],...Object.entries(profiles).map(([id,p])=>[id,p.name])]) {
      const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);
    }
    select.value=saved;label.append(select);
    const credit=document.createElement('a');credit.className='hardware-credit';credit.textContent='Photo credits';
    credit.href='./assets/pokemon/hardware/credits.html';credit.target='_blank';credit.rel='noopener';
    controls.append(label,credit);
    const settings=document.querySelector('#suite-hardware-settings');
    const empty=document.querySelector('#suite-hardware-empty');
    settings?.append(controls);
    if(empty)empty.hidden=true;
    let active;
    function resize() {
      const {width,height}=stage.getBoundingClientRect();
      if(width<=0||height<=0) return;
      const result=layout(active,width,height,platform==='gba'?1.5:10/9);
      photo.style.transform=`matrix3d(${result.matrix.join(',')})`;
      for(const [key,value] of Object.entries(result.game)) stage.style.setProperty(`--game-${key}`,`${value}px`);
      Object.assign(lcd.style,{left:`${result.aperture.left-1}px`,top:`${result.aperture.top-1}px`,width:`${result.aperture.width+2}px`,height:`${result.aperture.height+2}px`});
    }
    function choose() {
      const id=select.value==='auto'?defaultShell(platform):select.value;
      active=profiles[id];stage.dataset.hardware=id;
      photo.style.width=`${active.width}px`;
      photo.hidden=true;photo.onload=()=>{photo.hidden=false;};
      photo.src=`./assets/pokemon/hardware/${active.file}`;
      resize();
    }
    select.addEventListener('change',()=>{try{localStorage.setItem(key,select.value);}catch{}choose();});
    const observer=new ResizeObserver(resize);observer.observe(stage);
    choose();
    return ()=>{observer.disconnect();surround.remove();controls.remove();if(empty)empty.hidden=false;stage.classList.remove('gba-stage');delete stage.dataset.hardware;delete stage.dataset.shellView;
      for(const key of ['left','top','width','height']) stage.style.removeProperty(`--game-${key}`);};
  }
  window.SuiteHardwareShell={profiles,defaultShell,layout,mount};
})();
