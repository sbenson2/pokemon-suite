"""Atomic, identity-bound checkpoints with separately preserved native cartridge RAM."""
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone

def sha256(value):return hashlib.sha256(value).hexdigest()

def atomic_file(path, value):
    path=Path(path);temporary=path.with_name(path.name+'.tmp')
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'wb') as out:out.write(value);out.flush();os.fsync(out.fileno())
    os.replace(temporary,path)

class SaveStore:
    def __init__(self,directory,identity):
        self.directory=Path(directory);self.identity=identity

    def read(self):
        path=self.directory/'current.json'
        if not path.exists():return None
        record=json.loads(path.read_text())
        if record['identity']!=self.identity:raise ValueError('Save identity does not match this game, ROM and core. Migration is required.')
        values={}
        for key in ('state','sram'):
            filename=record[key+'File']
            if Path(filename).name!=filename:raise ValueError('Invalid save filename.')
            value=(self.directory/filename).read_bytes()
            if sha256(value)!=record[key+'Sha256']:raise ValueError('Save checksum failed. The checkpoint has not been loaded.')
            values[key]=value
        return {**record,**values}

    def commit(self,state,sram,metadata):
        if not state:raise ValueError('The emulator did not produce a checkpoint.')
        self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        previous=self.read() # Refuse to overwrite an unverified or mismatched save.
        record={'schema':'pokemon-suite/checkpoint/v1','identity':self.identity,'metadata':metadata,
            'updatedAt':datetime.now(timezone.utc).isoformat(),
            # Some games initialize cartridge RAM before the player ever saves.
            # Only a title-specific native save/load check can certify progress.
            'cartridgeRamHasData':bool(sram and any(b not in (0,255) for b in sram)),
            'nativeSaveVerified':False}
        for key,value in [('state',state),('sram',sram)]:
            digest=sha256(value);name=digest+('.state' if key=='state' else '.sav')
            atomic_file(self.directory/name,value)
            record.update({key+'File':name,key+'Sha256':digest})
        if previous:
            atomic_file(self.directory/'previous.json',json.dumps({k:v for k,v in previous.items() if k not in {'state','sram'}}).encode())
        atomic_file(self.directory/'current.json',json.dumps(record).encode())
        # Keep the current and previous coherent pairs, not an unbounded state history.
        keep={record['stateFile'],record['sramFile']}
        if previous:keep.update([previous['stateFile'],previous['sramFile']])
        for file in self.directory.iterdir():
            if file.suffix in {'.state','.sav'} and len(file.stem)==64 and file.name not in keep:file.unlink()
        return record
