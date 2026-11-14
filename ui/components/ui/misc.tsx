import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border bg-muted px-1 font-mono text-2xs font-medium text-muted-foreground', className)} {...props} />;
}

export function Separator({ className, vertical, ...props }: HTMLAttributes<HTMLDivElement> & { vertical?: boolean }) {
  return <div role="separator" aria-orientation={vertical ? 'vertical' : 'horizontal'} className={cn('shrink-0 bg-border', vertical ? 'h-4 w-px' : 'h-px w-full', className)} {...props} />;
}
