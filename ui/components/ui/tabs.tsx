import type { ComponentProps, ReactNode } from 'react';
import { Tabs as TabsPrimitive, ToggleGroup } from 'radix-ui';
import { cn } from '../../lib/utils';

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex items-center gap-4 border-b', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger className={cn('relative -mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent px-0.5 text-caption font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground [&_svg]:size-4', className)} {...props} />;
}

export interface SegmentOption<T extends string> { value: T; label: ReactNode; count?: number }
interface SegmentedProps<T extends string> { value: T; onValueChange(value: NoInfer<T>): void; options: SegmentOption<NoInfer<T>>[]; className?: string; 'aria-label': string; size?: 'sm' | 'default' }

/** Single-choice segmented control (filters, modes). Always keeps one option selected. */
export function Segmented<T extends string>({ value, onValueChange, options, className, size = 'sm', ...rest }: SegmentedProps<T>) {
  return <ToggleGroup.Root type="single" value={value} onValueChange={next => { if (next) onValueChange(next as T); }} aria-label={rest['aria-label']}
    className={cn('inline-flex shrink-0 items-center rounded-md bg-muted p-0.5', size === 'sm' ? 'h-8' : 'h-9', className)}>
    {options.map(option => <ToggleGroup.Item key={option.value} value={option.value}
      className={cn('inline-flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] px-2.5 text-caption font-medium text-muted-foreground outline-none transition-[color,background-color,box-shadow] duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-elevated')}>
      {option.label}
      {option.count != null && <span className="tabular text-2xs text-muted-foreground">{option.count}</span>}
    </ToggleGroup.Item>)}
  </ToggleGroup.Root>;
}
