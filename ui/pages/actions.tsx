import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { create } from 'zustand';
import { Braces, Check, CircleAlert, History, Play, RotateCcw, Send, TriangleAlert, WandSparkles } from 'lucide-react';
import { request as apiRequest } from '../lib/api';
import { catalog, requestTemplate, retcodes, type ActionSpec } from '../lib/catalog';
import { setSearchParam, useSearchParam } from '../lib/router';
import { isReady, useStream } from '../lib/stream';
import { cn, formatMs, formatTime, modKey } from '../lib/utils';
import type { ActionResponse } from '../lib/types';
import { JsonView } from '../components/json-view';
import { EmptyState, Page, PageHeader } from '../components/page';
import { StatusBadge, sessionStatus } from '../components/status';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { SearchInput } from '../components/ui/form';
import { Kbd } from '../components/ui/misc';
import { Tooltip } from '../components/ui/overlay';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';

interface Run { id: number; time: string; body: string; action: string; elapsed: number; response?: ActionResponse; error?: string }
// Request history lives in memory for this tab only.
const useHistory = create<{ runs: Run[]; add(run: Run): void }>(set => ({ runs: [], add: run => set(state => ({ runs: [run, ...state.runs].slice(0, 30) })) }));
let runId = 0;

function parseBody(text: string): { value?: { action: string }; error?: string } {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { return { error: 'JSON 格式无效：' + (error as Error).message }; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { action?: unknown }).action !== 'string') return { error: '需要 {action, params?, echo?} 动作对象' };
  return { value: value as { action: string } };
}

function ActionList({ selected, onSelect }: { selected: string; onSelect(spec: ActionSpec): void }) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const text = query.trim().toLowerCase();
    const matches = catalog.filter(spec => !text || spec.action.includes(text) || spec.summary.includes(text));
    return ['消息', '账号', '扩展'].map(group => ({ group, items: matches.filter(spec => spec.group === group) })).filter(group => group.items.length);
  }, [query]);
  return <Card className="flex flex-col lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)]">
    <div className="border-b p-3"><SearchInput value={query} onValueChange={setQuery} placeholder="搜索动作" /></div>
    <nav aria-label="OneBot 动作" className="min-h-0 flex-1 overflow-y-auto p-2">
      {groups.length ? groups.map(group => <div key={group.group} className="mb-2 last:mb-0">
        <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">{group.group}</p>
        <ul className="grid gap-0.5">{group.items.map(spec => <li key={spec.action}>
          <button type="button" onClick={() => onSelect(spec)} aria-current={selected === spec.action ? 'true' : undefined}
            className={cn('grid w-full gap-0.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', selected === spec.action ? 'bg-muted' : 'hover:bg-muted/60')}>
            <span className={cn('truncate font-mono text-caption', selected === spec.action ? 'font-medium text-foreground' : 'text-secondary-foreground')}>{spec.action}</span>
            <span className="truncate text-xs text-muted-foreground">{spec.summary}</span>
          </button>
        </li>)}</ul>
      </div>) : <p className="px-2 py-6 text-center text-caption text-muted-foreground">没有匹配的动作</p>}
    </nav>
  </Card>;
}

function ResponsePanel({ run }: { run: Run | null }) {
  if (!run) return <EmptyState compact icon={Send} title="尚未执行" description={`编辑请求后点击执行，或按 ${modKey} + Enter。`} className="py-14" />;
  const ok = run.response?.status === 'ok';
  return <div className="grid gap-3">
    <div className="flex flex-wrap items-center gap-2 text-caption">
      {run.response ? <StatusBadge meta={{ label: ok ? '成功' : '失败', tone: ok ? 'success' : 'destructive' }} /> : <StatusBadge meta={{ label: '请求错误', tone: 'destructive' }} />}
      {run.response && <span className="tabular font-mono text-xs text-secondary-foreground">retcode {run.response.retcode}</span>}
      <span className="tabular ml-auto font-mono text-xs text-muted-foreground">{formatMs(run.elapsed)} · {formatTime(run.time)}</span>
    </div>
    {run.response && run.response.retcode !== 0 && retcodes[run.response.retcode] && <p className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-caption text-secondary-foreground">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />{retcodes[run.response.retcode]}{run.response.message ? '：' + run.response.message : ''}
    </p>}
    {run.error ? <p className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-caption"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />{run.error}</p>
      : <JsonView value={run.response} maxHeight="26rem" />}
  </div>;
}

