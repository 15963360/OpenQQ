import type { MouseEvent } from 'react';
import { Collapsible } from 'radix-ui';
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '../../lib/utils';
import { navigate, useLocation } from '../../lib/router';
import { usePreferences } from '../../lib/preferences';
import { useStream } from '../../lib/stream';
import { useConversations } from '../../lib/conversations';
import { navGroups, type NavItem } from '../nav';
import { Brand } from '../brand';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/overlay';
import { StatusDot, sessionStatus } from '../status';

export function linkHandler(path: string, after?: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(path);
    after?.();
  };
}

function useBadges() {
  const unread = useConversations(state => Object.values(state.conversations).reduce((sum, item) => sum + item.unread, 0));
  return { '/messages': unread } as Record<string, number>;
}

function NavLink({ item, active, compact, badge, onNavigate }: { item: NavItem; active: boolean; compact: boolean; badge?: number; onNavigate?: () => void }) {
  const Icon = item.icon;
  const link = <a href={item.path} onClick={linkHandler(item.path, onNavigate)} aria-current={active ? 'page' : undefined} aria-label={compact ? item.title : undefined}
    className={cn('group relative flex h-8 items-center gap-2.5 rounded-md text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
      compact ? 'w-9 justify-center' : 'px-2.5',
      active ? 'bg-card font-medium text-foreground shadow-sm ring-1 ring-border dark:bg-elevated dark:ring-transparent' : 'text-secondary-foreground hover:bg-muted hover:text-foreground')}>
    <Icon className={cn('size-4 shrink-0 transition-colors', active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')} aria-hidden />
    {!compact && <span className="truncate">{item.title}</span>}
    {badge ? compact
      ? <span className="absolute right-1 top-1 size-2 rounded-full bg-foreground ring-2 ring-background" aria-label={badge + ' 条未读'} />
      : <span className="tabular ml-auto min-w-5 rounded-full bg-foreground/10 px-1.5 text-center text-2xs font-semibold leading-5 text-foreground">{badge > 99 ? '99+' : badge}</span>
      : null}
  </a>;
  return compact ? <Tooltip content={item.title} side="right">{link}</Tooltip> : link;
}

/** Navigation tree shared by the desktop sidebar and the mobile drawer. */
export function SidebarNav({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const collapsed = usePreferences(state => state.collapsedGroups);
  const toggleGroup = usePreferences(state => state.toggleGroup);
  const badges = useBadges();
  return <nav aria-label="主导航" className={cn('flex flex-col gap-4', compact && 'items-center')}>
    {navGroups.map((group, index) => {
      const open = compact || !collapsed.includes(group.id);
      return <Collapsible.Root key={group.id} open={open} onOpenChange={() => toggleGroup(group.id)} className={cn('grid gap-0.5', compact && 'justify-items-center')}>
        {compact ? index > 0 && <div className="mb-2 h-px w-6 bg-border" aria-hidden />
          : <Collapsible.Trigger className="group/trigger flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            {group.title}
            <ChevronDown className="size-3 transition-transform duration-200 group-data-[state=closed]/trigger:-rotate-90" aria-hidden />
          </Collapsible.Trigger>}
        <Collapsible.Content className="grid gap-0.5 overflow-hidden">
          {group.items.map(item => <NavLink key={item.path} item={item} active={pathname === item.path} compact={compact} badge={badges[item.path]} onNavigate={onNavigate} />)}
        </Collapsible.Content>
      </Collapsible.Root>;
    })}
  </nav>;
}

export function SessionFooter({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const state = useStream(store => store.state), connected = useStream(store => store.connected), loaded = useStream(store => store.loaded);
  const meta = sessionStatus(state, connected, loaded);
  const label = state.self_id ? String(state.self_id) : '未登录';
  const content = <a href="/account" onClick={linkHandler('/account', onNavigate)} aria-label={compact ? `账号 ${label}，${meta.label}` : undefined}
    className={cn('flex items-center gap-2.5 rounded-lg outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', compact ? 'size-9 justify-center' : 'p-2')}>
    <span className="relative grid size-8 shrink-0 place-items-center rounded-full border bg-card text-xs font-semibold text-secondary-foreground dark:bg-elevated">
      {state.self_id ? String(state.self_id).slice(-2) : 'QQ'}
      <StatusDot tone={meta.tone} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-background rounded-full" />
    </span>
    {!compact && <span className="grid min-w-0 leading-tight">
      <span className="tabular truncate font-mono text-caption font-medium text-foreground">{label}</span>
      <span className="truncate text-xs text-muted-foreground">{meta.label}{state.version ? ' · QQ ' + state.version : ''}</span>
    </span>}
  </a>;
  return compact ? <Tooltip content={`${label} · ${meta.label}`} side="right">{content}</Tooltip> : content;
}

export function Sidebar() {
  const compact = usePreferences(state => state.compact);
  const setCompact = usePreferences(state => state.setCompact);
  return <aside className={cn('sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-background transition-[width] duration-200 ease-out lg:flex', compact ? 'w-(--sidebar-compact)' : 'w-(--sidebar-width)')}>
    <div className={cn('flex h-14 shrink-0 items-center', compact ? 'justify-center' : 'justify-between pl-4 pr-2.5')}>
      {!compact && <a href="/" onClick={linkHandler('/')} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="OpenQQ 概览"><Brand /></a>}
      <Tooltip content={compact ? '展开侧边栏' : '收起侧边栏'} side="right">
        <Button variant="ghost" size="icon-sm" onClick={() => setCompact(!compact)} aria-label={compact ? '展开侧边栏' : '收起侧边栏'}>
          {compact ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      </Tooltip>
    </div>
    <div className={cn('min-h-0 flex-1 overflow-y-auto py-2', compact ? 'px-2' : 'px-3')}><SidebarNav compact={compact} /></div>
    <div className={cn('shrink-0 border-t py-2', compact ? 'flex justify-center px-2' : 'px-2')}><SessionFooter compact={compact} /></div>
  </aside>;
}
