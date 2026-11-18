import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { usePreferences } from '../../lib/preferences';
import { ErrorState } from '../page';
import { Skeleton } from '../ui/misc';

// blocks.js 是单独打包的 Blockly 编辑器（见 ui/build.mjs），只有打开 Bot 页面时才下载。
export interface EditorHandle {
  getState(): unknown;
  setState(state: unknown): void;
  setDark(dark: boolean): void;
  blockCount(): number;
  resize(): void;
  dispose(): void;
}
interface EditorModule { mountEditor(container: HTMLElement, options: { state: unknown; dark: boolean; onChange(): void }): EditorHandle }
const editorUrl: string = '/blocks.js';

interface Props { state: unknown; onChange(): void; handle: MutableRefObject<EditorHandle | null> }

/** 把 Blockly 工作区挂到一个容器里。state 只在挂载时读取；换 Bot 时让父组件用 key 重新挂载。 */
export function BlockEditor({ state, onChange, handle }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | { error: string }>('loading');
  const dark = usePreferences(preferences => preferences.resolvedTheme) === 'dark';
  const initial = useRef({ state, dark, onChange });
  initial.current.onChange = onChange;

  useEffect(() => {
    let disposed = false;
    let mounted: EditorHandle | null = null;
    (async () => {
      try {
        const editor = await import(/* webpackIgnore: true */ editorUrl) as EditorModule;
        if (disposed || !container.current) return;
        mounted = editor.mountEditor(container.current, { state: initial.current.state, dark: initial.current.dark, onChange: () => initial.current.onChange() });
        handle.current = mounted;
        setStatus('ready');
      } catch (error) {
        if (!disposed) setStatus({ error: (error as Error).message || '积木编辑器加载失败' });
      }
    })();
    return () => { disposed = true; mounted?.dispose(); if (handle.current === mounted) handle.current = null; };
  }, [handle]);

  useEffect(() => { handle.current?.setDark(dark); }, [dark, handle, status]);

  return <div className="relative">
    {status === 'loading' && <Skeleton className="absolute inset-0 rounded-lg" />}
    {typeof status === 'object' && <ErrorState title="积木编辑器加载失败" description={status.error + '。请确认已执行 npm run build。'} />}
    <div ref={container} className="h-[640px] w-full overflow-hidden rounded-lg border bg-card" aria-label="积木编辑器" hidden={typeof status === 'object'} />
  </div>;
}
