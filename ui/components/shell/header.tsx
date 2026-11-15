import { useState } from 'react';
import { Bell, ChevronRight, CircleAlert, CircleUserRound, LogOut, Menu, Monitor, Moon, Search, Settings, Sun, TriangleAlert, WandSparkles } from 'lucide-react';
import { useAuth } from '../../lib/api';
import { usePreferences, type ThemeChoice } from '../../lib/preferences';
import { navigate, useLocation } from '../../lib/router';
import { alertsOf, useStream } from '../../lib/stream';
import { cn, formatRelative, modKey } from '../../lib/utils';
import { findNav } from '../nav';
import { Brand } from '../brand';
import { Button } from '../ui/button';
import { Dialog, SheetContent } from '../ui/dialog';
import { Kbd } from '../ui/misc';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger, Tooltip } from '../ui/overlay';
import { StatusDot, sessionStatus } from '../status';
import { useCommandMenu } from './command-menu';
import { SessionFooter, SidebarNav } from './sidebar';

function ConnectionStatus() {
  const state = useStream(store => store.state), connected = useStream(store => store.connected), loaded = useStream(store => store.loaded);
  const meta = sessionStatus(state, connected, loaded);
  return <Tooltip content={meta.description}>
    <a href="/account" onClick={event => { event.preventDefault(); navigate('/account'); }}
      className="hidden h-8 items-center gap-2 rounded-md border bg-card px-2.5 text-caption font-medium text-secondary-foreground shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex">
      <StatusDot tone={meta.tone} pulse={meta.tone === 'success'} />
      <span>{meta.label}</span>
      {state.self_id && meta.tone === 'success' && <span className="tabular hidden font-mono text-xs text-muted-foreground md:inline">{state.self_id}</span>}
    </a>
  </Tooltip>;
}

function Notifications() {
  const entries = useStream(store => store.entries), seen = useStream(store => store.seenAlert), markSeen = useStream(store => store.markAlertsSeen);
  const alerts = alertsOf(entries).reverse();
  const unread = alerts.filter(item => item.id > seen).length;
  const open = (id: number, kind: string) => navigate((kind === 'diagnostic' ? '/logs?e=' : '/events?e=') + id);
  return <Popover>
    <Tooltip content="通知"><PopoverTrigger asChild>
      <Button variant="ghost" size="icon-sm" className="relative" aria-label={unread ? `通知，${unread} 条未读` : '通知'}>
        <Bell />
        {unread > 0 && <span className="tabular absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground ring-2 ring-background">{unread > 9 ? '9+' : unread}</span>}
      </Button>
    </PopoverTrigger></Tooltip>
    <PopoverContent className="w-[360px] p-0">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-semibold">通知</p>
        <Button variant="ghost" size="xs" disabled={!unread} onClick={markSeen}>全部标为已读</Button>
      </div>
      {alerts.length ? <ul className="max-h-96 overflow-y-auto p-1">
        {alerts.slice(0, 30).map(alert => <li key={alert.id}>
          <button type="button" onClick={() => { open(alert.id, alert.entry.kind); markSeen(); }} className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted">
            {alert.level === 'error' ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="错误" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-label="警告" />}
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex items-center gap-2"><span className="truncate font-mono text-caption font-medium">{alert.title}</span>{alert.id > seen && <span className="size-1.5 shrink-0 rounded-full bg-foreground" aria-label="未读" />}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{alert.message}</span>
            </span>
            <time className="shrink-0 text-2xs text-muted-foreground" dateTime={alert.time}>{formatRelative(alert.time)}</time>
          </button>
        </li>)}
      </ul> : <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <Bell className="size-5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">没有新的通知</p>
        <p className="text-xs text-muted-foreground">动作失败与运行异常会出现在这里</p>
      </div>}
    </PopoverContent>
  </Popover>;
}

