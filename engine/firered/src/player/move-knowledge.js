// Shared Gen III move rules. Factual catalog and battle scripts are versioned;
// a selectable menu entry is not proof that its effect can succeed.
import catalog from '../data/move-catalog.js';
import {dataOf,indexed,typeMultiplier,withBattleAbility} from './mechanics-data.js';
import {effectiveBattleWeather,battleTurnOrder} from './battle-modifiers.js';
export const moveCatalog=catalog;
const damageEffects=new Set(('HIT HIGH_CRITICAL MULTI_HIT PAY_DAY BURN_HIT FREEZE_HIT PARALYZE_HIT OHKO RAZOR_WIND GUST SEMI_INVULNERABLE TRAP FLINCH_MINIMIZE_HIT DOUBLE_HIT RECOIL_IF_MISS FLINCH_HIT RECOIL RAMPAGE DOUBLE_EDGE POISON_HIT TWINEEDLE SONICBOOM DEFENSE_DOWN_HIT CONFUSE_HIT SPEED_DOWN_HIT ATTACK_DOWN_HIT RECHARGE LOW_KICK LEVEL_DAMAGE ABSORB SOLAR_BEAM DRAGON_RAGE THUNDER EARTHQUAKE SPECIAL_DEFENSE_DOWN_HIT QUICK_ATTACK RAGE EXPLOSION ALWAYS_HIT SKULL_BASH DREAM_EATER SKY_ATTACK PSYWAVE TRI_ATTACK SUPER_FANG TRIPLE_KICK THIEF THAW_HIT SNORE FLAIL ROLLOUT FALSE_SWIPE FURY_CUTTER DEFENSE_UP_HIT RETURN PRESENT FRUSTRATION MAGNITUDE PURSUIT RAPID_SPIN ATTACK_UP_HIT VITAL_THROW HIDDEN_POWER TWISTER ALL_STATS_UP_HIT FAKE_OUT UPROAR SPIT_UP FACADE FOCUS_PUNCH SMELLINGSALT SUPERPOWER REVENGE BRICK_BREAK KNOCK_OFF ENDEAVOR ERUPTION SECRET_POWER SPECIAL_ATTACK_DOWN_HIT BLAZE_KICK POISON_FANG WEATHER_BALL OVERHEAT SKY_UPPERCUT POISON_TAIL ACCURACY_DOWN_HIT').split(' ').map(e=>'EFFECT_'+e));
const supportEffects=new Set(('SLEEP POISON TOXIC PARALYZE WILL_O_WISP YAWN CONFUSE SWAGGER FLATTER TEETER_DANCE LEECH_SEED NIGHTMARE REST RESTORE_HP SOFTBOILED MORNING_SUN SYNTHESIS MOONLIGHT SWALLOW REFRESH SUBSTITUTE BELLY_DRUM MEAN_LOOK INGRAIN ATTRACT DISABLE ENCORE TAUNT TORMENT BULK_UP CALM_MIND DRAGON_DANCE COSMIC_POWER FOCUS_ENERGY PROTECT ENDURE REFLECT LIGHT_SCREEN SAFEGUARD MIST RAIN_DANCE SUNNY_DAY SANDSTORM HAIL STOCKPILE SLEEP_TALK').split(' ').map(e=>'EFFECT_'+e));
const statEffects=new Set(['ATTACK','DEFENSE','SPECIAL_ATTACK','SPECIAL_DEFENSE','SPEED','ACCURACY','EVASION'].flatMap(s=>['UP','DOWN','UP_2','DOWN_2'].map(d=>'EFFECT_'+s+'_'+d)));
const knownEffect=e=>damageEffects.has(e)||supportEffects.has(e)||statEffects.has(e)||PLAN_EFFECTS.has(e)||e==='EFFECT_SPLASH';
const nativeMoves=new Map(catalog.moves.map(m=>[m.id,m]));
const typeNames=['NORMAL','FIGHTING','FLYING','POISON','GROUND','ROCK','BUG','GHOST','STEEL','MYSTERY','FIRE','WATER','GRASS','ELECTRIC','PSYCHIC','ICE','DRAGON','DARK'].map(n=>'TYPE_'+n);
const status=m=>m?.status1??(typeof m?.status==='number'?m.status:undefined);
const asleep=m=>Number.isInteger(status(m))&&(status(m)&7)>0;
const bit=(m,field,mask)=>(Number(m?.[field]??0)&mask)!==0;
const has=(b,id,name,species)=>b?.ability!=null?b.ability===id||b.ability==='ABILITY_'+name:
  (species?.abilities??[]).filter(a=>a!=='ABILITY_NONE').every(a=>a==='ABILITY_'+name)&&(species?.abilities??[]).includes('ABILITY_'+name);
