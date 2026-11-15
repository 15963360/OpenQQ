import type { ReactNode } from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { styleNonce } from '../../lib/nonce';

export interface SelectOption { value: string; label: ReactNode; description?: ReactNode }
interface SelectProps {
  value: string;
  onValueChange(value: string): void;
  options: SelectOption[];
  id?: string;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'default';
  disabled?: boolean;
  'aria-label'?: string;
}

export function Select({ value, onValueChange, options, id, placeholder, className, size = 'default', disabled, ...rest }: SelectProps) {
  return <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
    <SelectPrimitive.Trigger id={id} aria-label={rest['aria-label']} className={cn('inline-flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm shadow-sm outline-none transition-[border-color,box-shadow] duration-150 hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-50 data-[placeholder]:text-muted-foreground [&>span]:truncate',
      size === 'sm' ? 'h-8 text-caption' : 'h-9', className)}>
      <SelectPrimitive.Value placeholder={placeholder} />
      <SelectPrimitive.Icon asChild><ChevronDown className="size-4 shrink-0 text-muted-foreground" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content position="popper" sideOffset={4} className="relative z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out">
        <SelectPrimitive.Viewport nonce={styleNonce} className="p-1">
          {options.map(option => <SelectPrimitive.Item key={option.value} value={option.value}
            className="relative flex min-h-8 cursor-default select-none items-center rounded-md py-1.5 pl-2 pr-8 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50">
            <div className="grid min-w-0"><SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              {option.description && <span className="text-xs text-muted-foreground">{option.description}</span>}</div>
            <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex"><Check className="size-4 text-foreground" /></SelectPrimitive.ItemIndicator>
          </SelectPrimitive.Item>)}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}
