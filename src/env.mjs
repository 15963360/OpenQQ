import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { inspectQQ } from './qq.mjs';

export function isUncPath(value) {
  return typeof value === 'string' && /^(?:\\\\|\/\/)/.test(value.trim());
}

function existingDir(dir) {
  try { return Boolean(dir) && !isUncPath(dir) && statSync(dir).isDirectory(); } catch { return false; }
}

function existingFile(file) {
  try { return Boolean(file) && !isUncPath(file) && statSync(file).isFile(); } catch { return false; }
}

function uniquePaths(list) {
  const seen = new Set();
  const result = [];
  for (const item of list) {
    if (!item || typeof item !== 'string') continue;
    const normalized = resolve(item);
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function queryWindowsRegistryQQPaths() {
  if (process.platform !== 'win32') return [];
  const regExe = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  const keys = [
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ',
    'HKLM\\SOFTWARE\\WOW6432Node\\Tencent\\QQNT',
    'HKLM\\SOFTWARE\\Tencent\\QQNT',
    'HKCU\\SOFTWARE\\Tencent\\QQNT',
  ];
  const dirs = [];
  for (const key of keys) {
    try {
      const output = execFileSync(regExe, ['query', key], { encoding: 'utf8', windowsHide: true, timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
      for (const line of output.split(/\r?\n/)) {
        const match = line.match(/^\s*(Install|InstallLocation|DisplayIcon|UninstallString)\s+REG_\w+\s+(.+)$/i);
        if (!match) continue;
        let raw = match[2].trim();
        if (raw.startsWith('"')) raw = raw.slice(1, raw.indexOf('"', 1) > 0 ? raw.indexOf('"', 1) : undefined);
        raw = raw.replace(/,\d+$/, '').trim();
        if (!raw) continue;
        if (/\.(exe|ico)$/i.test(raw)) raw = dirname(raw);
        dirs.push(raw);
      }
    } catch { /* Missing key is normal. */ }
  }
  return dirs;
}

export function detectQQInstallations() {
  const candidates = [];
  if (process.env.OPENQQ_QQ_ROOT) candidates.push(process.env.OPENQQ_QQ_ROOT);
  candidates.push(...queryWindowsRegistryQQPaths());
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LocalAppData,
    'C:',
    'D:',
    'E:',
  ].filter(Boolean);
  for (const base of roots) {
    candidates.push(join(base, 'Tencent', 'QQNT'));
    candidates.push(join(base, 'Tencent', 'QQ'));
    candidates.push(join(base, 'QQNT'));
    candidates.push(join(base, 'QQ'));
  }
  const found = [];
  for (const dir of uniquePaths(candidates)) {
    if (!existingDir(dir)) continue;
    if (!existingFile(join(dir, 'QQ.exe')) || !existingFile(join(dir, 'versions', 'config.json'))) continue;
    try {
      const info = inspectQQ(dir);
      found.push({ path: info.root, version: info.version, targetMatch: info.targetMatch, supported: info.supported, arch: info.arch });
    } catch (error) {
      found.push({ path: dir, version: null, targetMatch: false, supported: false, error: error.message });
    }
  }
  return found;
}

export function isQQProcessRunning() {
  if (process.platform !== 'win32') return false;
  const tasklist = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe');
  try {
    const out = execFileSync(tasklist, ['/FI', 'IMAGENAME eq QQ.exe', '/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true, timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split(/\r?\n/).some(line => /^"QQ\.exe",/i.test(line.trim()));
  } catch {
    return false;
  }
}

export function detectEnvironment({ projectDir, qqRoot } = {}) {
  const qqInstalls = detectQQInstallations();
  let qqCheck;
  const targetQQ = qqRoot || qqInstalls.find(item => item.supported)?.path || qqInstalls[0]?.path || '';
  if (targetQQ) {
    try {
      const info = inspectQQ(targetQQ);
      qqCheck = { path: info.root, valid: info.supported, targetMatch: info.targetMatch, version: info.version, arch: info.arch, error: info.supported ? null : 'QQ 版本或原生导出不兼容' };
    } catch (error) {
      qqCheck = { path: targetQQ, valid: false, targetMatch: false, version: null, arch: null, error: error.message };
    }
  } else {
    qqCheck = { path: '', valid: false, targetMatch: false, version: null, arch: null, error: '未检测到 QQ NT 安装目录' };
  }

  return {
    platform: process.platform,
    qq: qqCheck,
    qqCandidates: qqInstalls,
    native: probeNative(projectDir),
    qqRunning: isQQProcessRunning(),
    hasSavedHint: existsSync(join(projectDir || '.', 'config', 'openqq.json')),
  };
}

export function probeNative(projectDir = '.') {
  const launcher = join(projectDir, 'native', 'bin', 'openqq-launch.exe');
  const dll = join(projectDir, 'native', 'bin', 'openqq-bootstrap.dll');
  const ready = process.platform === 'win32' && process.arch === 'x64' && existingFile(launcher) && existingFile(dll);
  return { launcher, dll, ready, error: ready ? null : '缺少 Windows x64 原生引导器，请先运行 npm run build:native' };
}
