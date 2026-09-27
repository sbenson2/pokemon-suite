"""Deterministic software capsules built only from the reviewed source export."""
import base64
import hashlib
import json
from pathlib import Path
import zipfile
from .packages import DOMAIN,validate_manifest


def build_package(files,output,*,identifier,version,kind,games,entrypoints,key=None,dependencies=(),verification=None):
    manifest={'schema':'pokemon-suite/package/v1','id':identifier,'version':version,'kind':kind,
              'hostApi':1,'workerProtocol':1,'games':list(games),'platforms':['any'],
              'stateSchemas':['pokemon-suite/campaign-state/v1'],'dependencies':list(dependencies),
              'entrypoints':entrypoints,'files':[{'path':p,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()} for p,b in sorted(files.items())]}
    if verification is not None:manifest['verification']=verification
    validate_manifest(manifest)
    from .bot_verification import require_bot_verification
    require_bot_verification(manifest)
    raw=(json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n').encode()
    contents={**files,'manifest.json':raw}
    if key:
        from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
        public=key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
        contents['signature.json']=json.dumps({'keyId':hashlib.sha256(public).hexdigest(),'signature':base64.b64encode(key.sign(DOMAIN+raw)).decode()},sort_keys=True).encode()
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('xb') as stream,zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name,data in sorted(contents.items()):
            info=zipfile.ZipInfo(name,date_time=(2020,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
            archive.writestr(info,data)
    return {'path':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'digest':hashlib.sha256(raw).hexdigest(),'manifest':manifest}
