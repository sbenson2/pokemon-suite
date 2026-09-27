"""Durable update transitions with optimistic fencing and idempotent requests."""
from contextlib import contextmanager
import json
from pathlib import Path
import re
import sqlite3
import time
import uuid
from .packages import DIGEST

TRANSITIONS={
 'created':{'verified','failed'},'verified':{'waiting','activated','failed'},
 'waiting':{'checkpointed','cancelled','failed'},'checkpointed':{'activating','failed'},
 'activating':{'healthy','rolled-back','failed'},'healthy':{'resumed','failed'},
 'resumed':set(),'activated':set(),'rolled-back':set(),'failed':{'recovered'},'recovered':set(),'cancelled':set()}

class UpdateJournal:
    def __init__(self,directory):self.directory=Path(directory)
    @contextmanager
    def connection(self):
        self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        db=sqlite3.connect(self.directory/'updates.sqlite3',timeout=10)
        db.execute('PRAGMA journal_mode=WAL');db.execute('PRAGMA synchronous=FULL')
        db.execute('CREATE TABLE IF NOT EXISTS updates (id TEXT PRIMARY KEY, request TEXT UNIQUE, game TEXT, target TEXT, state TEXT, revision INTEGER, detail TEXT, updated REAL)')
        db.execute('CREATE TABLE IF NOT EXISTS events (id TEXT, revision INTEGER, state TEXT, detail TEXT, at REAL, PRIMARY KEY(id,revision))')
        try:
            with db:yield db
        finally:db.close()
    @staticmethod
    def record(row):
        if not row:raise ValueError('Update request not found.')
        return dict(zip(('id','requestId','game','target','state','revision','detail','updatedAt'),[*row[:6],json.loads(row[6]),row[7]]))
    def create(self,game,target,request):
        if not isinstance(request,str) or not re.fullmatch('[A-Za-z0-9_-]{8,100}',request) or not DIGEST.fullmatch(target):raise ValueError('Invalid update request identity.')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE');old=db.execute('SELECT * FROM updates WHERE request=?',(request,)).fetchone()
            if old:
                r=self.record(old)
                if (r['game'],r['target'])!=(game,target):raise ValueError('This request identifier already names another update.')
                return r
            identifier=str(uuid.uuid4());now=time.time()
            db.execute('INSERT INTO updates VALUES (?,?,?,?,?,?,?,?)',(identifier,request,game,target,'created',0,'{}',now))
            db.execute('INSERT INTO events VALUES (?,?,?,?,?)',(identifier,0,'created','{}',now))
        return self.get(identifier)
    def get(self,identifier):
        with self.connection() as db:return self.record(db.execute('SELECT * FROM updates WHERE id=?',(identifier,)).fetchone())
    def transition(self,identifier,revision,state,detail):
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE');r=self.record(db.execute('SELECT * FROM updates WHERE id=?',(identifier,)).fetchone())
            if r['revision']!=revision:raise ValueError('This update changed in another operation. Refresh its status.')
            if state not in TRANSITIONS[r['state']]:raise ValueError('Invalid update transition; gameplay may already have resumed.')
            now=time.time();body=json.dumps({**r['detail'],**detail})
            db.execute('UPDATE updates SET state=?,revision=?,detail=?,updated=? WHERE id=?',(state,revision+1,body,now,identifier))
            db.execute('INSERT INTO events VALUES (?,?,?,?,?)',(identifier,revision+1,state,body,now))
        return self.get(identifier)
    def recent(self):
        with self.connection() as db:return [self.record(r) for r in db.execute('SELECT * FROM updates ORDER BY updated DESC LIMIT 100')]
    def history(self,identifier):
        with self.connection() as db:return [{'revision':r[0],'state':r[1],'detail':json.loads(r[2]),'at':r[3]} for r in db.execute('SELECT revision,state,detail,at FROM events WHERE id=? ORDER BY revision',(identifier,))]
