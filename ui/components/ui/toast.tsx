import { Toast as ToastPrimitive } from 'radix-ui';
import { create } from 'zustand';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem { id: number; tone: ToastTone; title: string; description?: string; open: boolean }

const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }));
let nextId = 0;

function show(tone: ToastTone, title: string, description?: string) {
  const item: ToastItem = { id: ++nextId, tone, title, description, open: true };
  useToasts.setState(state => ({ items: [...state.items.slice(-3), item] }));
}
export const toast = {
  success: (title: string, description?: string) => show('success', title, description),
  error: (title: string, description?: string) => show('error', title, description),
  info: (title: string, description?: string) => show('info', title, description),
};

export async function copyText(value: string, label = '已复制到剪贴板') {
  try { await navigator.clipboard.writeText(value); toast.success(label); }
  catch { toast.error('复制失败', '请手动选择文本复制'); }
}

const icons = { success: CircleCheck, error: CircleAlert, info: Info };
const colors = { success: 'text-success', error: 'text-destructive', info: 'text-primary' };

export function Toaster() {
  const items = useToasts(state => state.items);
  const close = (id: number) => useToasts.setState(state => ({ items: state.items.map(item => item.id === id ? { ...item, open: false } : item) }));
  const remove = (id: number) => useToasts.setState(state => ({ items: state.items.filter(item => item.id !== id) }));
  return <ToastPrimitive.Provider swipeDirection="right" duration={4000} label="通知">
    {items.map(item => {
      const Icon = icons[item.tone];
      return <ToastPrimitive.Root key={item.id} open={item.open} type={item.tone === 'error' ? 'foreground' : 'background'} duration={item.tone === 'error' ? 6000 : 4000}
        onOpenChange={open => { if (!open) { close(item.id); setTimeout(() => remove(item.id), 200); } }}
        className="group pointer-events-auto relative flex w-full items-start gap-3 rounded-lg border bg-popover p-3 pr-9 text-popover-foreground shadow-md data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform data-[swipe=end]:translate-x-(--radix-toast-swipe-end-x) data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x)">
        <Icon className={cn('mt-0.5 size-4 shrink-0', colors[item.tone])} aria-hidden />
        <div className="grid min-w-0 gap-0.5">
          <ToastPrimitive.Title className="text-sm font-medium">{item.title}</ToastPrimitive.Title>
          {item.description && <ToastPrimitive.Description className="break-words text-caption text-muted-foreground">{item.description}</ToastPrimitive.Description>}
        </div>
        <ToastPrimitive.Close aria-label="关闭" className="absolute right-2 top-2 grid size-6 place-items-center rounded-sm text-muted-foreground opacity-70 transition hover:bg-muted hover:opacity-100"><X className="size-3.5" /></ToastPrimitive.Close>
      </ToastPrimitive.Root>;
    })}
    <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] m-0 flex w-full max-w-[380px] list-none flex-col gap-2 p-4 outline-none" />
  </ToastPrimitive.Provider>;
}
