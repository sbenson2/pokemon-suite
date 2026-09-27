"""Local, on-demand Linux wireless relay owned by one Suite game session."""
import hashlib
import argparse
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import select
import signal
import socket
import subprocess
import sys
import tempfile
import time

REQUIRED_KEYS=('master_key_00','master_key_12','aes_kek_generation_source','aes_key_generation_source')


def pump(source, channel, target, timeout=None):
    started=time.monotonic();stop_deadline=None
    source_open=guest_open=True;write_closed=False;available=False
    pending_in=bytearray();pending_out=bytearray();to_guest=bytearray();to_owner=bytearray()
    blocking=[os.get_blocking(source),os.get_blocking(target),channel.getblocking()]
    os.set_blocking(source,False);os.set_blocking(target,False);channel.setblocking(False)
    try:
        while guest_open or to_owner:
            now=time.monotonic()
            if timeout is not None and now-started>timeout:raise TimeoutError('Radio stream deadline expired')
            if not available and now-started>45:raise TimeoutError('The wireless runtime did not start')
            if stop_deadline is not None and now>stop_deadline:raise TimeoutError('The radio did not finish shutting down')
            readers=([source] if source_open else [])+([channel] if guest_open else [])
            writers=([channel] if to_guest and guest_open else [])+([target] if to_owner else [])
            readable,writable,_=select.select(readers,writers,[],.25)
            if source in readable:
                data=os.read(source,4096)
                if not data:
                    source_open=False
                    if pending_in:raise ValueError('Incomplete Suite radio command')
                    to_guest.extend(b'{"type":"stop"}\n');stop_deadline=now+45
                else:
                    pending_in.extend(data)
                    while b'\n' in pending_in:
                        line,_,remaining=pending_in.partition(b'\n');pending_in[:]=remaining
                        if len(line)>2048:raise ValueError('Oversized Suite radio command')
                        value=json.loads(line)
                        if not isinstance(value,dict) or value.get('type') not in {'heartbeat','packet','stop'}:raise ValueError('Invalid Suite radio command')
                        to_guest.extend(line+b'\n')
                    if len(pending_in)>2048 or len(to_guest)>32768:raise ValueError('Suite radio command queue exceeded its limit')
            if channel in writable:
                count=channel.send(to_guest);del to_guest[:count]
            if not source_open and not to_guest and not write_closed:
                # virtio-serial is not a half-closeable stream: preserve the
                # response path until the guest acknowledges stop and exits.
                write_closed=True
            if channel in readable:
                data=channel.recv(8192)
                if not data:
                    guest_open=False
                    if pending_out:raise ValueError('Incomplete guest radio response')
                else:
                    pending_out.extend(data)
                    while b'\n' in pending_out:
                        line,_,remaining=pending_out.partition(b'\n');pending_out[:]=remaining
                        if len(line)>4096:raise ValueError('Oversized guest radio response')
                        value=json.loads(line)
                        if not isinstance(value,dict) or value.get('type') not in {'available','status','flow','packet','error','stopped'}:raise ValueError('Invalid guest radio response')
                        available=True;to_owner.extend(line+b'\n')
                    if len(pending_out)>4096 or len(to_owner)>65536:raise ValueError('Guest radio response queue exceeded its limit')
            if target in writable:
                count=os.write(target,to_owner);del to_owner[:count]
    finally:
        os.set_blocking(source,blocking[0]);os.set_blocking(target,blocking[1]);channel.setblocking(blocking[2])


def read_credentials(path):
    p=Path(path)
    if not p.is_file() or p.stat().st_size>256*1024:
        raise ValueError('Choose your console key file in Wireless settings.')
    values={}
    for line in p.read_text().splitlines():
        name, separator, value=line.partition('=');name=name.strip();value=value.strip()
        if name not in REQUIRED_KEYS:continue
        if not separator or name in values or not re.fullmatch('[a-fA-F0-9]{32}',value):
            raise ValueError('The console key file has invalid radio credentials.')
        values[name]=value.lower()
    if set(values)!=set(REQUIRED_KEYS):
        raise ValueError('The console key file is missing required radio credentials.')
    return values


def has_adapter(value):
    if isinstance(value,list):return any(has_adapter(v) for v in value)
    if not isinstance(value,dict):return False
    return (value.get('idVendor')==0x2357 and value.get('idProduct')==0x012d) or any(has_adapter(v) for v in value.values() if isinstance(v,(dict,list)))


def runtime_paths(root):
    if not isinstance(root,(str,os.PathLike)):raise ValueError('Invalid wireless runtime location.')
    root=Path(root).resolve()
    manifest=root/'radio-manifest.json'
    if not manifest.is_file():raise ValueError('Install the wireless runtime for Pokémon Suite.')
    value=json.loads(manifest.read_text())
    if not isinstance(value,dict) or value.get('schema')!='pokemon-suite/radio-runtime/v1':raise ValueError('The wireless runtime needs to be reinstalled.')
    if not isinstance(value.get('files'),list) or not isinstance(value.get('entrypoints'),dict):raise ValueError('The wireless runtime manifest is invalid.')
    files={}
    for entry in value.get('files',[]):
        if not isinstance(entry,dict) or not isinstance(entry.get('path'),str):raise ValueError('Invalid wireless runtime file entry.')
        name=entry['path'];relative=PurePosixPath(name)
        if not name or relative.is_absolute() or '..' in relative.parts or relative.as_posix()!=name or '\\' in name:
            raise ValueError('Invalid wireless runtime file path.')
        path=root/name
        if name in files or not re.fullmatch('[0-9a-f]{64}',str(entry.get('sha256',''))):raise ValueError('Invalid wireless runtime file digest.')
        if path.is_symlink() or not path.resolve().is_relative_to(root) or not path.is_file():raise ValueError('The wireless runtime has a missing file.')
        files[name]=path
    entries=value['entrypoints']
    if any(not isinstance(entries.get(role),str) for role in ('qemu','kernel','initramfs')):raise ValueError('The wireless runtime entrypoints are invalid.')
    paths={role:files.get(entries[role]) for role in ('qemu','kernel','initramfs')}
    if not all(paths.values()):raise ValueError('The wireless runtime is incomplete.')
    return paths


