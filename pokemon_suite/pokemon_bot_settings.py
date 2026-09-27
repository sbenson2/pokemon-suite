"""Per-game defaults for new farming requests; existing requests stay immutable."""
from copy import deepcopy
from datetime import datetime, timezone
import json
from .pokemon_farming import catalog, fields, integer, choice, STATS
from .suite_save_store import atomic_file

SUPPORTED={'firered','leafgreen','emerald','crystal'}
LEAGUE='leagueExpShareTraining'

def defaults():
    return {'shiny':'any','natures':[],'gender':'any','ball':{'id':'any','requirement':'required'},
            'minIvs':{},'minDvs':{},'limits':{'maxEncounters':1000,'maxMinutes':60,'minBalls':10,'maxSpend':5000},
            'afterCompletion':'stop-save','collectionStages':'base-forms',
            # Opt-in FireRed Rare Candy supply through the question-mark Mail
            # cartridge glitch (controller input only). Off unless chosen.
            'qmmRareCandySupply':False,
            # FireRed postgame League rounds pass the Exp. Share to a Pokémon that
            # still needs levels. Turning it off then on (two saves) stamps
            # leagueExpShareResumedAt: the owner's resume of a hold. The file keeps
            # both beside its preferences (see write()).
            LEAGUE:True}

def validate(game,value):
    if isinstance(value,dict):value={'collectionStages':'base-forms','qmmRareCandySupply':False,LEAGUE:True,**value}
    fields(value,set(defaults()),'Bot settings');dex=catalog(game)
    choice(value['shiny'],['any','required'],'Shiny preference')
    choice(value['gender'],['any','male','female','genderless'],'Gender')
    if not isinstance(value['natures'],list) or len(value['natures'])>25:raise ValueError('Choose valid natures.')
    for nature in value['natures']:choice(nature,[n['id'] for n in dex['natures']],'Nature')
    fields(value['ball'],{'id','requirement'},'Ball')
    choice(value['ball']['id'],['any']+[b['id'] for b in dex['balls']],'Ball')
    choice(value['ball']['requirement'],['preferred','required'],'Ball requirement')
    for key,stats,maximum in [('minIvs',STATS,31),('minDvs',{'attack','defense','special','speed'},15)]:
        if not isinstance(value[key],dict) or not set(value[key])<=set(stats):raise ValueError('Choose valid stat requirements.')
        for stat,n in value[key].items():integer(n,0,maximum,stat)
    if game=='crystal' and (value['natures'] or value['minIvs']):raise ValueError('Crystal has DVs and no natures.')
    if game!='crystal' and value['minDvs']:raise ValueError('This game uses IVs, not DVs.')
    fields(value['limits'],{'maxEncounters','maxMinutes','minBalls','maxSpend'},'Search limits')
    for key,low,high in [('maxEncounters',1,1000000),('maxMinutes',1,10080),('minBalls',0,999),('maxSpend',0,999999)]:integer(value['limits'][key],low,high,key)
    choice(value['afterCompletion'],['stop-save','prepare-trade'],'After a catch')
    choice(value['collectionStages'],['base-forms','each-stage'],'Shiny collection stages')
    if type(value['qmmRareCandySupply']) is not bool:raise ValueError('Choose whether the Rare Candy supply is enabled.')
    if value['qmmRareCandySupply'] and game!='firered':raise ValueError('The question-mark Mail Rare Candy supply is available for FireRed.')
    if type(value[LEAGUE]) is not bool:raise ValueError('Choose whether League training is on.')
    return deepcopy(value)

def read(directory,game):
    if game not in SUPPORTED:return {'game':game,'editable':False,'preferences':None,'options':None}
    path=directory/game/'bot-settings.json'
    try:stored=json.loads(path.read_text());value=stored['preferences']
    except FileNotFoundError:stored,value={},defaults()
    if isinstance(value,dict) and LEAGUE not in value and isinstance(stored,dict) and LEAGUE in stored:value={**value,LEAGUE:stored[LEAGUE]}
    value=validate(game,value);dex=catalog(game)
    return {'game':game,'editable':True,'preferences':value,
            'options':{'balls':dex['balls'],'natures':dex['natures'],'generation':dex['generation']},
            'scope':'New farming requests. Existing hunts and the current campaign are unchanged.'}

def utc_now():return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

def league_training(directory,game):
    """The stored (on, resume stamp); session-worker.js leagueTrainingOption() reads the same keys.
    An unreadable file is on without a resume."""
    try:stored=json.loads((directory/game/'bot-settings.json').read_text())
    except (OSError,ValueError):stored={}
    if not isinstance(stored,dict):stored={}
    stamp=stored.get('leagueExpShareResumedAt')
    return (stored.get(LEAGUE) is not False,stamp if isinstance(stamp,str) else None)

def write(directory,game,value):
    if game not in SUPPORTED:raise ValueError('This game has no configurable farming bot yet.')
    was_on,stamp=league_training(directory,game)
    # A client without the setting (a page opened before it existed) keeps the
    # stored value. Only an explicit on after a stored off is a resume.
    explicit=isinstance(value,dict) and LEAGUE in value
    if isinstance(value,dict) and not explicit:value={**value,LEAGUE:was_on}
    value=validate(game,value)
    if explicit and value[LEAGUE] and not was_on:stamp=utc_now()
    (directory/game).mkdir(parents=True,exist_ok=True,mode=0o700)
    # The setting and its stamp sit beside the preferences: an older host reads
    # the preferences alone and requires exactly its own keys there.
    atomic_file(directory/game/'bot-settings.json',json.dumps({'schema':'pokemon-suite/bot-settings/v1','game':game,
        'preferences':{k:v for k,v in value.items() if k!=LEAGUE},LEAGUE:value[LEAGUE],**({'leagueExpShareResumedAt':stamp} if stamp else {})}).encode())
    return read(directory,game)
