"""Exercise only locally compiled test binaries, never the installed QQ."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

root = Path(__file__).resolve().parent.parent
build = root / '.runtime' / 'native-test'
build.mkdir(parents=True, exist_ok=True)
compiler = shutil.which('g++')
if not compiler:
    raise RuntimeError('native fixture requires g++')
source = root / 'test' / 'native-fixture.cpp'
flags = [compiler, '-O0', '-std=c++17', '-static-libgcc', '-static-libstdc++']
subprocess.run(flags + ['-shared', str(source), '-o', str(build / 'QQNT.dll')], check=True)
host = build / 'openqq-fixture.exe'
subprocess.run(flags + ['-DFIXTURE_HOST', str(source), '-o', str(host)], check=True)
output = build / 'evaluated-source.txt'
output.unlink(missing_ok=True)
returned = Path(str(output) + '.return')
returned.unlink(missing_ok=True)
environment = {**os.environ, 'OPENQQ_FIXTURE_OUTPUT': str(output)}
driver = subprocess.Popen([sys.executable, '-X', 'utf8', str(root / 'native' / 'launch.py'), '--qq', str(host), '--config-stdin'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', env=environment)
driver.stdin.write(json.dumps({
    'wrapper': str(build / 'QQNT.dll'), 'payload': str(root / 'native' / 'session.cjs'),
    'pipe': r'\\.\pipe\openqq-fixture', 'token': 'fixture-only',
}) + '\n')
driver.stdin.flush()
pid = None
try:
    # Keep stdin open: EOF is the launcher's cancellation signal.
    driver.wait(timeout=40)
    diagnostics = driver.stderr.read()
    print(diagnostics, end='')
    registrations = []
    for line in diagnostics.splitlines():
        if line.startswith('[OpenQQ/native] {'):
            value = json.loads(line.removeprefix('[OpenQQ/native] '))
            if 'pid' in value:
                pid = value['pid']
            if value.get('stage') == 'addon_register':
                registrations.append(value)
    assert driver.returncode == 0, diagnostics
    assert pid is not None
    assert any(event['name'] == 'wrapper' and event['target'] is False for event in registrations), diagnostics
    assert any(event['name'] == 'QQNT' and event['target'] is True for event in registrations), diagnostics
    source_text = output.read_text(encoding='utf-8')
    assert '.startNative(' in source_text and 'fixture-only' in source_text
    assert '__openqq_exports' in source_text
    for _ in range(20):
        if returned.exists():
            break
        time.sleep(0.05)
    assert returned.read_text() == 'escaped replacement'
    print('PASS: matches target module -> N-API evaluation -> escapes and replaces exports -> detach')
finally:
    if driver.poll() is None:
        driver.stdin.write('stop\n')
        driver.stdin.flush()
        driver.wait(timeout=10)
    if pid:
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x1001, False, pid)
        if handle:
            try:
                path = ctypes.create_unicode_buffer(32768)
                length = wintypes.DWORD(len(path))
                if kernel.QueryFullProcessImageNameW(handle, 0, path, ctypes.byref(length)) and Path(path.value).resolve() == host.resolve():
                    kernel.TerminateProcess(handle, 0)
            finally:
                kernel.CloseHandle(handle)
    driver.stdin.close()
    driver.stdout.close()
    driver.stderr.close()
