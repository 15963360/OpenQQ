"""Bootstrap QQ's native addon registration via Frida, then detach."""
import argparse
import json
from pathlib import Path
import sys
import threading

import frida


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--qq', required=True)
    parser.add_argument('--config')
    parser.add_argument('--config-stdin', action='store_true')
    args = parser.parse_args()
    if args.config_stdin:
        raw_config = sys.stdin.readline()
        if not raw_config:
            raise RuntimeError('missing bootstrap config on stdin')
        config = json.loads(raw_config)
    elif args.config:
        config = json.loads(args.config)
    else:
        raise RuntimeError('either --config-stdin or --config is required')
    qq = Path(args.qq).resolve(strict=True)
    done = threading.Event()
    outcome = {'ok': False, 'error': None}

    def message(value, _data):
        if value['type'] == 'error':
            outcome['error'] = value.get('stack', value.get('description', 'agent error'))
            done.set()
        elif value['type'] == 'send':
            payload = value['payload']
            print('[OpenQQ/native] ' + json.dumps(payload, ensure_ascii=True), file=sys.stderr, flush=True)
            if payload.get('stage') == 'bootstrapped':
                outcome['ok'] = True
                done.set()
            elif payload.get('stage') == 'error':
                outcome['error'] = payload.get('error', 'native bootstrap failed')
                done.set()

    def cancelled():
        sys.stdin.readline()
        if not done.is_set():
            outcome['error'] = 'bootstrap cancelled'
            done.set()

    threading.Thread(target=cancelled, daemon=True).start()
    device = frida.get_local_device()
    session = None
    pid = None
    suspended = False
    try:
        # Normal QQ command line: no Inspector flags and no replacement QQ binary.
        pid = device.spawn([str(qq)], cwd=str(qq.parent), stdio='inherit')
        suspended = True
        session = device.attach(pid)
        session.on('detached', lambda reason, *_: (
            outcome.update(error=outcome['error'] or f'QQ detached: {reason}'), done.set()
        ) if not outcome['ok'] else None)
        agent = Path(__file__).with_name('agent.js').read_text(encoding='utf-8')
        script = session.create_script(agent, name='openqq-bootstrap')
        script.on('message', message)
        script.load()
        script.exports_sync.watch(config)
        device.resume(pid)
        suspended = False
        if not done.wait(30):
            raise RuntimeError('30 秒内未观察到目标 wrapper.node 的注册；请检查 addon_register 的 owner 和 target')
        if not outcome['ok']:
            raise RuntimeError(outcome['error'] or 'QQ native bootstrap failed')
        return 0
    finally:
        # Never leave the user's QQ suspended after a failed bootstrap.
        if suspended and pid is not None:
            try:
                device.resume(pid)
            except frida.Error:
                pass
        if session is not None:
            try:
                session.detach()
            except frida.Error:
                pass


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'[OpenQQ/native] {error}', file=sys.stderr, flush=True)
        sys.exit(1)