const themeIcons = { light: Sun, dark: Moon, system: Monitor };
function ThemeMenu() {
  const theme = usePreferences(state => state.theme), resolved = usePreferences(state => state.resolvedTheme), setTheme = usePreferences(state => state.setTheme);
  const Icon = resolved === 'dark' ? Moon : Sun;
  return <DropdownMenu>
    <Tooltip content="主题"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="切换主题"><Icon /></Button></DropdownMenuTrigger></Tooltip>
    <DropdownMenuContent className="min-w-40">
      <DropdownMenuLabel>外观</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={theme} onValueChange={value => setTheme(value as ThemeChoice)}>
        {(['light', 'dark', 'system'] as const).map(value => { const ItemIcon = themeIcons[value]; return <DropdownMenuRadioItem key={value} value={value}><ItemIcon />{{ light: '浅色', dark: '深色', system: '跟随系统' }[value]}</DropdownMenuRadioItem>; })}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

function UserMenu() {
  const state = useStream(store => store.state), connected = useStream(store => store.connected), loaded = useStream(store => store.loaded);
  const meta = sessionStatus(state, connected, loaded);
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label="账户菜单" className="grid size-8 place-items-center rounded-full border bg-card text-xs font-semibold text-secondary-foreground shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring dark:bg-elevated">
        {state.self_id ? String(state.self_id).slice(-2) : <CircleUserRound className="size-4" />}
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="min-w-56">
      <div className="flex items-center gap-2.5 px-2 py-2">
        <StatusDot tone={meta.tone} />
        <div className="grid min-w-0 leading-tight">
          <span className="tabular truncate font-mono text-caption font-medium">{state.self_id ? 'QQ ' + state.self_id : '尚未登录'}</span>
          <span className="truncate text-xs text-muted-foreground">{meta.label}</span>
        </div>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => navigate('/account')}><CircleUserRound />账号与会话</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => navigate('/settings')}><Settings />设置</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => navigate('/setup')}><WandSparkles />接入向导</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem destructive onSelect={() => useAuth.getState().setToken('')}><LogOut />退出控制台</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="打开导航" onClick={() => setOpen(true)}><Menu /></Button>
    <SheetContent side="left" title={<Brand />} className="[&>div:first-child]:min-h-14">
      <div className="flex h-full flex-col">
        <div className="flex-1 px-3 py-3"><SidebarNav onNavigate={() => setOpen(false)} /></div>
        <div className="border-t p-2"><SessionFooter onNavigate={() => setOpen(false)} /></div>
      </div>
    </SheetContent>
  </Dialog>;
}

export function Header() {
  const { pathname } = useLocation();
  const current = findNav(pathname);
  const setOpen = useCommandMenu(state => state.setOpen);
  return <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:px-4 lg:px-6">
    <MobileNav />
    <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1.5 text-sm">
      <span className="hidden text-muted-foreground sm:inline">{current?.group.title ?? 'OpenQQ'}</span>
      <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground/70 sm:block" aria-hidden />
      <span className="truncate font-medium text-foreground" aria-current="page">{current?.title ?? '页面'}</span>
    </nav>
    <div className="ml-auto flex items-center gap-1.5">
      <button type="button" onClick={() => setOpen(true)} aria-label="打开命令面板"
        className={cn('hidden h-8 w-56 items-center gap-2 rounded-md border bg-card px-2.5 text-caption text-muted-foreground shadow-sm outline-none transition-colors hover:border-border-strong hover:text-secondary-foreground focus-visible:ring-2 focus-visible:ring-ring md:flex xl:w-64')}>
        <Search className="size-3.5" aria-hidden /><span>搜索或跳转…</span>
        <span className="ml-auto flex gap-0.5"><Kbd>{modKey}</Kbd><Kbd>K</Kbd></span>
      </button>
      <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="打开命令面板" onClick={() => setOpen(true)}><Search /></Button>
      <ConnectionStatus />
      <div className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
      <Notifications />
      <ThemeMenu />
      <UserMenu />
    </div>
  </header>;
}
