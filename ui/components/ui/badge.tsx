import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const badgeVariants = cva('inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-2xs font-medium [&_svg]:size-3 [&_svg]:shrink-0', {
  variants: {
    tone: {
      neutral: 'border-border bg-muted text-secondary-foreground',
      primary: 'border-foreground/15 bg-foreground/[0.06] text-foreground',
      success: 'border-success/25 bg-success/10 text-success-text',
      warning: 'border-warning/25 bg-warning/10 text-warning-text',
      destructive: 'border-destructive/25 bg-destructive/10 text-destructive-text',
      outline: 'border-border bg-transparent text-secondary-foreground',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
