import { create } from 'zustand';

export type ThemeChoice = 'system' | 'light' | 'dark';
type Resolved = 'light' | 'dark';

function read(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, value: string | null) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

const media = matchMedia('(prefers-color-scheme: dark)');
const storedTheme = read('openqq-theme');
const initialChoice: ThemeChoice = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'system';
const resolve = (choice: ThemeChoice): Resolved => choice === 'system' ? (media.matches ? 'dark' : 'light') : choice;

function apply(theme: Resolved) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
apply(resolve(initialChoice));

interface Preferences {
  theme: ThemeChoice;
  resolvedTheme: Resolved;
  setTheme(choice: ThemeChoice): void;
  compact: boolean;
  setCompact(value: boolean): void;
  collapsedGroups: string[];
  toggleGroup(id: string): void;
}

export const usePreferences = create<Preferences>((set, get) => ({
  theme: initialChoice,
  resolvedTheme: resolve(initialChoice),
  setTheme(choice) {
    write('openqq-theme', choice === 'system' ? null : choice);
    const resolvedTheme = resolve(choice);
    apply(resolvedTheme);
    set({ theme: choice, resolvedTheme });
  },
  compact: read('openqq-sidebar') === 'compact',
  setCompact(value) { write('openqq-sidebar', value ? 'compact' : null); set({ compact: value }); },
  collapsedGroups: (read('openqq-groups') || '').split(',').filter(Boolean),
  toggleGroup(id) {
    const current = get().collapsedGroups;
    const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
    write('openqq-groups', next.join(',') || null);
    set({ collapsedGroups: next });
  },
}));

media.addEventListener('change', () => {
  const { theme } = usePreferences.getState();
  if (theme !== 'system') return;
  const resolvedTheme = resolve('system');
  apply(resolvedTheme);
  usePreferences.setState({ resolvedTheme });
});