export default function ApiExplorer() {
  const param = useSearchParam('a');
  const spec = catalog.find(item => item.action === param) ?? catalog[0];
  const [body, setBody] = useState(() => requestTemplate(spec));
  const [busy, setBusy] = useState(false), [current, setCurrent] = useState<Run | null>(null), [tab, setTab] = useState('response');
  const runs = useHistory(state => state.runs), addRun = useHistory(state => state.add);
  const state = useStream(store => store.state), connected = useStream(store => store.connected), loaded = useStream(store => store.loaded);
  const ready = isReady(state, connected);
  const parsed = useMemo(() => parseBody(body), [body]);

  // Switching actions resets the editor, unless a history entry is being restored into it.
  const restoring = useRef<string | null>(null);
  useEffect(() => { setBody(restoring.current ?? requestTemplate(spec)); restoring.current = null; }, [spec.action]);

  async function execute() {
    if (busy || !parsed.value) return;
    setBusy(true); setTab('response');
    const started = performance.now();
    const run: Run = { id: ++runId, time: new Date().toISOString(), body, action: parsed.value.action, elapsed: 0 };
    try { run.response = await apiRequest<ActionResponse>('/api/action', parsed.value); }
    catch (error) { run.error = (error as Error).message + (spec.sends ? '；如已提交发送，请先在 QQ 中确认结果' : ''); }
    run.elapsed = performance.now() - started;
    setCurrent(run); addRun(run); setBusy(false);
  }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); execute(); return; }
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      const element = event.currentTarget, start = element.selectionStart, end = element.selectionEnd;
      const next = body.slice(0, start) + '  ' + body.slice(end);
      setBody(next);
      requestAnimationFrame(() => { element.selectionStart = element.selectionEnd = start + 2; });
    }
  }
  function format() { if (parsed.value) setBody(JSON.stringify(parsed.value, null, 2)); }
  function restore(run: Run) {
    const target = catalog.find(item => item.action === run.action);
    if (target && target.action !== spec.action) { restoring.current = run.body; setSearchParam('a', target.action); }
    else setBody(run.body);
    setCurrent(run); setTab('response');
  }

  return <Page wide>
    <PageHeader title="API 调试" description="构造 OneBot v11 动作并通过当前 QQ 会话执行，响应与本地 OneBot 客户端收到的一致。"
      meta={<StatusBadge meta={sessionStatus(state, connected, loaded)} />} />
    <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <ActionList selected={spec.action} onSelect={item => setSearchParam('a', item.action)} />
      <div className="grid min-w-0 gap-4">
        <Card>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-mono text-base font-semibold">{spec.action}</h2>
                  <Badge tone="outline">{spec.group}</Badge>
                  {spec.sends && <Badge tone="warning"><TriangleAlert />会真实发送</Badge>}
                </div>
                <p className="text-sm text-secondary-foreground">{spec.summary} · <span className="text-muted-foreground">{spec.description}</span></p>
              </div>
            </div>
            {spec.params.length ? <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[520px] text-left text-caption">
                <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">参数</th><th className="px-3 py-2 font-medium">类型</th><th className="px-3 py-2 font-medium">说明</th></tr></thead>
                <tbody className="divide-y">{spec.params.map(item => <tr key={item.name}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono font-medium">{item.name}{item.required && <span className="ml-1.5 font-sans text-2xs font-medium text-destructive-text">必填</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-accent-foreground">{item.type}</td>
                  <td className="px-3 py-2 text-secondary-foreground">{item.description}</td>
                </tr>)}</tbody>
              </table>
            </div> : <p className="text-caption text-muted-foreground">此动作没有参数。</p>}
          </CardContent>
        </Card>

        {!ready && loaded && <div role="status" className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-3.5 py-2.5 text-caption text-secondary-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />QQ 会话尚未就绪，动作会返回 retcode 1502，不会提交到 QQ。
        </div>}

        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <Card className="flex min-w-0 flex-col">
            <CardHeader>
              <CardTitle><Braces className="size-4 text-muted-foreground" aria-hidden />请求</CardTitle>
              <div className="flex items-center gap-1">
                <Tooltip content="格式化 JSON"><Button variant="ghost" size="icon-xs" aria-label="格式化 JSON" disabled={!parsed.value} onClick={format}><WandSparkles /></Button></Tooltip>
                <Tooltip content="恢复示例"><Button variant="ghost" size="icon-xs" aria-label="恢复示例" onClick={() => setBody(requestTemplate(spec))}><RotateCcw /></Button></Tooltip>
              </div>
            </CardHeader>
            <div className="flex-1 p-3">
              <textarea value={body} onChange={event => setBody(event.target.value)} onKeyDown={onKey} spellCheck={false} aria-label="请求 JSON" aria-invalid={Boolean(parsed.error)}
                className="block h-72 w-full resize-y rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5 text-foreground outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 aria-invalid:border-destructive/60" />
            </div>
            <div className="flex items-center gap-3 border-t px-4 py-2.5">
              <span className={cn('flex min-w-0 flex-1 items-center gap-1.5 text-xs', parsed.error ? 'text-destructive-text' : 'text-muted-foreground')} role={parsed.error ? 'alert' : undefined}>
                {parsed.error ? <CircleAlert className="size-3.5 shrink-0" aria-hidden /> : <Check className="size-3.5 shrink-0 text-success" aria-hidden />}
                <span className="truncate">{parsed.error ?? 'JSON 有效'}</span>
              </span>
              <span className="hidden items-center gap-0.5 text-xs text-muted-foreground sm:flex"><Kbd>{modKey}</Kbd><Kbd>Enter</Kbd></span>
              <Button size="sm" onClick={execute} loading={busy} disabled={!parsed.value}>{!busy && <Play />}执行</Button>
            </div>
          </Card>

          <Card className="min-w-0">
            <Tabs value={tab} onValueChange={setTab}>
              <div className="flex min-h-13 items-end border-b px-4 sm:px-5">
                <TabsList className="border-0">
                  <TabsTrigger value="response"><Send />响应</TabsTrigger>
                  <TabsTrigger value="history"><History />历史{runs.length > 0 && <span className="tabular text-2xs text-muted-foreground">{runs.length}</span>}</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="response" className="p-4 outline-none sm:p-5"><ResponsePanel run={current} /></TabsContent>
              <TabsContent value="history" className="outline-none">
                {runs.length ? <ul className="max-h-[30rem] divide-y overflow-y-auto">{runs.map(run => { const ok = run.response?.status === 'ok'; return <li key={run.id}>
                  <button type="button" onClick={() => restore(run)} className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted sm:px-5', current?.id === run.id && 'bg-muted/60')}>
                    {ok ? <Check className="size-4 shrink-0 text-success" aria-label="成功" /> : <CircleAlert className="size-4 shrink-0 text-destructive" aria-label="失败" />}
                    <span className="min-w-0 flex-1 truncate font-mono text-caption">{run.action}</span>
                    <span className="tabular shrink-0 font-mono text-xs text-muted-foreground">{run.response ? 'retcode ' + run.response.retcode : '错误'}</span>
                    <span className="tabular w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">{formatMs(run.elapsed)}</span>
                    <time className="tabular shrink-0 font-mono text-xs text-muted-foreground" dateTime={run.time}>{formatTime(run.time)}</time>
                  </button>
                </li>; })}</ul> : <EmptyState compact icon={History} title="暂无历史" description="执行过的请求会保留在当前标签页，点击即可恢复。" className="py-14" />}
              </TabsContent>
            </Tabs>
          </Card>
        </div>
      </div>
    </div>
  </Page>;
}
