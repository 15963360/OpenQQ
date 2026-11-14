import type { ReactNode } from 'react';
import { Eraser, Pause, Play } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip } from './ui/overlay';

export function StreamControls({ paused, pending, onTogglePause, onClear }: { paused: boolean; pending: number; onTogglePause(): void; onClear(): void }) {
  return <div className="flex items-center gap-1">
    <Tooltip content={paused ? '继续实时更新' : '暂停实时更新'}>
      <Button variant={paused ? 'secondary' : 'outline'} size="sm" onClick={onTogglePause} aria-pressed={paused}>
        {paused ? <Play /> : <Pause />}{paused ? (pending ? `继续 · ${pending} 条新` : '继续') : '暂停'}
      </Button>
    </Tooltip>
    <Tooltip content="清空当前视图（不影响服务端记录）">
      <Button variant="ghost" size="icon-sm" aria-label="清空当前视图" onClick={onClear}><Eraser /></Button>
    </Tooltip>
  </div>;
}

export function ListFooter({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground sm:px-5">{children}</div>;
}
