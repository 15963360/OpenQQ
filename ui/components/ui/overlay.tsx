import type { ComponentProps, ReactNode } from 'react';
import { DropdownMenu as Menu, Popover as PopoverPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Kbd } from './misc';

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps { content: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left'; shortcut?: string[]; disabled?: boolean }
export function Tooltip({ content, children, side = 'top', shortcut, disabled }: TooltipProps) {
  if (disabled) return <>{children}</>;
  return <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content side={side} sideOffset={6} collisionPadding={8}
        className="z-[60] flex max-w-72 items-center gap-2 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md data-[state=delayed-open]:animate-fade-in data-[state=closed]:animate-fade-out">
        {content}
        {shortcut && <span className="flex gap-0.5">{shortcut.map(key => <Kbd key={key} className="border-transparent bg-background/15 text-background">{key}</Kbd>)}</span>}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>;
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, align = 'end', sideOffset = 6, ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content align={align} sideOffset={sideOffset} collisionPadding={8}
      className={cn('z-50 w-80 rounded-xl border bg-popover text-popover-foreground shadow-md outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out', className)} {...props} />
  </PopoverPrimitive.Portal>;
}

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

export function DropdownMenuContent({ className, align = 'end', sideOffset = 6, ...props }: ComponentProps<typeof Menu.Content>) {
  return <Menu.Portal>
    <Menu.Content align={align} sideOffset={sideOffset} collisionPadding={8}
      className={cn('z-50 min-w-48 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out', className)} {...props} />
  </Menu.Portal>;
}

const item = 'relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground';

export function DropdownMenuItem({ className, destructive, ...props }: ComponentProps<typeof Menu.Item> & { destructive?: boolean }) {
  return <Menu.Item className={cn(item, destructive && 'text-destructive-text data-[highlighted]:bg-destructive/10 [&_svg]:text-destructive-text', className)} {...props} />;
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof Menu.RadioItem>) {
  return <Menu.RadioItem className={cn(item, 'pr-8', className)} {...props}>
    {children}
    <Menu.ItemIndicator className="absolute right-2 inline-flex"><Check className="!text-foreground" /></Menu.ItemIndicator>
  </Menu.RadioItem>;
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}
