import type { ComponentProps, ReactNode } from 'react';
import { AlertDialog as AlertPrimitive, Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button, buttonVariants } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlay = 'fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out';

function Close() {
  return <DialogPrimitive.Close asChild><Button variant="ghost" size="icon-sm" className="absolute right-3 top-3" aria-label="关闭"><X /></Button></DialogPrimitive.Close>;
}

export function DialogContent({ className, children, hideClose, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean }) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className={overlay} />
    <DialogPrimitive.Content className={cn('fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-popover p-5 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out', className)} {...props}>
      {children}
      {!hideClose && <Close />}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>;
}

export function DialogHeader({ title, description, className }: { title: ReactNode; description?: ReactNode; className?: string }) {
  return <div className={cn('grid gap-1 pr-8', className)}>
    <DialogPrimitive.Title className="text-base font-semibold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
    {description ? <DialogPrimitive.Description className="text-caption text-muted-foreground">{description}</DialogPrimitive.Description>
      : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
  </div>;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

/** Side drawer for details and mobile navigation. */
export function SheetContent({ className, children, side = 'right', title, description, actions, ...props }:
  Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> & { side?: 'left' | 'right'; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className={overlay} />
    <DialogPrimitive.Content className={cn('fixed inset-y-0 z-50 flex w-full flex-col bg-popover text-popover-foreground shadow-lg outline-none',
      side === 'right' ? 'right-0 max-w-[min(600px,100vw)] border-l data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out'
        : 'left-0 max-w-[min(300px,85vw)] border-r data-[state=open]:animate-sheet-left-in data-[state=closed]:animate-sheet-left-out', className)} {...props}>
      <div className="flex min-h-14 items-center gap-3 border-b px-5 py-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <DialogPrimitive.Title className="truncate text-sm font-semibold">{title}</DialogPrimitive.Title>
          {description ? <DialogPrimitive.Description className="truncate text-xs text-muted-foreground">{description}</DialogPrimitive.Description>
            : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
        </div>
        {actions}
        <DialogPrimitive.Close asChild><Button variant="ghost" size="icon-sm" aria-label="关闭"><X /></Button></DialogPrimitive.Close>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>;
}

interface ConfirmProps {
  open: boolean; onOpenChange(open: boolean): void; title: ReactNode; description: ReactNode;
  confirmLabel: string; onConfirm(): void; destructive?: boolean;
}
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, destructive }: ConfirmProps) {
  return <AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <AlertPrimitive.Portal>
      <AlertPrimitive.Overlay className={overlay} />
      <AlertPrimitive.Content className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-popover p-5 shadow-lg outline-none data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out">
        <div className="grid gap-1.5">
          <AlertPrimitive.Title className="text-base font-semibold">{title}</AlertPrimitive.Title>
          <AlertPrimitive.Description className="text-caption text-muted-foreground">{description}</AlertPrimitive.Description>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertPrimitive.Cancel className={buttonVariants({ variant: 'outline' })}>取消</AlertPrimitive.Cancel>
          <AlertPrimitive.Action className={buttonVariants({ variant: destructive ? 'destructive' : 'default' })} onClick={onConfirm}>{confirmLabel}</AlertPrimitive.Action>
        </div>
      </AlertPrimitive.Content>
    </AlertPrimitive.Portal>
  </AlertPrimitive.Root>;
}
