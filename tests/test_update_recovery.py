import base64,json,tempfile,threading,unittest
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
from test_packages import package
from pokemon_suite.updates import UpdateManager

class Owner:
 def __init__(self,directory):
  self.directory=directory;self.lock=threading.RLock();self.releases=0;self.ready=False
  self.live={'schema':'pokemon-suite/session/v1','game':'firered','sessionId':'original','campaign':{'id':'committed'},'runtime':{'protocol':1,'lock':None,'update':{'held':False}}}
 def config(self):return {'games':{'firered':{}}}
 def _live(self,game):return self.live
 def command(self,game,body,session_id=None):
  if session_id!=self.live['sessionId']:raise ValueError('Owner changed')
  update=self.live['runtime']['update']
  if body['type']=='prepare-update':update.update(id=body['updateId'],held=self.ready,checkpoint={'id':body['updateId'],'frame':42})
  elif body['type']=='resume-update':
   if not update['held'] or update['checkpoint']['id']!=body['updateId']:raise ValueError('Not held')
   update['held']=False;self.releases+=1
  return self.live
 def ensure(self,game,update_hold=False):
  lock=json.loads((self.directory/game/'runtime-selection.json').read_text())['lock']
  checkpoint=self.checkpoint
  self.live={'schema':'pokemon-suite/session/v1','game':game,'sessionId':'replacement','runtime':{'protocol':1,'lock':lock,'update':{'held':update_hold,'checkpoint':checkpoint}},'campaign':{'id':'committed'}}
  return self.live

class RecoveryTests(unittest.TestCase):
 def test_service_reopen_continues_checkpointed_handoff_and_releases_once(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);owner=Owner(root);(root/'firered').mkdir();manager=UpdateManager(owner);manager.start=lambda:None
   key=Ed25519PrivateKey.generate();manager.store.trust_key(base64.b64encode(key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)).decode(),label='Test')
   target=manager.store.install(package(root,key))['digest']
   row=manager.apply('firered',target,'recovery-123',allow_intervention=True)
   manager.step(row);manager.step(manager.journal.get(row['id']))
   self.assertEqual(manager.journal.get(row['id'])['state'],'waiting');self.assertEqual(owner.releases,0)
   owner.ready=True;owner.command('firered',{'type':'prepare-update','updateId':row['id']},session_id='original')
   manager.step(manager.journal.get(row['id']));self.assertEqual(manager.journal.get(row['id'])['state'],'checkpointed')
   restarted=UpdateManager(owner)
   def retire(game,session_id):
    self.assertTrue(owner.live['runtime']['update']['held']);owner.checkpoint=owner.live['runtime']['update']['checkpoint'];owner.live=None
   restarted._retire=retire
   for _ in range(3):restarted.step(restarted.journal.get(row['id']))
   self.assertEqual(restarted.journal.get(row['id'])['state'],'resumed');self.assertEqual(owner.releases,1)
   restarted.step(restarted.journal.get(row['id']));self.assertEqual(owner.releases,1)
 def test_recovery_never_rewinds_an_owner_that_has_resumed_gameplay(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);owner=Owner(root);manager=UpdateManager(owner)
   r=manager.journal.create('firered','a'*64,'failed-123');r=manager.journal.transition(r['id'],r['revision'],'failed',{})
   with self.assertRaisesRegex(ValueError,'rewound'):manager.recover(r['id'])
   self.assertEqual(owner.releases,0)