def verify_runtime(root):
    paths=runtime_paths(root)
    for entry in json.loads((Path(root)/'radio-manifest.json').read_text())['files']:
        if hashlib.sha256((Path(root)/entry['path']).read_bytes()).hexdigest()!=entry.get('sha256'):
            raise ValueError('The wireless runtime changed; reinstall it before trading.')
    return paths


def attached():
    if sys.platform!='darwin':return False
    result=subprocess.run(['/usr/sbin/ioreg','-a','-r','-c','IOUSBHostDevice'],capture_output=True,timeout=3,check=True)
    return has_adapter(plistlib.loads(result.stdout))


def readiness(config):
    try:runtime_paths(config.get('runtime',''))
    except (ValueError,OSError,KeyError):return {'ready':False,'configured':False,'state':'runtime-missing','reason':'Install the wireless runtime for Pokémon Suite.'}
    try:read_credentials(config.get('keysPath',''))
    except (ValueError,OSError) as error:return {'ready':False,'configured':False,'state':'keys-missing','reason':str(error)}
    try:found=attached()
    except (OSError,ValueError,subprocess.SubprocessError):found=False
    if not found:return {'ready':False,'configured':True,'state':'hardware-missing','reason':'Connect an Archer T3U USB adapter (RTL8822BU) to this Mac. A USB-C adapter or hub may be needed.'}
    return {'ready':True,'configured':True,'state':'ready','reason':'Archer connected. The radio starts automatically when you prepare a trade.'}


def open_attempt_log(state_dir):
    current=Path(state_dir)/'appliance.log'
    if current.is_symlink():raise ValueError('Invalid wireless diagnostic log path.')
    for index in range(5,0,-1):
        source=current if index==1 else current.with_name(f'appliance.{index-1}.log')
        if source.exists() or source.is_symlink():source.replace(current.with_name(f'appliance.{index}.log'))
    return open(os.open(current,os.O_CREAT|os.O_WRONLY|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb')


def run(runtime, keys_path, state_dir):
    paths=verify_runtime(runtime);keys=read_credentials(keys_path)
    if not attached():raise ValueError('Connect the Archer T3U USB adapter to this Mac.')
    state_dir=Path(state_dir);state_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
    locks=Path.home()/'.local/share/pokemon-suite/radio';locks.mkdir(parents=True,exist_ok=True,mode=0o700)
    lease=os.open(locks/'owner.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        try:fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('Another Pokémon Suite game is using the wireless adapter.') from None
        with tempfile.TemporaryDirectory(prefix='pks-radio-',dir='/private/tmp') as directory:
            connection=Path(directory)/'radio.sock'
            args=[str(paths['qemu']),'-machine','virt','-accel','hvf','-cpu','host','-m','512','-smp','1',
                  '-nodefaults','-display','none','-nic','none','-no-reboot',
                  '-kernel',str(paths['kernel']),'-initrd',str(paths['initramfs']),
                  '-append','console=ttyAMA0 rdinit=/init rtw88_usb.switch_usb_mode=N quiet',
                  '-device','qemu-xhci','-device','usb-host,vendorid=0x2357,productid=0x012d,id=archer',
                  '-device','virtio-serial-pci','-chardev',f'socket,id=radio,path={connection},server=on,wait=off',
                  '-device','virtserialport,chardev=radio,name=org.pokemonsuite.radio','-serial','stdio']
            with open_attempt_log(state_dir) as log:
                process=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
                try:
                    deadline=time.monotonic()+15
                    with socket.socket(socket.AF_UNIX) as channel:
                        while True:
                            try:channel.connect(str(connection));break
                            except (FileNotFoundError,ConnectionRefusedError):
                                if process.poll() is not None:raise RuntimeError('The wireless runtime could not boot; see its local log.')
                                if time.monotonic()>deadline:raise TimeoutError('The wireless runtime did not open its channel.')
                                time.sleep(.05)
                        channel.sendall((json.dumps({'type':'bootstrap','version':1,'keys':keys})+'\n').encode());keys.clear()
                        pump(sys.stdin.fileno(),channel,sys.stdout.fileno())
                    process.wait(timeout=15)
                    if process.returncode:raise RuntimeError(f'The wireless runtime exited ({process.returncode}).')
                finally:
                    if process.poll() is None:
                        os.killpg(process.pid,signal.SIGTERM)
                        try:process.wait(timeout=5)
                        except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=5)
    finally:
        os.close(lease)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime',required=True);parser.add_argument('--keys',required=True);parser.add_argument('--state-dir',required=True)
    args=parser.parse_args()
    def interrupted(*_):raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM,interrupted)
    try:run(args.runtime,args.keys,args.state_dir)
    except KeyboardInterrupt:sys.exit(0)
    except Exception as error:
        print(json.dumps({'type':'error','reason':str(error)}),flush=True)
        sys.exit(1)
