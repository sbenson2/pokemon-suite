"""Run a disposable radio hardware probe; does not load a game or trade."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time


def run_probe_command(command, timeout=45, diagnostic_log=None):
    started = time.monotonic()
    interrupted = False
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True)
    try:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired as error:
            interrupted = True
            raise TimeoutError('Radio probe did not finish shutdown before its deadline') from error
        except BaseException:
            interrupted = True
            raise
    finally:
        if process.poll() is None or interrupted:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.communicate(timeout=3)
        process.stdout.close()
        process.stderr.close()
    if diagnostic_log is not None:
        Path(diagnostic_log).write_bytes(stdout + b'\nQEMU STDERR:\n' + stderr)
    if process.returncode != 0:
        raise RuntimeError(f'Radio probe exit {process.returncode}: ' + stderr.decode(errors='replace')[-2000:])
    records = [line.partition('=')[2] for line in stdout.decode(errors='replace').splitlines()
               if line.startswith('SUITE_RADIO_PROBE=')]
    if len(records) != 1:
        raise RuntimeError('Guest did not produce exactly one hardware report: ' + stdout.decode(errors='replace')[-2000:])
    report = json.loads(records[0])
    if report.get('schema') != 'pokemon-suite/radio-probe/v1' or report.get('ready') is not True:
        raise RuntimeError('Radio hardware not ready: ' + str(report.get('error', 'invalid report')))
    report.update(hostElapsedSeconds=round(time.monotonic() - started, 3), cleanExit=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kernel', type=Path, required=True)
    parser.add_argument('--initramfs', type=Path, required=True)
    parser.add_argument('--qemu', default=shutil.which('qemu-system-aarch64'))
    parser.add_argument('--memory', type=int, choices=(256, 512), default=512)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--diagnostic-log', type=Path)
    args = parser.parse_args()
    if not args.qemu or not args.kernel.is_file() or not args.initramfs.is_file():
        parser.error('A QEMU executable and both built guest files are required')
    command = [args.qemu, '-machine', 'virt', '-accel', 'hvf', '-cpu', 'host',
               '-m', str(args.memory), '-smp', '1', '-nodefaults', '-display', 'none',
               '-nic', 'none', '-no-reboot', '-kernel', str(args.kernel.resolve()),
               '-initrd', str(args.initramfs.resolve()), '-append',
               'console=ttyAMA0 rdinit=/init rtw88_usb.switch_usb_mode=N quiet',
               '-device', 'qemu-xhci', '-device',
               'usb-host,vendorid=0x2357,productid=0x012d,id=archer', '-serial', 'stdio']
    try:
        result = run_probe_command(command, diagnostic_log=args.diagnostic_log)
        result['memoryMiB'] = args.memory
        result['image'] = {name: {'bytes': path.stat().st_size,
                                 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                           for name, path in [('kernel', args.kernel), ('initramfs', args.initramfs)]}
        serialized = json.dumps(result, indent=2) + '\n'
        if args.output:
            args.output.write_text(serialized)
        print(serialized, end='')
    except (RuntimeError, TimeoutError, OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')
