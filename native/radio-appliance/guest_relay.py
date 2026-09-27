"""Private virtio-serial bootstrap for the existing native RFU relay."""
import json
import os
from pathlib import Path
import re
import select
import socket
import subprocess
import sys
import time
from types import SimpleNamespace

KEYS={'master_key_00','master_key_12','aes_kek_generation_source','aes_key_generation_source'}


def verify_kernel_crypto():
    # mac80211 requests ccm(aes) dynamically: driver dependencies alone omit it.
    # Check actual kernel key allocation before accepting RFU discovery packets.
    try:
        for module in ('ccm','aes_ce_ccm','algif_aead'):
            subprocess.run(['modprobe',module],check=True,capture_output=True,timeout=5)
        with socket.socket(getattr(socket,'AF_ALG',38),socket.SOCK_SEQPACKET) as algorithm:
            algorithm.bind(('aead','ccm(aes)'))
            algorithm.setsockopt(279,1,bytes(16))  # SOL_ALG / ALG_SET_KEY; synthetic.
    except (OSError,subprocess.SubprocessError):
        raise RuntimeError('Wireless encryption is unavailable; reinstall the radio runtime.') from None


def read_request(fd, timeout=30):
    deadline=time.monotonic()+timeout;data=bytearray()
    while True:
        remaining=deadline-time.monotonic()
        if remaining<=0 or not select.select([fd],[],[],remaining)[0]:raise TimeoutError('Suite did not initialize the radio')
        byte=os.read(fd,1)
        if not byte:raise EOFError('Suite closed the radio channel')
        if byte==b'\n':break
        data.extend(byte)
        if len(data)>1024:raise ValueError('Invalid radio initialization')
    try:
        value=json.loads(data)
        if not isinstance(value,dict) or value.get('type')!='bootstrap' or value.get('version')!=1:raise ValueError()
        keys=value.get('keys')
        if not isinstance(keys,dict) or set(keys)!=KEYS or not all(isinstance(v,str) and re.fullmatch('[a-fA-F0-9]{32}',v) for v in keys.values()):raise ValueError()
        return value
    except (ValueError,TypeError):raise ValueError('Invalid radio initialization') from None


def main():
    deadline=time.monotonic()+30;port=None
    while port is None:
        for name in Path('/sys/class/virtio-ports').glob('*/name'):
            if name.read_text().strip()=='org.pokemonsuite.radio':port=Path('/dev')/name.parent.name;break
        if time.monotonic()>deadline:raise TimeoutError('Suite radio channel is unavailable')
        if port is None:time.sleep(.1)
    fd=os.open(port,os.O_RDWR|os.O_NOCTTY)
    request=read_request(fd)
    os.dup2(fd,0);os.dup2(fd,1)
    sys.stdin=open(0,'r',buffering=1,closefd=False)
    sys.stdout=open(1,'w',buffering=1,closefd=False)
    folder=Path('/run/radio');folder.mkdir(mode=0o700,exist_ok=True)
    keyfile=folder/'prod.keys'
    with open(os.open(keyfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as stream:
        stream.write('\n'.join(k+' = '+v for k,v in request.pop('keys').items())+'\n')
    try:
        verify_kernel_crypto()
        from guest_probe import qualify
        radio=qualify()
        sys.path[:0]=['/opt/relay','/opt/protocol','/opt/radio-deps']
        import serve
        serve.run(SimpleNamespace(protocol='/opt/protocol',keys=str(keyfile),phy=radio['phy']))
    except Exception as error:
        print(json.dumps({'type':'error','reason':str(error)}),flush=True)
        raise
    finally:
        keyfile.unlink(missing_ok=True)
        os.close(fd)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print('Radio stopped: '+str(error),file=sys.stderr)
        sys.exit(1)
