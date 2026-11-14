import { create } from 'zustand';

const storageKey = 'openqq-token';

// The access key arrives once in the URL fragment (never sent to the server) and then lives in sessionStorage only.
function readInitialToken() {
  const fragment = new URLSearchParams(location.hash.slice(1)).get('token');
  let token = fragment || '';
  try { token ||= sessionStorage.getItem(storageKey) || ''; if (fragment) sessionStorage.setItem(storageKey, token); } catch { /* storage unavailable */ }
  if (fragment) history.replaceState(null, '', location.pathname + location.search);
  return token;
}

interface AuthStore { token: string; setToken(value: string): void }
export const useAuth = create<AuthStore>(set => ({
  token: readInitialToken(),
  setToken(value) {
    try { if (value) sessionStorage.setItem(storageKey, value); else sessionStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
    set({ token: value });
  },
}));

export type ApiErrorKind = 'http' | 'timeout' | 'network' | 'unauthorized';
export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  constructor(message: string, status: number, kind: ApiErrorKind = 'http') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
  }
}

const maxBody = 256 * 1024;

export async function request<T>(path: string, body?: unknown, { timeout = 25000 }: { timeout?: number } = {}): Promise<T> {
  const token = useAuth.getState().token;
  const json = body === undefined ? undefined : JSON.stringify(body);
  if (json && new TextEncoder().encode(json).length > maxBody) throw new ApiError('请求内容超过 256 KiB', 413);
  let response: Response;
  try {
    response = await fetch(path, {
      method: json === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(timeout), body: json,
      headers: { Authorization: 'Bearer ' + token, ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) },
    });
  } catch (error) {
    if ((error as Error).name === 'TimeoutError') throw new ApiError('等待响应超时', 0, 'timeout');
    throw new ApiError('无法连接 OpenQQ，请确认终端中的进程仍在运行', 0, 'network');
  }
  if (response.status === 401) {
    useAuth.getState().setToken('');
    throw new ApiError('访问密钥已失效，请使用本次启动的完整 WebUI 地址', 401, 'unauthorized');
  }
  let result: unknown;
  try { result = await response.json(); } catch { throw new ApiError('响应格式无效', response.status); }
  if (!response.ok) throw new ApiError((result as { message?: string })?.message || '请求失败', response.status);
  return result as T;
}
