import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
const requiredNapiExports = [
  'qq_magic_napi_register',
  'napi_get_global',
  'napi_set_named_property',
  'napi_create_string_utf8',
  'napi_run_script',
  'napi_open_escapable_handle_scope',
  'napi_close_escapable_handle_scope',
  'napi_escape_handle',
  'napi_is_exception_pending',
  'napi_get_and_clear_last_exception',
];

export function readFuses(bytes) {
  const start = bytes.indexOf(sentinel);
  if (start < 0) throw new Error('未找到 Electron fuse 标记');
  const offset = start + sentinel.length;
  if (bytes[offset] !== 1 || bytes[offset + 1] < 4 || offset + 2 + bytes[offset + 1] > bytes.length) {
    throw new Error('Electron fuse 格式不受支持');
  }
  const wire = bytes.subarray(offset + 2, offset + 2 + bytes[offset + 1]).toString('ascii');
  if (!/^[01r]+$/.test(wire)) throw new Error('Electron fuse 数据无效');
  return { wire, runAsNode: wire[0] === '1', nodeOptions: wire[2] === '1', nodeCliInspect: wire[3] === '1' };
}

export function readPE64Info(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) {
    return { valid: false, x64: false, exports: new Set() };
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 24 > bytes.length || bytes.readUInt32LE(peOffset) !== 0x00004550) {
    return { valid: false, x64: false, exports: new Set() };
  }
  const machine = bytes.readUInt16LE(peOffset + 4);
  const numSections = bytes.readUInt16LE(peOffset + 6);
  const optSize = bytes.readUInt16LE(peOffset + 20);
  const optOffset = peOffset + 24;
  if (machine !== 0x8664 || optOffset + optSize > bytes.length || optSize < 120 || bytes.readUInt16LE(optOffset) !== 0x20b) {
    return { valid: true, x64: false, exports: new Set() };
  }
  const numDirs = bytes.readUInt32LE(optOffset + 108);
  const exportRva = numDirs >= 1 ? bytes.readUInt32LE(optOffset + 112) : 0;
  const exportSize = numDirs >= 1 ? bytes.readUInt32LE(optOffset + 116) : 0;
  const sectionsOffset = optOffset + optSize;
  const sections = [];
  for (let i = 0; i < numSections && sectionsOffset + (i + 1) * 40 <= bytes.length; i++) {
    const base = sectionsOffset + i * 40;
    sections.push({
      virtualSize: bytes.readUInt32LE(base + 8),
      virtualAddress: bytes.readUInt32LE(base + 12),
      rawSize: bytes.readUInt32LE(base + 16),
      rawPtr: bytes.readUInt32LE(base + 20),
    });
  }
  const rvaToOffset = rva => {
    for (const section of sections) {
      const span = Math.max(section.virtualSize, section.rawSize);
      if (rva >= section.virtualAddress && rva < section.virtualAddress + span) {
        const delta = rva - section.virtualAddress;
        if (delta >= section.rawSize) return -1;
        const offset = section.rawPtr + delta;
        return offset < bytes.length ? offset : -1;
      }
    }
    return -1;
  };
  const exports = new Set();
  if (exportRva > 0 && exportSize > 0) {
    const dirOffset = rvaToOffset(exportRva);
    if (dirOffset >= 0 && dirOffset + 40 <= bytes.length) {
      const count = Math.min(bytes.readUInt32LE(dirOffset + 24), 200000);
      const namesOffset = rvaToOffset(bytes.readUInt32LE(dirOffset + 32));
      if (namesOffset >= 0 && namesOffset + count * 4 <= bytes.length) {
        for (let i = 0; i < count; i++) {
          const nameOffset = rvaToOffset(bytes.readUInt32LE(namesOffset + i * 4));
          if (nameOffset < 0) continue;
          const end = bytes.indexOf(0, nameOffset);
          const limit = end >= 0 ? Math.min(end, nameOffset + 256) : Math.min(bytes.length, nameOffset + 256);
          exports.add(bytes.subarray(nameOffset, limit).toString('ascii'));
        }
      }
    }
  }
  return { valid: true, x64: true, exports };
}

export function inspectQQ(root) {
  if (typeof root !== 'string' || !root.trim() || /^(?:\\\\|\/\/)/.test(root.trim())) {
    throw new Error('QQ 安装目录无效');
  }
  root = realpathSync(resolve(root));
  const prefix = root.endsWith(sep) ? root : root + sep;
  const config = JSON.parse(readFileSync(join(root, 'versions/config.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+-\d+$/.test(config.curVersion)) throw new Error('QQ 当前版本字段无效');
  const versionDir = realpathSync(join(root, 'versions', config.curVersion));
  if (!versionDir.toLowerCase().startsWith(prefix.toLowerCase())) throw new Error('QQ 版本目录超出安装目录');
  const appDir = join(versionDir, 'resources/app');
  const metadata = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
  if (metadata.version !== config.curVersion || metadata.eleArch !== 'x64') {
    throw new Error('QQ 版本配置不一致，或客户端不是 x64');
  }
  const executable = join(root, 'QQ.exe');
  const wrapper = join(appDir, 'wrapper.node');
  if (!statSync(executable).isFile() || !statSync(wrapper).isFile()) throw new Error('QQ 安装不完整');
  const runtimeBytes = readFileSync(join(versionDir, 'QQNT.dll'));
  const wrapperBytes = readFileSync(wrapper);
  const runtimePE = readPE64Info(runtimeBytes);
  const wrapperPE = readPE64Info(wrapperBytes);
  let fuses = null;
  try { fuses = readFuses(runtimeBytes); } catch { /* Optional in non-standard builds. */ }
  const missingExports = runtimePE.x64 ? requiredNapiExports.filter(name => !runtimePE.exports.has(name)) : requiredNapiExports;
  const targetMatch = metadata.version === '9.9.33-52230';
  const supported = metadata.eleArch === 'x64' && runtimePE.x64 && wrapperPE.x64 && missingExports.length === 0;
  return {
    root, executable, wrapper, version: metadata.version, arch: metadata.eleArch,
    bytecode: metadata.isByteCodeShell === true, fuses, targetMatch, supported, missingExports,
    runtimeVerified: false,
    bootstrap: 'frida-native',
    inspectorDisabledBuildDiagnostic: runtimeBytes.includes(Buffer.from('Inspector is not available when Node is compiled --without-v8-platform and --without-inspector.\0')),
    runtimeSha256: createHash('sha256').update(runtimeBytes).digest('hex'),
    wrapperSha256: createHash('sha256').update(wrapperBytes).digest('hex'),
  };
}
