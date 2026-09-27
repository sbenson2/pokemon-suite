from pathlib import Path
import tempfile
import unittest

class JournalTests(unittest.TestCase):
    def setUp(self):
        from pokemon_suite.update_journal import UpdateJournal
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.journal=UpdateJournal(Path(self.tmp.name))
    def test_reopening_retains_history_and_rejects_stale_transitions(self):
        from pokemon_suite.update_journal import UpdateJournal
        row=self.journal.create('firered','a'*64,'request-123')
        ready=self.journal.transition(row['id'],row['revision'],'verified',{'reason':'verified'})
        with self.assertRaisesRegex(ValueError,'changed'):self.journal.transition(row['id'],row['revision'],'failed',{})
        reopened=UpdateJournal(self.journal.directory)
        self.assertEqual(reopened.get(row['id'])['state'],'verified')
        self.assertEqual(len(reopened.history(row['id'])),2)
        self.assertEqual(reopened.create('firered','a'*64,'request-123')['id'],row['id'])
        with self.assertRaises(ValueError):reopened.create('firered','b'*64,'request-123')
    def test_rollback_is_disallowed_after_gameplay_was_released(self):
        r=self.journal.create('firered','a'*64,'request-456')
        for state in ['verified','waiting','checkpointed','activating','healthy','resumed']:
            r=self.journal.transition(r['id'],r['revision'],state,{})
        with self.assertRaisesRegex(ValueError,'transition'):self.journal.transition(r['id'],r['revision'],'rolled-back',{})

class QualificationTests(unittest.TestCase):
 def test_a_live_campaign_cannot_be_updated_without_recording_an_intervention(self):
  import base64
  from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
  from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
  from test_packages import package
  from pokemon_suite.updates import UpdateManager
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)
   class Sessions:
    directory=root
    def config(self):return {'games':{'firered':{}}}
    def _live(self,game):return {'sessionId':'owner','runtime':{'protocol':1},'campaign':{'id':'run-one'}}
   manager=UpdateManager(Sessions());key=Ed25519PrivateKey.generate();manager.store.trust_key(base64.b64encode(key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)).decode(),label='Test')
   receipt=manager.store.install(package(root,key))
   with self.assertRaisesRegex(ValueError,'qualification'):manager.apply('firered',receipt['digest'],'request-1234')
   self.assertEqual(manager.journal.recent(),[])
