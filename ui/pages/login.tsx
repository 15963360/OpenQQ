import { useState, type FormEvent } from 'react';
import { KeyRound, Monitor, Moon, Sun } from 'lucide-react';
import { useAuth } from '../lib/api';
import { usePreferences } from '../lib/preferences';
import { Brand } from '../components/brand';
import { Button } from '../components/ui/button';
import { Field, SecretInput } from '../components/ui/form';

export default function Login() {
  const setToken = useAuth(state => state.setToken);
  const theme = usePreferences(state => state.theme), setTheme = usePreferences(state => state.setTheme);
  const [value, setValue] = useState(''), [error, setError] = useState<string | null>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) { setError('请输入访问密钥'); return; }
    setToken(value.trim());
  }
  const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  return <div className="flex min-h-dvh flex-col">
    <header className="flex h-14 items-center justify-between px-4 sm:px-6">
      <Brand />
      <Button variant="ghost" size="icon-sm" aria-label="切换主题" onClick={() => setTheme(next)}><ThemeIcon /></Button>
    </header>
    <main className="flex flex-1 items-center justify-center px-4 pb-20">
      <div className="w-full max-w-sm">
        <div className="mb-6 grid gap-2 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-xl border bg-card shadow-sm"><KeyRound className="size-5 text-primary" aria-hidden /></span>
          <h1 className="mt-2 text-xl font-semibold tracking-[-0.02em]">输入访问密钥</h1>
          <p className="text-sm text-muted-foreground">打开终端显示的完整 WebUI 地址，或粘贴本次启动的访问密钥。</p>
        </div>
        <form onSubmit={submit} className="grid gap-4 rounded-xl border bg-card p-5 shadow-sm" noValidate>
          <Field label="访问密钥" htmlFor="token" error={error}>
            <SecretInput id="token" value={value} autoFocus placeholder="粘贴访问密钥" aria-invalid={Boolean(error)} aria-describedby={error ? 'token-hint' : undefined}
              onChange={event => { setValue(event.target.value); setError(null); }} />
          </Field>
          <Button type="submit" className="w-full">进入控制台</Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">密钥只保存在当前标签页，关闭后需要重新输入。</p>
      </div>
    </main>
  </div>;
}