export function liveMoveTypes(mechanics,b){
  return b?.types?.length?b.types.map(t=>typeof t==='number'?typeNames[t]:t):(indexed(dataOf(mechanics).species,b?.species)?.types??[]);
}
const SOUND_IDS=new Set([45,46,47,48,103,173,195,215,253,304,319,320]);
const CONDITIONAL={
  EFFECT_DREAM_EATER:['target-asleep','no-target-substitute'],EFFECT_NIGHTMARE:['target-asleep','no-target-substitute','not-already-afflicted'],
  EFFECT_SNORE:['user-asleep'],EFFECT_SLEEP_TALK:['user-asleep','callable-known-move'],
  EFFECT_FAKE_OUT:['first-turn-after-entry'],EFFECT_SPIT_UP:['stockpile-positive'],EFFECT_SWALLOW:['stockpile-positive','missing-hp'],
  EFFECT_FOCUS_PUNCH:['safe-preparation-turn'],EFFECT_COUNTER:['same-turn-physical-hit'],EFFECT_MIRROR_COAT:['same-turn-special-hit'],
  EFFECT_BIDE:['multi-turn-damage-history'],EFFECT_BEAT_UP:['eligible-party-members'],EFFECT_HIDDEN_POWER:['user-ivs'],
  EFFECT_RETURN:['user-friendship'],EFFECT_FRUSTRATION:['user-friendship'],EFFECT_LOW_KICK:['target-weight'],
  EFFECT_ERUPTION:['user-hp'],EFFECT_FLAIL:['user-hp'],EFFECT_ENDEAVOR:['user-hp-below-target'],EFFECT_OHKO:['user-level-at-least-target','no-sturdy'],
};
const PLAN_EFFECTS=new Set(['COUNTER','MIRROR_COAT','BIDE','BEAT_UP','METRONOME','MIRROR_MOVE','MIMIC','SKETCH','ASSIST','NATURE_POWER','TRANSFORM','CONVERSION','CONVERSION_2','CAMOUFLAGE','BATON_PASS','TRICK','ROLE_PLAY','SKILL_SWAP','IMPRISON','MAGIC_COAT','SNATCH','FOLLOW_ME','HELPING_HAND','RECYCLE','WISH','FUTURE_SIGHT','TELEPORT','ROAR','MEMENTO','DESTINY_BOND','GRUDGE','PERISH_SONG','PAIN_SPLIT','PSYCH_UP','HEAL_BELL','HAZE','MINIMIZE','DEFENSE_CURL','CURSE','SPITE','SPIKES','FORESIGHT','LOCK_ON','CHARGE','TICKLE','MUD_SPORT','WATER_SPORT'].map(e=>'EFFECT_'+e));
export function describeMove(move){
  const m=typeof move==='number'?nativeMoves.get(move):move;
  if(!m)return null;
  const effect=m.effect??'EFFECT_HIT';
  return {...m,generation:3,known:knownEffect(effect),requirements:CONDITIONAL[effect]??[],
    planning:PLAN_EFFECTS.has(effect)?'requires-plan':Number(m.power)>0?'damage':'support',
    rulesSource:'pret/pokefirered c75f3523: data/battle_scripts_1.s and src/battle_script_commands.c'};
}

