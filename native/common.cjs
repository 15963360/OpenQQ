'use strict';

// Shared by the host process (validation before IPC) and the in-QQ script (validation before execution).
function fail(message, retcode = 1400) { return Object.assign(new Error(message), { retcode }); }

function identifier(value, name) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw fail(`${name} 必须是有效的 QQ 数值标识`);
  }
  return String(value);
}

// Optional OneBot booleans arrive as true/false, and some clients send 0/1 or "true"/"false".
function flag(value, name, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  throw fail(`${name} 必须为布尔值`);
}

function integer(value, name, min, max, fallback) {
  if (value === undefined || value === null) {
    if (fallback === undefined) throw fail(`${name} 不能为空`);
    return fallback;
  }
  const number = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < min || number > max) throw fail(`${name} 必须是 ${min}..${max} 的整数`);
  return number;
}

const nativeId = value => typeof value === 'string' && /^\d{1,24}$/.test(value);

module.exports = { fail, identifier, flag, integer, nativeId };
