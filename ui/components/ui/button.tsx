import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

export const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-[color,background-color,border-color,box-shadow,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
        outline: 'border border-border bg-card text-foreground shadow-sm hover:border-border-strong hover:bg-muted',
        secondary: 'bg-muted text-foreground hover:bg-border/70',
        ghost: 'text-secondary-foreground hover:bg-muted hover:text-foreground',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:opacity-90',
        'destructive-ghost': 'text-destructive-text hover:bg-destructive/10',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:text-primary-hover hover:underline dark:text-primary',
      },
      size: {
        default: 'h-9 px-3.5',
        sm: 'h-8 px-3 text-caption',
        xs: 'h-7 gap-1.5 rounded-sm px-2 text-xs [&_svg:not([class*=size-])]:size-3.5',
        lg: 'h-10 px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-xs': 'size-7 rounded-sm [&_svg:not([class*=size-])]:size-3.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, loading, disabled, children, type, ...props }, ref) => {
  if (asChild) return <Slot.Root ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>{children}</Slot.Root>;
  return <button ref={ref} type={type ?? 'button'} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading && <LoaderCircle className="animate-spin" aria-hidden />}
    {children}
  </button>;
});
Button.displayName = 'Button';