// Unknown prerequisites stay unknown. Never fabricate sleep, first-turn state,
// stockpiles, or damage history from the existence of the move in the menu.
export function evaluateMoveUse({move,attacker,defender,mechanics,battle={},allowContingent=false}={}) {
  const e=move?.effect??'EFFECT_HIT',d=dataOf(mechanics),a=withBattleAbility(d,attacker)??{},t=withBattleAbility(d,defender)??{};
  const own=indexed(d.species,a.species),target=indexed(d.species,t.species);
  const types=liveMoveTypes(d,t),reasons=[];
  const deny=(condition,reason)=>{if(condition)reasons.push(reason);};
  deny(!knownEffect(e),'unknown-move-effect');
  const opponentTarget=move?.target!=='MOVE_TARGET_USER'&&move?.target!=='MOVE_TARGET_OPPONENTS_FIELD';
  if(opponentTarget&&SOUND_IDS.has(move?.id))deny(has(t,43,'SOUNDPROOF',target),'soundproof');
  if(['EFFECT_DREAM_EATER','EFFECT_NIGHTMARE'].includes(e)){
    deny(!asleep(t),Number.isInteger(status(t))?'target-not-asleep':'target-sleep-unknown');deny(bit(t,'status2',1<<24),'target-substitute');
    deny((status(t)&7)<=(has(t,48,'EARLY_BIRD',target)?2:1)&&!battleTurnOrder({attacker:a,defender:t,move}).guaranteed,'target-wakes-before-action');
  }
  if(['EFFECT_SNORE','EFFECT_SLEEP_TALK'].includes(e)){
    deny(!asleep(a),Number.isInteger(status(a))?'user-not-asleep':'user-sleep-unknown');
    deny((status(a)&7)<=(has(a,48,'EARLY_BIRD',own)?2:1),'user-wakes-before-action');
  }
  if(e==='EFFECT_SLEEP_TALK'){
    const banned=new Set([0,214,274,119,118,264,253]);
    const twoTurn=new Set(['EFFECT_SKULL_BASH','EFFECT_RAZOR_WIND','EFFECT_SKY_ATTACK','EFFECT_SOLAR_BEAM','EFFECT_SEMI_INVULNERABLE','EFFECT_BIDE']);
    const callable=(a.moves??[]).filter(id=>!banned.has(id)&&!twoTurn.has(indexed(d.moves,id)?.effect)&&
      a.moveState?.disabledMove!==id&&!(a.moveState?.tauntTurns>0&&indexed(d.moves,id)?.power===0));
    deny(callable.length===0,'no-callable-sleep-talk-move');
  }
  if(e==='EFFECT_FAKE_OUT')deny(a.moveState?.isFirstTurn!==true,a.moveState?.isFirstTurn==null?'first-turn-unknown':'not-first-turn');
  if(['EFFECT_SPIT_UP','EFFECT_SWALLOW'].includes(e))deny(!(a.moveState?.stockpileCount>0),a.moveState?.stockpileCount==null?'stockpile-unknown':'no-stockpile');
  if(e==='EFFECT_STOCKPILE')deny(a.moveState?.stockpileCount==null||a.moveState.stockpileCount>=3,'stockpile-unavailable-or-full');
  if(e==='EFFECT_FOCUS_PUNCH'&&!allowContingent)deny(!(asleep(t)&&(status(t)&7)>1),'unproven-focus-punch-setup');
  if(e==='EFFECT_TRANSFORM'){
    // Gen III copies the target's stats, types, ability and moves (at up to
    // five PP). HP, level and identity stay with the user. Its native script
    // rejects transformed/hidden targets, but does not check Substitute.
    deny(!Number.isInteger(t.status2)||!Number.isInteger(t.status3),'transform-target-state-unknown');
    deny(bit(t,'status2',1<<21),'target-already-transformed');
    deny(bit(t,'status3',(1<<6)|(1<<7)|(1<<18)),'target-semi-invulnerable');
    deny(bit(a,'status2',1<<21),'user-already-transformed');
    const copied={...a,species:t.species,stats:t.stats,statStages:t.statStages,types:t.types,ability:t.ability,moves:t.moves};
    deny(!(t.moves??[]).some(id=>{
      const attack=indexed(d.moves,id);
      return attack&&Number(attack.power)>0&&attack.effect!=='EFFECT_TRANSFORM'&&
        evaluateMoveUse({move:attack,attacker:copied,defender:t,mechanics:d,battle}).usable&&
        typeMultiplier(d,attack.type,types)>0;
    }),'no-usable-copied-attack');
  }
  if(!allowContingent)deny(PLAN_EFFECTS.has(e)&&e!=='EFFECT_TRANSFORM','requires-a-specific-plan');
  if(e==='EFFECT_SPLASH')deny(true,'no-battle-effect');
  if(e==='EFFECT_OHKO'){
    deny(!(Number(a.level)>=Number(t.level)),'target-level-too-high');deny(has(t,5,'STURDY',target),'sturdy');
  }
  if(e==='EFFECT_ENDEAVOR')deny(!(Number(a.hp)<Number(t.hp)),'target-hp-not-higher');
  const majorStatus=['EFFECT_SLEEP','EFFECT_POISON','EFFECT_TOXIC','EFFECT_PARALYZE','EFFECT_WILL_O_WISP','EFFECT_YAWN'].includes(e);
  if(majorStatus){
    deny(status(t)!==0,'target-status-present-or-unknown');deny(bit(t,'status2',1<<24),'target-substitute');
    deny(bit(t,'sideStatus',1<<5),'safeguard');
    if(['EFFECT_SLEEP','EFFECT_YAWN'].includes(e)){
      deny(has(t,15,'INSOMNIA',target)||has(t,72,'VITAL_SPIRIT',target),'sleep-immunity');
      deny([a,t,...(battle.battlers??[])].some(b=>bit(b,'status2',0x70)),'uproar');
      if(e==='EFFECT_YAWN')deny(bit(t,'status3',0x1800),'already-drowsy');
    }
    if(['EFFECT_POISON','EFFECT_TOXIC'].includes(e))deny(types.includes('TYPE_POISON')||types.includes('TYPE_STEEL')||has(t,17,'IMMUNITY',target),'poison-immunity');
    if(e==='EFFECT_PARALYZE'){
      deny(has(t,7,'LIMBER',target),'paralysis-immunity');
      deny(typeMultiplier(d,move.type,types)===0,'type-immunity');
      deny(move.type==='TYPE_ELECTRIC'&&has(t,10,'VOLT_ABSORB',target),'volt-absorb');
    }
    if(e==='EFFECT_WILL_O_WISP')deny(types.includes('TYPE_FIRE')||has(t,41,'WATER_VEIL',target)||has(t,18,'FLASH_FIRE',target),'burn-immunity');
  }
  if(['EFFECT_CONFUSE','EFFECT_SWAGGER','EFFECT_FLATTER','EFFECT_TEETER_DANCE'].includes(e)){
    deny(bit(t,'status2',7),'already-confused');deny(has(t,20,'OWN_TEMPO',target),'own-tempo');deny(bit(t,'status2',1<<24),'target-substitute');
  }
  if(e==='EFFECT_LEECH_SEED'){
    deny(bit(t,'status3',4),'already-seeded');deny(types.includes('TYPE_GRASS'),'grass-immune-to-seed');
    deny(bit(t,'status2',1<<24),'target-substitute');deny(has(t,64,'LIQUID_OOZE',target),'liquid-ooze');
  }
  if(e==='EFFECT_NIGHTMARE')deny(bit(t,'status2',1<<27),'already-nightmared');
  const healing=['EFFECT_RESTORE_HP','EFFECT_SOFTBOILED','EFFECT_MORNING_SUN','EFFECT_SYNTHESIS','EFFECT_MOONLIGHT','EFFECT_SWALLOW','EFFECT_REST'].includes(e);
  if(healing)deny(!(a.hp<a.maxHp),'no-missing-hp');
  if(e==='EFFECT_REST')deny(asleep(a)||has(a,15,'INSOMNIA',own)||has(a,72,'VITAL_SPIRIT',own),'cannot-rest');
  if(e==='EFFECT_REFRESH')deny(!(Number(status(a))&(8|16|64|128)),'no-curable-status');
  if(e==='EFFECT_SUBSTITUTE'){
    deny(bit(a,'status2',1<<24),'already-substituted');deny(!(a.hp>Math.floor(a.maxHp/4)),'insufficient-substitute-hp');
  }
  if(e==='EFFECT_BELLY_DRUM')deny(!(a.hp>Math.floor(a.maxHp/2))||a.statStages?.attack>=12,'belly-drum-unavailable');
  if(e==='EFFECT_MEAN_LOOK')deny(bit(t,'status2',1<<26)||bit(t,'status2',1<<24),'already-trapped-or-substitute');
  if(e==='EFFECT_INGRAIN')deny(bit(a,'status3',1<<10),'already-rooted');
  if(e==='EFFECT_ATTRACT')deny(!a.gender||!t.gender||a.gender===t.gender||[a.gender,t.gender].some(g=>g==='genderless')||has(t,12,'OBLIVIOUS',target)||bit(t,'status2',0xf0000),'attraction-unavailable');
  if(e==='EFFECT_DISABLE')deny(!(t.moveState?.lastMove>0)||t.moveState?.disableTurns>0,'disable-unavailable');
  if(e==='EFFECT_ENCORE')deny(!(t.moveState?.lastMove>0)||t.moveState?.encoreTurns>0,'encore-unavailable');
  if(e==='EFFECT_TAUNT')deny(t.moveState?.tauntTurns>0,'already-taunted');
  if(e==='EFFECT_TORMENT')deny(bit(t,'status2',0x80000000),'already-tormented');
  const stats={ATTACK:'attack',DEFENSE:'defense',SPECIAL_ATTACK:'spAttack',SPECIAL_DEFENSE:'spDefense',SPEED:'speed',ACCURACY:'accuracy',EVASION:'evasion'};
  const match=/^EFFECT_(SPECIAL_ATTACK|SPECIAL_DEFENSE|ATTACK|DEFENSE|SPEED|ACCURACY|EVASION)_(UP|DOWN)(?:_2)?$/.exec(e);
  if(match){
    const down=match[2]==='DOWN',who=down?t:a,value=who.statStages?.[stats[match[1]]];
    deny(value!=null&&(down?value<=0:value>=12),'stat-stage-limit');
    if(down){deny(bit(t,'status2',1<<24),'target-substitute');deny(bit(t,'sideStatus',1<<8),'mist');deny(has(t,29,'CLEAR_BODY',target)||has(t,73,'WHITE_SMOKE',target),'stat-drop-immunity');
      deny(match[1]==='ATTACK'&&has(t,52,'HYPER_CUTTER',target)||match[1]==='ACCURACY'&&has(t,51,'KEEN_EYE',target),'specific-stat-immunity');}
  }
  const multipliers={EFFECT_BULK_UP:['attack','defense'],EFFECT_CALM_MIND:['spAttack','spDefense'],EFFECT_DRAGON_DANCE:['attack','speed'],EFFECT_COSMIC_POWER:['defense','spDefense']};
  if(multipliers[e])deny(multipliers[e].every(s=>a.statStages?.[s]>=12),'stat-stage-limit');
  if(e==='EFFECT_FOCUS_ENERGY')deny(bit(a,'status2',1<<20),'already-focused');
  if(e==='EFFECT_PROTECT'||e==='EFFECT_ENDURE')deny(a.moveState?.protectUses>0,'consecutive-protection-risk');
  const sideMasks={EFFECT_REFLECT:1,EFFECT_LIGHT_SCREEN:2,EFFECT_SAFEGUARD:32,EFFECT_MIST:256};
  if(sideMasks[e])deny(bit(a,'sideStatus',sideMasks[e]),'side-effect-already-active');
  const weather=effectiveBattleWeather(battle.weather??a.battleWeather??t.battleWeather,[a,t]);
  const weatherMasks={EFFECT_RAIN_DANCE:7,EFFECT_SUNNY_DAY:96,EFFECT_SANDSTORM:24,EFFECT_HAIL:128};
  if(weatherMasks[e])deny((weather&weatherMasks[e])!==0,'weather-already-active');
  // Semi-invulnerable turns are observable and have explicit Gen III exceptions.
  if(opponentTarget&&Number(move?.power)>0){
    deny(bit(t,'status3',1<<6)&&![16,87,239,327].includes(move.id),'target-in-air');
    deny(bit(t,'status3',1<<7)&&![89,222].includes(move.id),'target-underground');
    deny(bit(t,'status3',1<<18)&&![57,250].includes(move.id),'target-underwater');
  }
  return {usable:reasons.length===0,known:!reasons.some(r=>r.includes('unknown')),reasons,requirements:CONDITIONAL[e]??[]};
}

