import base64
import json
from pathlib import Path
import tempfile
import unittest
from test_packages import package
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat

class RuntimeSelectionTests(unittest.TestCase):
 def test_selected_engine_is_used_and_remains_pinned_for_an_existing_run(self):
  from pokemon_suite.pokemon_sessions import SuiteSessions
  from pokemon_suite.packages import PackageStore
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);profile=root/'profile';profile.mkdir()
   (profile/'config.json').write_text(json.dumps({'directory':str(profile),'node':'node','worker':'bundled.js','games':{'firered':{'port':19099}}}))
   store=PackageStore(profile);key=Ed25519PrivateKey.generate()
   store.trust_key(base64.b64encode(key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)).decode(),label='Test')
   first=store.install(package(root,key));store.activate('firered',first['digest'])
   sessions=SuiteSessions(profile)
   path=sessions.execution_config_path('firered');config=json.loads(path.read_text())
   self.assertTrue(Path(config['worker']).is_file());self.assertEqual(config['runtimeLock']['packages'][0]['version'],'1.0.0')
   second=store.install(package(root,key,version='1.0.1'));store.activate('firered',second['digest'])
   self.assertEqual(json.loads(sessions.execution_config_path('firered').read_text())['runtimeLock']['packages'][0]['version'],'1.0.0')
