import type { ReactNode } from 'react';
import { AtSign, File, Forward, Image, LayoutTemplate, Mic, Reply, Smile, Sticker, Video, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Segment } from '../lib/types';

const media: Record<string, [string, LucideIcon]> = {
  image: ['图片', Image], record: ['语音', Mic], video: ['视频', Video], file: ['文件', File], face: ['表情', Smile], mface: ['商城表情', Sticker],
  json: ['应用卡片', LayoutTemplate], xml: ['卡片', LayoutTemplate], markdown: ['Markdown', LayoutTemplate], forward: ['合并转发', Forward],
};

function appName(raw: unknown) {
  try { const card = typeof raw === 'string' ? JSON.parse(raw) : raw; return String(card?.prompt || card?.app || '').slice(0, 40); } catch { return ''; }
}

function Chip({ icon: Icon, children, className }: { icon: LucideIcon; children: ReactNode; className?: string }) {
  return <span className={cn('mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border bg-card/60 px-1.5 py-px align-baseline text-xs text-secondary-foreground', className)}>
    <Icon className="size-3 shrink-0" aria-hidden /><span className="truncate">{children}</span>
  </span>;
}

/** Renders OneBot message segments as text plus labelled attachment chips (media itself is not fetched). */
export function Segments({ segments, className }: { segments: Segment[]; className?: string }) {
  if (!segments.length) return <span className="text-muted-foreground">（空消息）</span>;
  return <span className={cn('whitespace-pre-wrap [overflow-wrap:anywhere]', className)}>
    {segments.map((segment, index) => {
      const data = segment.data ?? {};
      if (segment.type === 'text') return <span key={index}>{String(data.text ?? '')}</span>;
      if (segment.type === 'at') return <Chip key={index} icon={AtSign} className="border-border bg-muted font-medium text-foreground">{data.qq === 'all' ? '全体成员' : String(data.qq ?? '')}</Chip>;
      if (segment.type === 'reply') return <Chip key={index} icon={Reply}>回复 #{String(data.id ?? '')}</Chip>;
      const [label, icon] = media[segment.type] ?? ['消息段 ' + segment.type, LayoutTemplate];
      const extra = segment.type === 'json' ? appName(data.data)
        : segment.type === 'forward' && Array.isArray(data.content) ? data.content.length + ' 条'
        : segment.type === 'file' && data.name ? String(data.name)
        : '';
      return <Chip key={index} icon={icon}>{label}{extra && ' · ' + extra}</Chip>;
    })}
  </span>;
}
