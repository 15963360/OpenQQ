import { cn } from '../lib/utils';

export function BrandMark({ className }: { className?: string }) {
  return <span className={cn('brand-mark grid size-6 shrink-0 place-items-center rounded-[7px] bg-primary text-primary-foreground shadow-sm', className)} aria-hidden>
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="7.5" cy="7.5" r="4.75" />
      <path d="M10.5 10.5 13 13" />
    </svg>
  </span>;
}

export function Brand({ compact, className }: { compact?: boolean; className?: string }) {
  return <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
    <BrandMark />
    {!compact && <span className="truncate text-[15px] font-semibold tracking-[-0.015em] text-foreground">OpenQQ</span>}
  </span>;
}
