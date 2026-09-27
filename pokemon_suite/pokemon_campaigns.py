"""Reviewed fresh campaigns; previews never launch an emulator or send inputs."""
import json
from pathlib import Path
import re
import subprocess
from .suite_save_store import atomic_file

RUN_ID=re.compile(r'run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\Z')
# The New Game keyboard automation types letters; FireRed names hold seven.
TRAINER_NAME=re.compile(r'[A-Za-z]{1,7}\Z')
SETTINGS={'label','starter','teamMode','helpers','seedMode','seed','teamSeed','afterCampaign','trainerName'}
STARTERS=('random','bulbasaur','charmander','squirtle')

def check_settings(value):
    """Early host check of campaign settings; the engine CLI validates them fully."""
    if not isinstance(value,dict) or set(value)-SETTINGS:raise ValueError('Unknown or unsupported run setting.')
    name=value.get('trainerName')
    if name is not None and (not isinstance(name,str) or not TRAINER_NAME.fullmatch(name)):
        raise ValueError('Choose a trainer name of 1 to 7 letters (A–Z, a–z), or leave it empty for a preset name.')
    if 'starter' in value and value['starter'] not in STARTERS:raise ValueError('Choose a native FireRed starter: Bulbasaur, Charmander, Squirtle or random.')
    if value.get('afterCampaign','postgame') not in ('postgame','wait'):raise ValueError('Choose postgame continuation or wait after the League.')
    if 'label' in value and (not isinstance(value['label'],str) or not value['label'].strip() or len(value['label'])>50):raise ValueError('Name the run using 1 to 50 characters.')
    return dict(value)

def check_game(sessions,game):
    if game!='firered' or not sessions.configured(game):raise ValueError('Fresh campaign automation is currently available for FireRed.')

def resolve(sessions,game,action,settings=None):
    check_game(sessions,game);execution_config=sessions.execution_config_path(game);config=json.loads(execution_config.read_text())
    script=Path(config['worker']).parent/'campaign-config-cli.js'
    request={'game':game,'action':action}
    if settings is not None:request['settings']=settings
    try:
        result=subprocess.run([config['node'],str(script),str(execution_config)],input=json.dumps(request),capture_output=True,text=True,timeout=30)
    except subprocess.TimeoutExpired as error:raise ValueError('The roster preview took too long. Try again.') from error
    if result.returncode:raise ValueError(result.stderr.strip()[-1200:] or 'The campaign configuration could not be verified.')
    return json.loads(result.stdout)

def options(sessions,game):
    if game!='firered' or not sessions.configured(game):return {'game':game,'supported':False,'reason':'Fresh campaign automation is currently available for FireRed.'}
    data=resolve(sessions,game,'options')
    path=sessions.directory/game/'run-settings.json'
    data['settings']=json.loads(path.read_text()) if path.exists() else data['defaults']
    data['current']=(sessions._live(game) or {}).get('campaign')
    return {'game':game,**data}

def preview(sessions,game,settings):
    if not isinstance(settings,dict):raise ValueError('Choose the settings for the new run.')
    result=resolve(sessions,game,'preview',settings)
    run_id=result['record']['id']
    if not RUN_ID.fullmatch(run_id):raise ValueError('The roster preview returned an invalid run identity.')
    with sessions.lock:
        directory=sessions.directory/game;folder=directory/'run-previews';folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        stored={**result,'sessionId':(sessions._live(game) or {}).get('sessionId')}
        atomic_file(folder/f'{run_id}.json',json.dumps(stored).encode())
        atomic_file(directory/'run-settings.json',json.dumps(result['record']['settings']).encode())
    return {'game':game,'preview':result['preview']}

def start(sessions,game,preview_id):
    check_game(sessions,game)
    if not isinstance(preview_id,str) or not RUN_ID.fullmatch(preview_id):raise ValueError('Review a new run before starting it.')
    with sessions.lock:
        live=sessions._live(game)
        if ((live or {}).get('campaign') or {}).get('id')==preview_id:return live
        path=sessions.directory/game/'run-previews'/f'{preview_id}.json'
        try:review=json.loads(path.read_text())
        except FileNotFoundError as error:raise ValueError('This run preview is no longer available. Review a new run.') from error
        if review.get('started'):raise ValueError('This run was already created. Resume its save instead of starting it again.')
        if review.get('sessionId')!=(live or {}).get('sessionId'):raise ValueError('The game session changed. Review the new run again before starting it.')
        live=live or sessions.ensure(game,manual=True)
        result=sessions.command(game,{'type':'start-campaign','previewId':preview_id},session_id=live['sessionId'])
        if (result.get('campaign') or {}).get('id')!=preview_id:raise ValueError('The game owner did not confirm the reviewed campaign. Its current save is preserved.')
        sessions.pause_collection(game,'The selected story campaign has control.')
        review['started']=True;atomic_file(path,json.dumps(review).encode())
        return result
