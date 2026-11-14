import { useEffect } from 'react';
import { create } from 'zustand';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Braces, CornerDownLeft, LogOut, Monitor, Moon, PanelLeft, Sun, Users, User, WandSparkles } from 'lucide-react';
import { useAuth } from '../../lib/api';
import { catalog } from '../../lib/catalog';
import { useConversations } from '../../lib/conversations';
import { usePreferences } from '../../lib/preferences';
import { navigate } from '../../lib/router';
import { isEditableTarget } from '../../lib/utils';
import { navItems } from '../nav';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { Kbd } from '../ui/misc';

export const useCommandMenu = create<{ open: boolean; setOpen(open: boolean): void }>(set => ({ open: false, setOpen: open => set({ open }) }));

export function CommandMenu() {
  const { open, setOpen } = useCommandMenu();
  const conversations = useConversations(state => state.conversations);
  const setTheme = usePreferences(state => state.setTheme);
  const compact = usePreferences(state => state.compact);
  const setCompact = usePreferences(state => state.setCompact);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen(!useCommandMenu.getState().open); }
      else if (event.key === '/' && !isEditableTarget(event.target) && !useCommandMenu.getState().open) { event.preventDefault(); setOpen(true); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const run = (action: () => void) => () => { setOpen(false); action(); };
  const recent = Object.values(conversations).sort((a, b) => b.lastTime.localeCompare(a.lastTime)).slice(0, 6);

  return <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
      <DialogPrimitive.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-lg outline-none data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out">
        <DialogPrimitive.Title className="sr-only">命令面板</DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">搜索页面、会话与动作，回车执行</DialogPrimitive.Description>
        <Command loop>
          <CommandInput placeholder="搜索页面、会话或动作…" />
          <CommandList>
            <CommandEmpty>没有匹配的结果</CommandEmpty>
            <CommandGroup heading="页面">
              {navItems.map(item => { const Icon = item.icon; return <CommandItem key={item.path} value={`page ${item.title} ${item.keywords ?? ''}`} onSelect={run(() => navigate(item.path))}>
                <Icon />{item.title}<span className="ml-auto truncate text-xs text-muted-foreground">{item.description}</span>
              </CommandItem>; })}
            </CommandGroup>
            {recent.length > 0 && <CommandGroup heading="最近会话">
              {recent.map(item => <CommandItem key={item.id} value={`conversation ${item.name} ${item.target}`} onSelect={run(() => navigate('/messages?c=' + item.id))}>
                {item.type === 'group' ? <Users /> : <User />}<span className="truncate">{item.name}</span><span className="tabular ml-auto font-mono text-xs text-muted-foreground">{item.target}</span>
              </CommandItem>)}
            </CommandGroup>}
            <CommandGroup heading="OneBot 动作">
              {catalog.map(spec => <CommandItem key={spec.action} value={`action ${spec.action} ${spec.summary}`} onSelect={run(() => navigate('/actions?a=' + spec.action))}>
                <Braces /><span className="font-mono text-caption">{spec.action}</span><span className="ml-auto truncate text-xs text-muted-foreground">{spec.summary}</span>
              </CommandItem>)}
            </CommandGroup>
            <CommandGroup heading="操作">
              <CommandItem value="theme light 浅色主题" onSelect={run(() => setTheme('light'))}><Sun />切换到浅色主题</CommandItem>
              <CommandItem value="theme dark 深色主题" onSelect={run(() => setTheme('dark'))}><Moon />切换到深色主题</CommandItem>
              <CommandItem value="theme system 跟随系统主题" onSelect={run(() => setTheme('system'))}><Monitor />主题跟随系统</CommandItem>
              <CommandItem value="sidebar compact 紧凑侧边栏" onSelect={run(() => setCompact(!compact))}><PanelLeft />{compact ? '展开侧边栏' : '收起侧边栏'}</CommandItem>
              <CommandItem value="setup wizard 接入向导" onSelect={run(() => navigate('/setup'))}><WandSparkles />打开接入向导</CommandItem>
              <CommandItem value="logout 退出控制台" onSelect={run(() => useAuth.getState().setToken(''))}><LogOut />退出控制台</CommandItem>
            </CommandGroup>
          </CommandList>
          <div className="flex items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd>选择</span>
            <span className="flex items-center gap-1"><Kbd><CornerDownLeft className="size-3" /></Kbd>执行</span>
            <span className="flex items-center gap-1"><Kbd>Esc</Kbd>关闭</span>
          </div>
        </Command>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
