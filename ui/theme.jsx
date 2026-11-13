import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Button, Tooltip, theme as antdTheme } from 'antd';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';

const Context = createContext({ dark: false, toggle() {} });
const query = '(prefers-color-scheme: dark)';

function stored() {
  try { const value = localStorage.getItem('openqq-theme'); return value === 'light' || value === 'dark' ? value : null; } catch { return null; }
}

// Apply a saved choice before the first render so the page never paints in the wrong theme.
{ const initial = stored(); if (initial) document.documentElement.dataset.theme = initial; }

// Explicit choice wins; otherwise follow the operating system.
export function ThemeProvider({ children }) {
  const [choice, setChoice] = useState(stored);
  const [system, setSystem] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query), listener = event => setSystem(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  useEffect(() => {
    if (choice) document.documentElement.dataset.theme = choice; else delete document.documentElement.dataset.theme;
  }, [choice]);
  const dark = choice ? choice === 'dark' : system;
  const value = useMemo(() => ({ dark, toggle() {
    const next = dark ? 'light' : 'dark';
    setChoice(next);
    try { localStorage.setItem('openqq-theme', next); } catch {}
  } }), [dark]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useTheme = () => useContext(Context);

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  const label = dark ? '切换到浅色' : '切换到深色';
  return <Tooltip title={label}><Button type="text" aria-label={label} icon={dark ? <SunOutlined /> : <MoonOutlined />} onClick={toggle} /></Tooltip>;
}

const shared = { borderRadius: 8, borderRadiusLG: 12, fontSize: 14, controlHeight: 36,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  fontFamilyCode: 'ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, monospace', boxShadow: 'none', boxShadowSecondary: '0 8px 24px rgba(0,0,0,.08)' };
const light = { colorPrimary: '#2563eb', colorInfo: '#2563eb', colorSuccess: '#16a34a', colorWarning: '#ca8a04', colorError: '#dc2626', colorLink: '#2563eb',
  colorText: '#18181b', colorTextSecondary: '#52525b', colorTextTertiary: '#a1a1aa', colorBgLayout: '#fafafa', colorBgContainer: '#ffffff',
  colorBorder: '#e4e4e7', colorBorderSecondary: '#f0f0f2', colorFillAlter: '#f4f4f5' };
const dark = { colorPrimary: '#3b82f6', colorInfo: '#3b82f6', colorSuccess: '#4ade80', colorWarning: '#facc15', colorError: '#f87171', colorLink: '#60a5fa',
  colorText: '#fafafa', colorTextSecondary: '#a1a1aa', colorTextTertiary: '#71717a', colorBgLayout: '#09090b', colorBgContainer: '#111113', colorBgElevated: '#1c1c1f',
  colorBorder: '#2e2e33', colorBorderSecondary: '#232326', colorFillAlter: '#1c1c1f' };

export function antdThemeConfig(isDark) {
  return { algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: { ...shared, ...(isDark ? dark : light) },
    components: { Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' }, Segmented: { trackPadding: 3 } } };
}
