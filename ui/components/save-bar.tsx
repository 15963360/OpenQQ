import { CircleAlert } from 'lucide-react';
import { Button } from './ui/button';

interface SaveBarProps { dirty: boolean; valid: boolean; saving: boolean; running: boolean; onSave(): void; onReset(): void }

/** Floating bar shown while a page holds unsaved configuration changes. */
export function SaveBar({ dirty, valid, saving, running, onSave, onReset }: SaveBarProps) {
  if (!dirty) return null;
  return <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center px-4" role="region" aria-label="未保存的更改">
    <div className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-3 rounded-xl border bg-popover px-4 py-2.5 shadow-lg animate-toast-in">
      <span className="flex min-w-0 flex-1 items-center gap-2 text-caption">
        {valid ? <span className="size-2 shrink-0 rounded-full bg-warning" aria-hidden /> : <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />}
        <span className="truncate">{valid ? running ? '有未保存的更改 · 保存后需重启 OpenQQ 生效' : '有未保存的更改' : '请先修正标红的字段'}</span>
      </span>
      <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>放弃</Button>
      <Button size="sm" onClick={onSave} loading={saving} disabled={!valid}>保存更改</Button>
    </div>
  </div>;
}
