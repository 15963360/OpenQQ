import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Blocks, Bot as BotIcon, Brain, CircleAlert, FlaskConical, Plus, Save, ShieldAlert, Sparkles, Trash2, UserRound } from 'lucide-react';
import { request } from '../lib/api';
import { navigate, setSearchParam, useSearchParam } from '../lib/router';
import { cn } from '../lib/utils';
import { triggerNames, useAiSettings, useBot, useBotActions, useBotList, useRuns, type Bot, type BotList, type RunRecord, type SimulateResult } from '../lib/bot';
import { BlockEditor, type EditorHandle } from '../components/bot/block-editor';
import { MemoryPanel, PersonaPanel, RulesPanel } from '../components/bot/panels';
import { EmptyState, ErrorState, Page, PageHeader } from '../components/page';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ConfirmDialog, Dialog, DialogContent, DialogHeader } from '../components/ui/dialog';
import { Field, Input, Switch, Textarea } from '../components/ui/form';
import { Select } from '../components/ui/select';
import { Skeleton } from '../components/ui/misc';
import { Segmented, Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from '../components/ui/toast';

// ---- 新建 Bot -----------------------------------------------------------------------------------------------------------
function NewBotDialog({ open, onOpenChange, templates, onCreate }: { open: boolean; onOpenChange(open: boolean): void; templates: BotList['templates']; onCreate(name: string, template: string): Promise<void> }) {
  const [template, setTemplate] = useState(templates[0]?.id ?? 'ai-mention');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = templates.find(item => item.id === template);
  async function submit() {
    setBusy(true);
    try { await onCreate(name.trim() || chosen?.name || '新 Bot', template); onOpenChange(false); setName(''); }
    catch (error) { toast.error('创建失败', (error as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-lg">
      <DialogHeader title="新建 Bot" description="选一个示例积木作为起点，之后可以随意拖拽修改。" />
      <div className="grid gap-4">
        <Field label="名称" htmlFor="new-bot-name"><Input id="new-bot-name" value={name} maxLength={40} placeholder={chosen?.name} onChange={event => setName(event.target.value)} /></Field>
        <div role="radiogroup" aria-label="模板" className="grid gap-2">
          {templates.map(item => <button key={item.id} type="button" role="radio" aria-checked={template === item.id} onClick={() => setTemplate(item.id)}
            className={cn('grid gap-0.5 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', template === item.id ? 'border-foreground bg-muted/60' : 'hover:bg-muted/40')}>
            <span className="text-sm font-medium">{item.name}</span><span className="text-caption text-muted-foreground">{item.description}</span></button>)}
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={submit} loading={busy}>创建</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}

// ---- 积木 -------------------------------------------------------------------------------------------------------------
function BlocksPanel({ bot }: { bot: Bot }) {
  const actions = useBotActions();
  const handle = useRef<EditorHandle | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [count, setCount] = useState<number | null>(null);
  async function save() {
    const state = handle.current?.getState();
    if (!state) return;
    setSaving(true);
    try {
      const result = await actions.update(bot.id, { program: state });
      setWarnings(result.warnings); setDirty(false);
      toast.success('积木已保存', bot.enabled ? '立即生效。' : '这个 Bot 还没有启用，打开上方的开关后才会响应消息。');
    } catch (error) { toast.error('保存失败', (error as Error).message); }
    finally { setSaving(false); }
  }
  return <div className="grid gap-3">
    <BlockEditor key={bot.id} state={bot.program} handle={handle} onChange={() => { setDirty(true); setCount(handle.current?.blockCount() ?? null); }} />
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={save} loading={saving} disabled={!dirty}><Save />保存积木</Button>
      {dirty && <span className="flex items-center gap-1.5 text-caption text-warning-text"><span className="size-2 rounded-full bg-warning" aria-hidden />有未保存的修改</span>}
      {count !== null && <span className="text-caption text-muted-foreground">{count} / 300 块</span>}
      <span className="ml-auto text-caption text-muted-foreground">从左侧工具箱把积木拖进来；每个积木堆要以「触发」积木开头。</span>
    </div>
    {warnings.length > 0 && <ul className="grid gap-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-caption" role="status">{warnings.map(item => <li key={item} className="flex gap-2"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />{item}</li>)}</ul>}
  </div>;
}

// ---- 测试与运行记录 ---------------------------------------------------------------------------------------------------------
const statusTone = { ok: 'success', error: 'destructive', limited: 'warning' } as const;
const statusText = { ok: '成功', error: '出错', limited: '被限流' } as const;

function RunList({ runs }: { runs: RunRecord[] }) {
  if (!runs.length) return <p className="rounded-lg border border-dashed p-4 text-center text-caption text-muted-foreground">还没有运行记录。收到消息或试运行后会出现在这里。</p>;
  return <ul className="divide-y rounded-lg border">{runs.map((run, index) => <li key={index} className="grid gap-1 px-3.5 py-2.5 text-sm">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Badge tone={statusTone[run.status]}>{statusText[run.status]}</Badge>
      <span className="font-medium">{triggerNames[run.trigger] ?? run.trigger}</span>
      <span className="text-caption text-muted-foreground">{run.simulated ? '试运行' : run.chat} · {run.steps} 步 · {run.messages} 条消息 · {run.elapsed} ms</span>
      <time className="ml-auto text-xs text-muted-foreground tabular" dateTime={run.time}>{new Date(run.time).toLocaleTimeString('zh-CN', { hour12: false })}</time>
    </div>
    {run.error && <p className="break-words text-caption text-destructive-text">{run.error}</p>}
  </li>)}</ul>;
}

function TestPanel({ bot }: { bot: Bot }) {
  const client = useQueryClient();
  const runs = useRuns(bot.id);
  const ai = useAiSettings();
  const [chatType, setChatType] = useState<'group' | 'private'>('group');
  const [atSelf, setAtSelf] = useState(true);
  const [message, setMessage] = useState('你好呀');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SimulateResult | null>(null);
  async function run() {
    setBusy(true);
    try {
      setResult(await request<SimulateResult>(`/api/bot/bots/${bot.id}/simulate`, { chatType, text: message, atSelf: chatType === 'group' && atSelf }, { timeout: 90000 }));
      await client.invalidateQueries({ queryKey: ['bot-runs', bot.id] });
    } catch (error) { toast.error('试运行失败', (error as Error).message); }
    finally { setBusy(false); }
  }
  const needsAi = ai.data && !(ai.data.apiKeySet && ai.data.model);
  return <div className="grid gap-6">
    <Card>
      <CardHeader><div className="grid gap-0.5"><CardTitle><FlaskConical className="size-4 text-muted-foreground" aria-hidden />试运行</CardTitle>
        <CardDescription>模拟收到一条消息，看看 Bot 会怎么做。<strong className="font-medium text-foreground">不会真的发送 QQ 消息</strong>，但会真实调用 AI（用测试会话的记忆）。</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        {needsAi && <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-caption"><CircleAlert className="size-4 text-warning" aria-hidden />还没有配置 AI（Key 或模型），用到 AI 的积木会失败。<Button variant="link" size="xs" onClick={() => navigate('/ai')}>去配置</Button></div>}
        <div className="flex flex-wrap items-end gap-4">
          <Segmented aria-label="会话类型" value={chatType} onValueChange={setChatType} options={[{ value: 'group', label: '群聊' }, { value: 'private', label: '私聊' }]} />
          {chatType === 'group' && <label className="flex h-8 items-center gap-2 text-caption"><Switch checked={atSelf} onCheckedChange={setAtSelf} aria-label="@ 机器人" />@ 机器人</label>}
        </div>
        <Field label="消息内容" htmlFor="sim-text"><Textarea id="sim-text" rows={2} value={message} maxLength={2000} onChange={event => setMessage(event.target.value)} /></Field>
        <div><Button onClick={run} loading={busy}><FlaskConical />运行</Button></div>
        {result && <div className="grid gap-3 rounded-lg border bg-muted/30 p-3.5" role="region" aria-label="试运行结果">
          <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">触发了：</span>
            {result.matched.length ? result.matched.map((name, index) => <Badge key={index} tone="primary">{triggerNames[name] ?? name}</Badge>) : <span className="text-muted-foreground">没有匹配的触发积木（检查触发条件、群聊/私聊范围，或是否勾选了 @）</span>}</div>
          {result.outputs.map((output, index) => <div key={index} className="grid max-w-xl gap-1">
            <span className="text-xs text-muted-foreground">将发送到{output.target.type === 'group' ? '群' : '私聊'} · {output.segments.map(segment => segment.type).join(' + ')}</span>
            <div className="whitespace-pre-wrap break-words rounded-xl bg-card p-3 text-sm shadow-sm">{output.text || <span className="text-muted-foreground">（{output.segments[0]?.type} 消息段）</span>}</div></div>)}
          {result.runs.map((run, index) => run.error && <p key={index} className="flex gap-2 text-caption text-destructive-text"><CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />{run.error}</p>)}
        </div>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><div className="grid gap-0.5"><CardTitle>运行记录</CardTitle><CardDescription>最近 50 次运行（只保存在内存里，重启后清空）。没有回复时先看这里。</CardDescription></div></CardHeader>
      <CardContent>{runs.isError ? <ErrorState description={(runs.error as Error).message} onRetry={() => runs.refetch()} /> : <RunList runs={runs.data ?? []} />}</CardContent>
    </Card>
  </div>;
}

// ---- 页面 -------------------------------------------------------------------------------------------------------------
export default function BotPage() {
  const list = useBotList();
  const actions = useBotActions();
  const selectedParam = useSearchParam('b');
  const tabParam = useSearchParam('tab') ?? 'blocks';
  const selected = list.data?.bots.find(item => item.id === selectedParam)?.id ?? list.data?.bots[0]?.id ?? null;
  const bot = useBot(selected);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  if (list.isError) return <Page><PageHeader title="Bot 编程" /><Card><ErrorState description={(list.error as Error).message} onRetry={() => list.refetch()} /></Card></Page>;
  if (!list.data) return <Page><PageHeader title="Bot 编程" /><Skeleton className="h-96 rounded-xl" /></Page>;
  const data = list.data;
  const create = async (name: string, template: string) => { const created = await actions.create(name, template); setSearchParam('b', created.id); toast.success('已创建', '新 Bot 默认未启用，确认积木后打开开关。'); };

  return <Page wide>
    <PageHeader title="Bot 编程" description="拖积木编制自己的 Bot：收到消息、判断条件、调用 AI、读写记忆、发送回复。"
      actions={<><Button variant="outline" size="sm" onClick={() => navigate('/ai')}><Sparkles />AI 接入</Button><Button size="sm" onClick={() => setCreating(true)} disabled={data.bots.length >= data.max}><Plus />新建 Bot</Button></>} />
    <NewBotDialog open={creating} onOpenChange={setCreating} templates={data.templates} onCreate={create} />

    {data.bots.length === 0 ? <Card><EmptyState icon={BotIcon} title="还没有 Bot" description="从一个示例开始，比如「被 @ 时用 AI 回复」，几秒钟就能跑起来。" action={<Button onClick={() => setCreating(true)}><Plus />新建 Bot</Button>} /></Card> : <>
      <Card><CardContent className="flex flex-wrap items-center gap-x-5 gap-y-3 py-3 sm:py-3">
        <div className="flex min-w-0 items-center gap-2"><span className="text-caption text-muted-foreground">当前 Bot</span>
          <Select size="sm" className="w-56" aria-label="选择 Bot" value={selected ?? ''} onValueChange={id => setSearchParam('b', id)}
            options={data.bots.map(item => ({ value: item.id, label: item.name, description: item.enabled ? '已启用' : '未启用' }))} /></div>
        {bot.data && <>
          <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={bot.data.enabled} disabled={toggling} aria-label="启用这个 Bot"
            onCheckedChange={async enabled => { setToggling(true); try { await actions.update(bot.data!.id, { enabled }); toast.success(enabled ? '已启用' : '已停用'); } catch (error) { toast.error('操作失败', (error as Error).message); } finally { setToggling(false); } }} />
            {bot.data.enabled ? '已启用' : '未启用'}</label>
          <Button variant="destructive-ghost" size="sm" className="ml-auto" onClick={() => setDeleting(true)}><Trash2 />删除</Button>
        </>}
      </CardContent></Card>

      {bot.isError ? <Card><ErrorState description={(bot.error as Error).message} onRetry={() => bot.refetch()} /></Card> : !bot.data ? <Skeleton className="h-[640px] rounded-xl" /> :
        <Tabs value={tabParam} onValueChange={tab => setSearchParam('tab', tab === 'blocks' ? null : tab)} className="grid gap-4">
          <TabsList className="overflow-x-auto">
            <TabsTrigger value="blocks"><Blocks />积木</TabsTrigger>
            <TabsTrigger value="persona"><UserRound />人设</TabsTrigger>
            <TabsTrigger value="memory"><Brain />记忆</TabsTrigger>
            <TabsTrigger value="rules"><ShieldAlert />范围与限制</TabsTrigger>
            <TabsTrigger value="test"><FlaskConical />测试</TabsTrigger>
          </TabsList>
          <TabsContent value="blocks" className="outline-none"><BlocksPanel bot={bot.data} /></TabsContent>
          <TabsContent value="persona" className="outline-none"><PersonaPanel bot={bot.data} presets={data.presets} /></TabsContent>
          <TabsContent value="memory" className="outline-none"><MemoryPanel bot={bot.data} /></TabsContent>
          <TabsContent value="rules" className="outline-none"><RulesPanel bot={bot.data} /></TabsContent>
          <TabsContent value="test" className="outline-none"><TestPanel bot={bot.data} /></TabsContent>
        </Tabs>}
    </>}

    <ConfirmDialog open={deleting} onOpenChange={setDeleting} destructive confirmLabel="删除" title={`删除「${bot.data?.name ?? ''}」？`} description="积木程序、人设和这个 Bot 的全部记忆都会被删除，无法恢复。需要备份记忆请先到「记忆」页导出。"
      onConfirm={async () => { if (!bot.data) return; try { await actions.remove(bot.data.id); setSearchParam('b', null); toast.success('已删除'); } catch (error) { toast.error('删除失败', (error as Error).message); } }} />
  </Page>;
}
