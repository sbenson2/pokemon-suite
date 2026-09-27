"""Create or refresh a local TUF release repository; does not upload anything."""
import argparse
from datetime import datetime,timedelta,timezone
import json
import os
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from securesystemslib.signer import CryptoSigner
from tuf.api.metadata import Metadata,Root,Targets,Snapshot,Timestamp,TargetFile,MetaFile
from pokemon_suite.packages import validate_manifest
from pokemon_suite.bot_verification import require_bot_verification
from pokemon_suite.suite_save_store import atomic_file


def publish(output,keys,packages):
    output=output.resolve();keys=keys.resolve()
    if keys.is_relative_to(output) or keys.is_relative_to(ROOT) and not keys.is_relative_to(ROOT/'.private'):raise ValueError('Keep private TUF keys outside the public repository and reviewed source.')
    keys.mkdir(parents=True,exist_ok=True,mode=0o700);signers={}
    for role in ('root','targets','snapshot','timestamp'):
        path=keys/(role+'.pem')
        if path.exists():key=serialization.load_pem_private_key(path.read_bytes(),password=None)
        else:
            key=Ed25519PrivateKey.generate();fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'wb') as f:f.write(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        signers[role]=CryptoSigner(key)
    meta=output/'metadata';targets=output/'targets';meta.mkdir(parents=True,exist_ok=True);targets.mkdir(exist_ok=True)
    now=datetime.now(timezone.utc)
    rootpath=meta/'root.json'
    if not rootpath.exists():
        root=Metadata(Root(expires=now+timedelta(days=365),consistent_snapshot=False))
        for role,signer in signers.items():root.signed.add_key(signer.public_key,role)
        root.sign(signers['root']);atomic_file(rootpath,root.to_bytes());atomic_file(meta/'1.root.json',root.to_bytes())
    else:
        root=Metadata.from_file(str(rootpath));root.verify_delegate('root',root)
        for role,signer in signers.items():
            if signer.public_key.keyid not in root.signed.roles[role].keyids:raise ValueError('Release keys differ from the existing trusted root. Use a reviewed TUF root rotation.')
    import zipfile
    for package in packages:
        data=package.read_bytes()
        with zipfile.ZipFile(package) as z:manifest=validate_manifest(json.loads(z.read('manifest.json')))
        require_bot_verification(manifest)
        name=f"{manifest['id']}-{manifest['version']}.pksuite";path=targets/name
        if path.exists() and path.read_bytes()!=data:raise ValueError('Published package versions are immutable.')
        atomic_file(path,data)
    catalog=[]
    for path in sorted(targets.glob('*.pksuite')):
        with zipfile.ZipFile(path) as z:manifest=json.loads(z.read('manifest.json'))
        catalog.append({k:manifest[k] for k in ('id','version','kind','games')}|{'target':path.name})
    atomic_file(targets/'catalog.json',json.dumps({'schema':'pokemon-suite/feed/v1','packages':catalog},sort_keys=True).encode())
    version=Metadata.from_file(str(meta/'timestamp.json')).signed.version+1 if (meta/'timestamp.json').exists() else 1
    t=Metadata(Targets(version=version,expires=now+timedelta(days=30),targets={p.name:TargetFile.from_file(p.name,str(p)) for p in targets.iterdir() if p.is_file() and (p.suffix=='.pksuite' or p.name=='catalog.json')}));t.sign(signers['targets'])
    snapshot=Metadata(Snapshot(version=version,expires=now+timedelta(days=7),meta={'targets.json':MetaFile.from_data(version,t.to_bytes(),['sha256'])}));snapshot.sign(signers['snapshot'])
    timestamp=Metadata(Timestamp(version=version,expires=now+timedelta(days=1),snapshot_meta=MetaFile.from_data(version,snapshot.to_bytes(),['sha256'])));timestamp.sign(signers['timestamp'])
    # Publish timestamp last; clients cannot mistake partial metadata for a release.
    for name,value in [('targets',t),('snapshot',snapshot),('timestamp',timestamp)]:atomic_file(meta/(name+'.json'),value.to_bytes())
    return {'directory':str(output),'trustedRoot':str(rootpath),'version':version,'packages':len(catalog)}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--keys',type=Path,required=True);p.add_argument('packages',type=Path,nargs='*');a=p.parse_args();print(json.dumps(publish(a.output,a.keys,a.packages),indent=2))