export function resolveMoveDamage({move,attacker:a,defender:t,mechanics,battle,allowContingent=false}={}) {
  if(!evaluateMoveUse({move,attacker:a,defender:t,mechanics,battle,allowContingent}).usable)return null;
  const e=move.effect;let power=Number(move.power),type=move.type,hits=1;
  if(e==='EFFECT_RETURN'||e==='EFFECT_FRUSTRATION'){
    if(!Number.isInteger(a.friendship))return null;
    power=Math.max(1,Math.floor((e==='EFFECT_RETURN'?a.friendship:255-a.friendship)*10/25));
  }
  if(e==='EFFECT_FLAIL'){
    if(!(a.hp>0&&a.maxHp>0))return null;
    const ratio=Math.floor(a.hp*48/a.maxHp);power=ratio<=1?200:ratio<=4?150:ratio<=9?100:ratio<=16?80:ratio<=32?40:20;
  }
  if(e==='EFFECT_ERUPTION'){if(!(a.hp>0&&a.maxHp>0))return null;power=Math.max(1,Math.floor(150*a.hp/a.maxHp));}
  if(e==='EFFECT_LOW_KICK'){
    const native=catalog.species[t?.species],species=indexed(dataOf(mechanics).species,t?.species);
    const weight=t?.weightHectograms??(species?.name===native?.name?native?.weightHectograms:null);
    if(!(weight>0))return null;power=weight<100?20:weight<250?40:weight<500?60:weight<1000?80:weight<2000?100:120;
  }
  if(e==='EFFECT_SPIT_UP')power=100*a.moveState.stockpileCount;
  if(e==='EFFECT_HIDDEN_POWER'){
    const names=['hp','attack','defense','speed','spAttack','spDefense'],ivs=names.map(n=>a.ivs?.[n]);
    if(!ivs.every(n=>Number.isInteger(n)&&n>=0&&n<=31))return null;
    const value=shift=>ivs.reduce((sum,n,i)=>sum+((n>>shift)&1)*(1<<i),0);
    const types=typeNames.filter(n=>!['TYPE_NORMAL','TYPE_MYSTERY'].includes(n));
    type=types[Math.floor(value(0)*15/63)];power=Math.floor(value(1)*40/63)+30;
  }
  if(e==='EFFECT_MAGNITUDE')power=71;
  if(e==='EFFECT_PRESENT')power=52; // .4×40 + .3×80 + .1×120; .2 heals the foe.
  if(e==='EFFECT_FACADE'&&(Number(status(a))&(8|16|64|128)))power*=2;
  if(e==='EFFECT_SMELLINGSALT'&&(Number(status(t))&64))power*=2;
  if(e==='EFFECT_WEATHER_BALL'){
    const weather=effectiveBattleWeather(battle?.weather??a.battleWeather??t.battleWeather,[a,t]);
    if(weather&(7|24|96|128)){power*=2;type=weather&7?'TYPE_WATER':weather&24?'TYPE_ROCK':weather&96?'TYPE_FIRE':'TYPE_ICE';}
  }
  if(e==='EFFECT_MULTI_HIT')hits=3;
  if(['EFFECT_DOUBLE_HIT','EFFECT_TWINEEDLE'].includes(e))hits=2;
  if(e==='EFFECT_TRIPLE_KICK')power=60;
  if(e==='EFFECT_FURY_CUTTER')power*=2**Math.min(4,a.moveState?.furyCutterCount??0);
  if(e==='EFFECT_ROLLOUT')power*=2**Math.max(0,5-(a.moveState?.rolloutTurns||5))*(bit(a,'status2',1<<30)?2:1);
  if(['EFFECT_GUST','EFFECT_TWISTER'].includes(e)&&bit(t,'status3',1<<6)||e==='EFFECT_EARTHQUAKE'&&bit(t,'status3',1<<7)||move.id===57&&bit(t,'status3',1<<18))power*=2;
  const fixed=e==='EFFECT_SUPER_FANG'?Math.max(1,Math.floor(t.hp/2)):e==='EFFECT_ENDEAVOR'?t.hp-a.hp:
    e==='EFFECT_PSYWAVE'?Math.max(1,(Math.floor(a.level*1.5)-1)/2):e==='EFFECT_OHKO'?t.hp:null;
  if(fixed!=null&&!Number.isFinite(fixed))return null;
  return {...move,power,type,resolvedPower:true,expectedHits:hits,conditionalFixedDamage:fixed};
}

export function moveLearningReadiness({move,pokemon,mechanics}) {
  const learned=(pokemon?.moves??[]).map(id=>indexed(dataOf(mechanics).moves,id)).filter(Boolean);
  const e=move.effect;let reason=null;
  if(['EFFECT_DREAM_EATER','EFFECT_NIGHTMARE'].includes(e)&&!learned.some(m=>m.effect==='EFFECT_SLEEP'||m.effect==='EFFECT_YAWN'))reason='needs-a-sleep-setup';
  if(['EFFECT_SNORE','EFFECT_SLEEP_TALK'].includes(e)&&!learned.some(m=>m.effect==='EFFECT_REST'))reason='needs-rest';
  if(['EFFECT_SPIT_UP','EFFECT_SWALLOW'].includes(e)&&!learned.some(m=>m.effect==='EFFECT_STOCKPILE'))reason='needs-stockpile';
  if(PLAN_EFFECTS.has(e))reason='requires-a-specific-plan';
  return {usable:reason===null,reason,utilityMultiplier:CONDITIONAL[e]?0.55:1};
}
