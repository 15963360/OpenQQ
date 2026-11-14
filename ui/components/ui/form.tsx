import { forwardRef, useState, type ComponentProps, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { Eye, EyeOff, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

const control = 'w-full min-w-0 rounded-md border border-input bg-card text-sm text-foreground shadow-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/75 hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) =>
  <input ref={ref} className={cn(control, 'h-9 px-3', className)} {...props} />);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) =>
  <textarea ref={ref} className={cn(control, 'min-h-20 resize-y px-3 py-2 leading-relaxed', className)} {...props} />);
Textarea.displayName = 'Textarea';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-caption font-medium text-foreground', className)} {...props} />;
}

interface FieldProps { label: ReactNode; htmlFor: string; description?: ReactNode; error?: string | null; children: ReactNode; className?: string; action?: ReactNode }
/** Label + control + description/error. Controls should set aria-describedby={`${htmlFor}-hint`} and aria-invalid. */
export function Field({ label, htmlFor, description, error, children, className, action }: FieldProps) {
  return <div className={cn('grid gap-1.5', className)}>
    <div className="flex items-center justify-between gap-2"><Label htmlFor={htmlFor}>{label}</Label>{action}</div>
    {children}
    {(error || description) && <p id={htmlFor + '-hint'} className={cn('text-xs', error ? 'text-destructive-text' : 'text-muted-foreground')} role={error ? 'alert' : undefined}>{error || description}</p>}
  </div>;
}

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> { value: string; onValueChange(value: string): void }
export function SearchInput({ value, onValueChange, className, placeholder = '搜索', ...props }: SearchInputProps) {
  return <div className={cn('relative min-w-0', className)}>
    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    <Input type="search" value={value} onChange={event => onValueChange(event.target.value)} placeholder={placeholder} aria-label={props['aria-label'] ?? placeholder}
      className="h-8 pl-8 pr-8 text-caption [&::-webkit-search-cancel-button]:hidden" {...props} />
    {value && <button type="button" onClick={() => onValueChange('')} aria-label="清除搜索"
      className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3.5" /></button>}
  </div>;
}

export const SecretInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => {
  const [visible, setVisible] = useState(false);
  return <div className="relative">
    <Input ref={ref} type={visible ? 'text' : 'password'} autoComplete="off" spellCheck={false} className={cn('pr-9 font-mono text-caption', className)} {...props} />
    <button type="button" onClick={() => setVisible(value => !value)} aria-label={visible ? '隐藏' : '显示'} aria-pressed={visible}
      className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground">
      {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
    </button>
  </div>;
});
SecretInput.displayName = 'SecretInput';

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return <SwitchPrimitive.Root className={cn('peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-border-strong', className)} {...props}>
    <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-150 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5" />
  </SwitchPrimitive.Root>;
}
