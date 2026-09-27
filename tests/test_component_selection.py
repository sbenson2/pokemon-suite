import base64,json,tempfile,unittest
from pathlib import Path
from test_packages import package
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
class ComponentSelectionTests(unittest.TestCase):
 def test_a_game_resource_package_is_selected_only_for_its_verified_rom(self):
  from pokemon_suite.packages import PackageStore
  from pokemon_suite.runtime_components import apply_component
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);key=Ed25519PrivateKey.generate();store=PackageStore(root/'profile');store.trust_key(base64.b64encode(key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)).decode(),label='Test')
   p=package(root,key,files={f'inputs/{k}.json':b'{}' for k in ('runtime','world','story','battle')},extra={'id':'test-game','kind':'game','romSha1s':['a'*40],'entrypoints':{k:f'inputs/{k}.json' for k in ('runtime','world','story','battle')}})
   receipt=store.install(p);store.activate('firered',receipt['digest']);resolved=store.resolve('firered',kind='game')
   config={'games':{'firered':{'cartridge':{'sha1':'b'*40}}}}
   with self.assertRaisesRegex(ValueError,'cartridge'):apply_component(config,'firered',resolved)
   config['games']['firered']['cartridge']['sha1']='a'*40;apply_component(config,'firered',resolved)
   self.assertTrue(Path(config['games']['firered']['inputs']['world']).is_file())
