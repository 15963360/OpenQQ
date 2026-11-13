import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { inspectQQ } from './qq.mjs';

const UNSAFE_EXT_RE = /\.(bat|cmd|ps1|vbs|vbe|js|jse|wsf|wsh|hta|com)$/i;
const PYTHON_BIN_RE = process.platform === 'win32' ? /^python(?:\d+(?:\.\d+)*)?\.exe$/i : /^python(?:\d+(?:\.\d+)*)?$/;

export function isUncPath(value) {
  return typeof value === 'string' && /^(?:\\\\|\/\/)/.test(value.trim());
}

export function validateExecutablePath(value, kind = 'python') {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\0\r\n]/.test(value)) {
    throw new Error(`${kind} 路径无效`);
  }
  const trimmed = value.trim();
  if (isUncPath(trimmed)) throw new Error(`${kind} 不允许使用 UNC 网络路径`);
  if (kind === 'python') {
    if (UNSAFE_EXT_RE.test(trimmed)) throw new Error('Python 路径不能指向脚本文件');
    const name = basename(trimmed);
    const bareCommand = !/[\\/]/.test(trimmed);
    if (process.platform === 'win32') {
      const ok = bareCommand ? /^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i.test(name) : PYTHON_BIN_RE.test(name);
      if (!ok) throw new Error('Python 路径必须指向 python.exe');
    } else if (!PYTHON_BIN_RE.test(name)) {
      throw new Error('Python 路径必须指向 python 可执行文件');
    }
  }
  return trimmed;
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

export function resolveExecutable(candidate, kind = 'python') {
  const cleaned = validateExecutablePath(candidate, kind);
  if (/[\\/]/.test(cleaned)) {
    const abs = resolve(cleaned);
    if (!existingFile(abs)) throw new Error('找不到 Frida Python，请检查配置中的解释器路径');
    return abs;
  }
  if (process.platform === 'win32') {
    const whereExe = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe');
    try {
      const lines = execFileSync(whereExe, [cleaned], { encoding: 'utf8', windowsHide: true, timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] })
        .split(/\r?\n/).map(v => v.trim()).filter(Boolean);
      for (const hit of lines) {
        if (!isUncPath(hit) && PYTHON_BIN_RE.test(basename(hit)) && existingFile(hit)) return hit;
      }
    } catch { /* Not in PATH. */ }
  }
  throw new Error('找不到 Frida Python，请检查配置中的解释器路径');
}

export function parseVersionTuple(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)/);
  if (!match) return [0, 0];
  return [Number(match[1]), Number(match[2])];
}

export function isFridaVersionSupported(version) {
  const [major, minor] = parseVersionTuple(version);
  return major > 17 || (major === 17 && minor >= 8);
}

export function probePython(candidate) {
  let path;
  try { path = resolveExecutable(candidate, 'python'); }
  catch (error) { return { path: String(candidate || ''), exists: false, pythonVersion: null, fridaVersion: null, fridaOk: false, error: error.message }; }
  try {
    const output = execFileSync(path, ['-c', 'import json, sys\ninfo = {"python": ".".join(map(str, sys.version_info[:3])), "frida": None}\ntry:\n import frida\n info["frida"] = getattr(frida, "__version__", None)\nexcept Exception:\n pass\nprint(json.dumps(info))'], {
      encoding: 'utf8', windowsHide: true, timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(output.trim());
    const fridaOk = Boolean(parsed.frida && isFridaVersionSupported(parsed.frida));
    return {
      path,
      exists: true,
      pythonVersion: parsed.python || null,
      fridaVersion: parsed.frida || null,
      fridaOk,
      error: fridaOk ? null : parsed.frida ? `Frida 版本 ${parsed.frida} 过低，需要 >= 17.8` : '此 Python 未安装 Frida（需 >= 17.8）',
    };
  } catch {
    return { path, exists: false, pythonVersion: null, fridaVersion: null, fridaOk: false, error: '无法执行 Python 解释器' };
  }
}

export function detectPythonInstallations(projectDir, preferred) {
  const raw = [];
  if (preferred) raw.push(preferred);
  if (process.env.OPENQQ_PYTHON) raw.push(process.env.OPENQQ_PYTHON);
  if (projectDir) {
    raw.push(join(projectDir, '.venv', 'Scripts', 'python.exe'));
    raw.push(join(projectDir, 'venv', 'Scripts', 'python.exe'));
  }
  if (process.platform === 'win32') {
    try {
      const pyOut = execFileSync('py', ['-0p'], { encoding: 'utf8', windowsHide: true, timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
      for (const line of pyOut.split(/\r?\n/)) {
        const hit = line.match(/([A-Za-z]:\\[^\r\n]*?python\.exe)\s*$/i);
        if (hit) raw.push(hit[1].trim());
      }
    } catch { /* py launcher optional */ }
    const whereExe = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe');
    try {
      const whereOut = execFileSync(whereExe, ['python'], { encoding: 'utf8', windowsHide: true, timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
      for (const line of whereOut.split(/\r?\n/)) {
        const item = line.trim();
        // Skip Microsoft Store AppExecutionAlias stub when empty or redirector.
        if (item && !item.toLowerCase().includes('\\microsoft\\windowsapps\\')) raw.push(item);
      }
    } catch { /* optional */ }
    const programDirs = [
      process.env.LocalAppData ? join(process.env.LocalAppData, 'Programs', 'Python') : null,
      process.env.ProgramFiles ? join(process.env.ProgramFiles) : null,
    ].filter(Boolean);
    for (const parent of programDirs) {
      try {
        for (const entry of readdirSync(parent)) {
          if (/^Python3\d*$/i.test(entry)) raw.push(join(parent, entry, 'python.exe'));
        }
      } catch { /* ignore */ }
    }
  } else {
    raw.push('python3', 'python');
  }

  const candidates = [];
  const seen = new Set();
  for (const entry of raw) {
    const trimmed = String(entry || '').trim();
    if (!trimmed || isUncPath(trimmed)) continue;
    if (!/[\\/]/.test(trimmed)) {
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const probed = probePython(trimmed);
    const key = process.platform === 'win32' ? probed.path.toLowerCase() : probed.path;
    if (seen.has(key)) continue;
    seen.add(key);
    if (probed.exists) candidates.push(probed);
  }
  candidates.sort((a, b) => Number(b.fridaOk) - Number(a.fridaOk));
  return { best: candidates[0] ?? null, candidates };
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

export function detectEnvironment({ projectDir, qqRoot, python } = {}) {
  const qqInstalls = detectQQInstallations();
  const pythonScan = detectPythonInstallations(projectDir, python);
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

  let pythonCheck;
  if (python) {
    pythonCheck = probePython(python);
  } else if (pythonScan.best) {
    pythonCheck = pythonScan.best;
  } else {
    pythonCheck = { path: '', exists: false, pythonVersion: null, fridaVersion: null, fridaOk: false, error: '未检测到 Python 解释器' };
  }

  return {
    platform: process.platform,
    qq: qqCheck,
    qqCandidates: qqInstalls,
    python: pythonCheck,
    pythonCandidates: pythonScan.candidates,
    qqRunning: isQQProcessRunning(),
    hasSavedHint: existsSync(join(projectDir || '.', 'config', 'openqq.json')),
  };
}
