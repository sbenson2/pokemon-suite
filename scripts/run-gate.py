"""Run the bot regression gate as a detached job and report once on completion.

The gate's outer deadline comes from its plan (`gate-plan.json`, written by
verify-bot from recorded case durations): the native budget plus time for the
unit suites, so it grows with the corpus. Nobody should poll it: this wrapper writes the
normal verify-bot log and report, then a `gate.done.json` summary, and posts a
desktop notification. Inspect the summary or the report when it exists; do not
watch the log. A failed run's summary carries the gate triage (scripts/gate_triage.py):
advice with a --resume-from suggestion, never a pass. The load average is
sampled once a minute beside the output as evidence for that triage.
"""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import signal
import subprocess
import sys
import time

import gate_triage

# Unit, host and adapter suites plus ROM checks around the native budget.
PLAN_SUITE_ALLOWANCE = 45 * 60
# Until verify-bot has written the plan (it does so before any suite runs).
PROVISIONAL_DEADLINE = 3 * 3600


def plan_deadline(plan_path):
    """Seconds the whole gate may take: the plan's native budget plus the other
    suites; None until verify-bot has written the plan."""
    try:
        return json.loads(plan_path.read_text())['budgetMs'] / 1000 + PLAN_SUITE_ALLOWANCE
    except (OSError, ValueError, KeyError, TypeError):
        return None


def notify(message):
    try:
        subprocess.run(['osascript', '-e',
                        'display notification %s with title "pokemon-suite gate"' % json.dumps(message)],
                       check=False, timeout=15)
    except OSError:
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--log', type=Path, default=None)
    parser.add_argument('--deadline-hours', type=float, default=None,
                        help='Outer deadline override. Default: the gate plan\'s native budget plus '
                             '45 minutes for the other suites (three hours until the plan exists).')
    parser.add_argument('--env', action='append', default=[], metavar='KEY=VALUE')
    parser.add_argument('--no-notify', action='store_true')
    parser.add_argument('--lanes', type=int, default=3,
                        help='Parallel native replay processes (default 3; 1 restores the serial runner).')
    parser.add_argument('--first', default='', help='Comma-separated native case ids to run first.')
    parser.add_argument('--order-from', type=Path, default=None,
                        help='A previous run whose durations schedule the longest native cases first.')
    parser.add_argument('--resume-from', type=Path, default=None,
                        help='A failed or interrupted run of the identical source and corpus whose passed cases are reused.')
    parser.add_argument('--max-failures', type=int, default=3,
                        help='Native failures after which no new case starts (default 3).')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    log = args.log or args.output.with_suffix('.log')
    log.parent.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ}
    for item in args.env:
        key, _, value = item.partition('=')
        environment[key] = value
    command = [sys.executable, 'scripts/verify-bot.py',
               '--corpus', str(args.corpus.resolve()), '--output', str(args.output.resolve()),
               '--lanes', str(args.lanes)]
    if args.first: command += ['--first', args.first]
    if args.order_from: command += ['--order-from', str(args.order_from.resolve())]
    if args.resume_from: command += ['--resume-from', str(args.resume_from.resolve())]
    command += ['--max-failures', str(args.max_failures)]
    samples = args.output.parent / (args.output.name + '.load.jsonl')
    samples.parent.mkdir(parents=True, exist_ok=True)
    sampled = None
    start = time.monotonic()
    plan_path = args.output / 'gate-plan.json'
    deadline = args.deadline_hours * 3600 if args.deadline_hours else None
    with log.open('w') as stream:
        process = subprocess.Popen(command, cwd=root, env=environment,
                                   stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        while process.poll() is None:
            if deadline is None:
                deadline = plan_deadline(plan_path)
            if time.monotonic() - start > (deadline if deadline is not None else PROVISIONAL_DEADLINE):
                # verify-bot writes an interrupted report on SIGTERM; its passed
                # cases stay reusable with --resume-from.
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=30)
                break
            if sampled is None or time.monotonic() - sampled >= 60:
                sampled = time.monotonic()
                load1, load5, load15 = os.getloadavg()
                with samples.open('a') as sample:
                    sample.write(json.dumps({'at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                                             'load1': round(load1, 1), 'load5': round(load5, 1),
                                             'load15': round(load15, 1), 'cpus': os.cpu_count()}) + '\n')
            time.sleep(5)
    elapsed = round(time.monotonic() - start)
    summary = {'exitCode': process.returncode, 'elapsedSeconds': elapsed,
               'deadlineSeconds': round(deadline) if deadline is not None else None,
               'log': str(log), 'report': str(args.output / 'report.json')}
    report_path = args.output / 'report.json'
    if report_path.exists():
        report = json.loads(report_path.read_text())
        summary.update({key: report.get(key) for key in ('status', 'interrupted', 'receipt', 'sourceSha256', 'reusedCases', 'lanes')})
        summary['checks'] = [{key: check.get(key) for key in ('id', 'tests', 'passed', 'failed', 'skipped')}
                             for check in report.get('checks', [])]
    if summary.get('status') != 'passed' and report_path.exists():
        try:
            summary['triage'] = gate_triage.triage(args.output)
        except Exception as error:  # Advice only: a triage problem never hides the gate result.
            summary['triage'] = {'error': str(error)}
    done = args.output / 'gate.done.json'
    done.parent.mkdir(parents=True, exist_ok=True)
    done.write_text(json.dumps(summary, indent=2) + '\n')
    if not args.no_notify:
        state = 'passed' if summary.get('status') == 'passed' else 'exit %s' % process.returncode
        notify('gate %s in %sm; summary %s' % (state, elapsed // 60, done))
    print(json.dumps(summary, indent=2))
    if summary.get('triage', {}).get('failures') is not None:
        print('\n'.join(gate_triage.lines(summary['triage'])))
    return process.returncode if process.returncode is not None else 1


if __name__ == '__main__':
    sys.exit(main())
