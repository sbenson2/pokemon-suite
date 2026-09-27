"""References to owned Suite save profiles; browsing never activates or copies them."""
import hashlib
import json
from pathlib import Path
import re
import threading


class InventorySources:
    def __init__(self, sessions):
        self.sessions=sessions
        self.path=sessions.directory/'inventory-sources.json'
        self.lock=threading.RLock()

    def _read(self):
        if not self.path.is_file():return {'schema':'pokemon-suite/inventory-sources/v1','games':{}}
        value=json.loads(self.path.read_text())
        if value.get('schema')!='pokemon-suite/inventory-sources/v1':raise ValueError('The saved inventory references need a supported format.')
        return value

    def record(self, game, path):
        if not isinstance(path,str) or not path:raise ValueError('Choose a saved Pokémon Suite game.')
        path=Path(path).expanduser().resolve()
        if path.name=='current.json':path=path.parent.with_suffix('.json')
        if path.suffix!='.json' or path.parent.name!='save-profiles' or path.parent.parent.name!=game:
            raise ValueError('Choose this game’s saved profile record or its current.json checkpoint.')
        record=json.loads(path.read_text());identifier=record.get('id')
        if not isinstance(identifier,str) or not re.fullmatch('[A-Za-z0-9_-]{1,100}',identifier) or identifier!=path.stem:
            raise ValueError('The saved profile identifier does not match its file.')
        library=path.parent.parent.parent
        config=json.loads((library/'config.json').read_text())
        if game not in config.get('games',{}) or not (path.parent/identifier/'current.json').is_file():
            raise ValueError('This saved profile is missing its game configuration or checkpoint.')
        return {'id':hashlib.sha256(str(path).encode()).hexdigest(),'label':str(record.get('label') or 'Saved game')[:160],
                'kind':'saved','library':str(library),'profileId':identifier,'recordPath':str(path)}

    def list(self, game):
        current={'id':'current','label':'Current game','kind':'current'}
        records={}
        for path in sorted((self.sessions.directory/game/'save-profiles').glob('*.json')):
            try:
                record=self.record(game,str(path));records[record['id']]=record
            except (ValueError,OSError,KeyError):continue
        settings=self._read()['games'].get(game,{})
        for saved in settings.get('sources',[]):
            try:record=self.record(game,saved['recordPath'])
            except (ValueError,OSError,KeyError) as error:record={**saved,'kind':'saved','error':'This saved collection is unavailable: '+str(error)}
            records[record['id']]=record
        selected=settings.get('selected','current')
        if selected!='current' and selected not in records:
            records[selected]={'id':selected,'label':'Saved game unavailable','kind':'saved','error':'The selected save is unavailable. Choose another save or link it again.'}
        return [current,*records.values()]

    def resolve(self, game, identifier=None):
        if identifier is None:identifier=self._read()['games'].get(game,{}).get('selected','current')
        record=next((p for p in self.list(game) if p['id']==identifier),None)
        if not record:raise ValueError('The selected saved collection is unavailable. Choose a save from the inventory selector.')
        return record

    def _write(self, value):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        temporary=self.path.with_suffix('.tmp');temporary.write_text(json.dumps(value,indent=2)+'\n');temporary.chmod(0o600);temporary.replace(self.path)

    def select(self, game, identifier):
        with self.lock:
            self.resolve(game,identifier)
            value=self._read();value['games'].setdefault(game,{})['selected']=identifier;self._write(value)

    def link(self, game, record):
        with self.lock:
            record=self.record(game,record['recordPath'])
            value=self._read();settings=value['games'].setdefault(game,{})
            existing={p['id']:p for p in settings.get('sources',[])}
            existing[record['id']]={k:record[k] for k in ['id','label','recordPath']}
            settings.update(sources=list(existing.values()),selected=record['id']);self._write(value)
            return record
