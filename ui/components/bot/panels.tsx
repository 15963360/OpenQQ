import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Eraser, Eye, ShieldAlert, Trash2 } from 'lucide-react';
import { request } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useBotActions, useMemoryOverview, type Bot, type BotList, type ChatMemory, type Limits, type MemorySettings, type Persona, type Scope, type ScopeRule } from '../../lib/bot';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { ConfirmDialog, Dialog, DialogContent, DialogHeader } from '../ui/dialog';
import { Field, Input, Switch, Textarea } from '../ui/form';
import { Select } from '../ui/select';
import { Skeleton } from '../ui/misc';
import { toast } from '../ui/toast';
import { ErrorState } from '../page';

/** 面板里的一份可编辑草稿：来源数据变了（保存成功、换 Bot）就重置，和来源不同就是「有改动」。 */
function useSection<T>(source: T, save: (value: T) => Promise<unknown>) {
  const [draft, setDraft] = useState(source);
  const key = JSON.stringify(source);
  useEffect(() => { setDraft(source); }, [key]);
  const [saving, setSaving] = useState(false);
  return {
    draft, set: (patch: Partial<T>) => setDraft(current => ({ ...current, ...patch })), dirty: JSON.stringify(draft) !== key, saving,
    reset: () => setDraft(source),
    async commit(message = '已保存') {
      setSaving(true);
      try { await save(draft); toast.success(message); }
      catch (error) { toast.error('保存失败', (error as Error).message); }
      finally { setSaving(false); }
    },
  };
}

function SaveRow({ dirty, saving, onSave, onReset, children }: { dirty: boolean; saving: boolean; onSave(): void; onReset(): void; children?: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-t pt-4">
    <Button onClick={onSave} loading={saving} disabled={!dirty}>保存</Button>
    <Button variant="ghost" onClick={onReset} disabled={!dirty || saving}>放弃修改</Button>
    {children}
  </div>;
}

const intIssue = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max ? null : `请输入 ${min}–${max} 的整数`;

// ---- 人设 ------------------------------------------------------------------------------------------------------------
export function PersonaPanel({ bot, presets }: { bot: Bot; presets: BotList['presets'] }) {
  const actions = useBotActions();
  const section = useSection<Persona>(bot.persona, persona => actions.update(bot.id, { persona }));
  const { draft } = section;
  const preset = presets.personality.find(item => item.id === draft.personality);
  const tempText = draft.temperature === null ? '' : String(draft.temperature);
  const tempIssue = tempText !== '' && !(Number(tempText) >= 0 && Number(tempText) <= 2) ? '温度需要在 0–2 之间' : null;
  return <Card>
    <CardHeader><div className="grid gap-0.5"><CardTitle>人设</CardTitle><CardDescription>每个 Bot 独立的名字、性格和系统提示词。对话时会和记忆、近期对话一起发给 AI。</CardDescription></div></CardHeader>
    <CardContent className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="名字" htmlFor="persona-name" description="AI 以这个名字自称。"><Input id="persona-name" value={draft.name} maxLength={20} aria-describedby="persona-name-hint" onChange={event => section.set({ name: event.target.value })} /></Field>
        <Field label="回复风格" htmlFor="persona-style">
          <Select id="persona-style" value={draft.style} onValueChange={style => section.set({ style })} options={presets.style.map(item => ({ value: item.id, label: item.label, description: item.text }))} />
        </Field>
      </div>
      <div className="grid gap-1.5">
        <span className="text-caption font-medium">性格</span>
        <div role="radiogroup" aria-label="性格" className="flex flex-wrap gap-2">
          {presets.personality.map(item => <button key={item.id} type="button" role="radio" aria-checked={draft.personality === item.id} onClick={() => section.set({ personality: item.id })}
            className={cn('h-8 rounded-md border px-3 text-caption font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', draft.personality === item.id ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-muted')}>{item.label}</button>)}
        </div>
        {preset?.text && <p className="text-xs text-muted-foreground">{preset.text}</p>}
      </div>
      <Field label="性格补充" htmlFor="persona-traits" description="可选。口头禅、说话习惯、爱好等，最多 500 字。">
        <Textarea id="persona-traits" rows={2} maxLength={500} value={draft.traits} aria-describedby="persona-traits-hint" onChange={event => section.set({ traits: event.target.value })} />
      </Field>
      <Field label="系统提示词" htmlFor="persona-system" description="告诉 AI 它是谁、该怎么做。最多 4000 字；记忆和近期对话会自动拼在后面，不用写进来。">
        <Textarea id="persona-system" rows={6} maxLength={4000} value={draft.systemPrompt} className="font-mono text-caption" aria-describedby="persona-system-hint" onChange={event => section.set({ systemPrompt: event.target.value })} />
      </Field>
      <Field label="温度（可选）" htmlFor="persona-temp" error={tempIssue} description="留空则使用「AI 接入」里的全局温度。">
        <Input id="persona-temp" inputMode="decimal" value={tempText} className="w-40" aria-invalid={Boolean(tempIssue)} aria-describedby="persona-temp-hint"
          onChange={event => section.set({ temperature: event.target.value.trim() === '' ? null : Number(event.target.value) })} />
      </Field>
      <SaveRow dirty={section.dirty} saving={section.saving} onSave={() => { if (!tempIssue && draft.name.trim()) void section.commit('人设已保存'); else toast.error('请先修正标红的字段'); }} onReset={section.reset} />
    </CardContent>
  </Card>;
}

// ---- 记忆 ------------------------------------------------------------------------------------------------------------
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const chatLabel = (key: string) => key.startsWith('g:') ? '群 ' + key.slice(2) : key.startsWith('p:') ? '私聊 ' + key.slice(2) : key === 'sim:g' ? '测试（群聊）' : '测试（私聊）';
const kib = (bytes: number) => (bytes / 1024).toFixed(1) + ' KiB';

export function MemoryPanel({ bot }: { bot: Bot }) {
  const actions = useBotActions();
  const client = useQueryClient();
  const overview = useMemoryOverview(bot.id);
  const settings = useSection<MemorySettings>(bot.memory, memory => actions.update(bot.id, { memory }));
  const [clear, setClear] = useState<null | { scope: 'all' | 'chats' | 'notes' | 'chat'; chatKey?: string }>(null);
  const [detail, setDetail] = useState<ChatMemory | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ['bot-memory', bot.id] });
  const turnsIssue = intIssue(settings.draft.contextTurns, 0, 40);

  async function open(key: string) {
    try { setDetail(await request<ChatMemory>(`/api/bot/bots/${bot.id}/memory/chat?key=${encodeURIComponent(key)}`)); }
    catch (error) { toast.error('读取失败', (error as Error).message); }
  }
  async function exportMemory() {
    try { download(`${bot.name}-记忆.json`, await request(`/api/bot/bots/${bot.id}/memory/export`)); }
    catch (error) { toast.error('导出失败', (error as Error).message); }
  }
  async function doClear() {
    if (!clear) return;
    try { await request(`/api/bot/bots/${bot.id}/memory/clear`, clear); await refresh(); toast.success('已清空'); }
    catch (error) { toast.error('清空失败', (error as Error).message); }
  }
  const data = overview.data;
  return <div className="grid gap-6">
    <Card>
      <CardHeader><div className="grid gap-0.5"><CardTitle>记忆设置</CardTitle><CardDescription>每个 Bot 有自己的记忆，按会话（群 / 私聊）分开保存，互相看不到。</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3.5">
          <div className="grid gap-0.5"><span className="text-sm font-medium">记住对话</span><span className="text-caption text-muted-foreground">关闭后不再记录新的对话，也不会把历史带给 AI（积木「记住 / 回忆」的笔记不受影响）。</span></div>
          <Switch checked={settings.draft.enabled} onCheckedChange={enabled => settings.set({ enabled })} aria-label="记住对话" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="带给 AI 的近期对话条数" htmlFor="mem-turns" error={turnsIssue} description="每次请求附带最近几条原文（一问一答算两条），0 表示只带摘要。">
            <Input id="mem-turns" inputMode="numeric" className="w-32" value={String(settings.draft.contextTurns)} aria-invalid={Boolean(turnsIssue)} aria-describedby="mem-turns-hint"
              onChange={event => settings.set({ contextTurns: Number(event.target.value.replace(/\D/g, '')) })} />
          </Field>
          <Field label="摘要方式" htmlFor="mem-summary" description={`对话原文超过 ${data?.limits.softTurns ?? 40} 条后，把最旧的折叠进摘要。`}>
            <Select id="mem-summary" value={settings.draft.summary} onValueChange={summary => settings.set({ summary: summary as MemorySettings['summary'] })}
              options={[{ value: 'rule', label: '规则摘要（不额外调用 AI）', description: '每句截成一行，保留最近的内容' }, { value: 'ai', label: 'AI 摘要', description: '折叠时额外调用一次 AI；失败自动回退到规则摘要' }]} />
          </Field>
        </div>
        <SaveRow dirty={settings.dirty} saving={settings.saving} onSave={() => { if (!turnsIssue) void settings.commit('记忆设置已保存'); }} onReset={settings.reset} />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div className="grid gap-0.5"><CardTitle>已保存的记忆</CardTitle><CardDescription>{data ? `${data.stats.chats} 个会话 · ${data.stats.turns} 条对话 · ${data.stats.notes} 条笔记 · ${kib(data.stats.bytes)} / ${kib(data.stats.maxBytes)}` : '读取中…'}</CardDescription></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportMemory}><Download />导出 JSON</Button>
          <Button variant="outline" size="sm" onClick={() => setClear({ scope: 'all' })}><Eraser />清空全部</Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        {overview.isError ? <ErrorState description={(overview.error as Error).message} onRetry={() => overview.refetch()} /> : !data ? <Skeleton className="h-32 rounded-lg" /> : <>
          <section className="grid gap-2" aria-label="会话记忆">
            <div className="flex items-center justify-between"><h3 className="text-sm font-medium">会话</h3>{data.chats.length > 0 && <Button variant="destructive-ghost" size="xs" onClick={() => setClear({ scope: 'chats' })}>清空所有会话</Button>}</div>
            {data.chats.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-caption text-muted-foreground">还没有对话记忆。Bot 回复后会出现在这里。</p>
              : <ul className="divide-y rounded-lg border">{data.chats.map(chat => <li key={chat.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2.5 text-sm">
                <span className="min-w-28 font-medium">{chatLabel(chat.key)}</span>
                <span className="text-caption text-muted-foreground">{chat.turns} 条对话{chat.summaryChars ? ` · 摘要 ${chat.summaryChars} 字` : ''}{chat.notes ? ` · ${chat.notes} 条笔记` : ''}</span>
                <span className="ml-auto flex gap-1">
                  <Button variant="ghost" size="xs" onClick={() => open(chat.key)}><Eye />查看</Button>
                  <Button variant="destructive-ghost" size="xs" onClick={() => setClear({ scope: 'chat', chatKey: chat.key })}><Trash2 />清空</Button>
                </span>
              </li>)}</ul>}
          </section>
          <section className="grid gap-2" aria-label="Bot 笔记">
            <div className="flex items-center justify-between"><h3 className="text-sm font-medium">整个 Bot 的笔记</h3>{data.notes.length > 0 && <Button variant="destructive-ghost" size="xs" onClick={() => setClear({ scope: 'notes' })}>清空笔记</Button>}</div>
            {data.notes.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-caption text-muted-foreground">没有笔记。用积木「记住 … 范围：整个 Bot」可以写入。</p>
              : <dl className="divide-y rounded-lg border text-sm">{data.notes.map(([name, value]) => <div key={name} className="grid grid-cols-[minmax(80px,25%)_minmax(0,1fr)] gap-3 px-3.5 py-2"><dt className="font-medium">{name}</dt><dd className="break-words text-muted-foreground">{value}</dd></div>)}</dl>}
          </section>
        </>}
      </CardContent>
    </Card>

    <ConfirmDialog open={clear !== null} onOpenChange={open => { if (!open) setClear(null); }} destructive confirmLabel="清空" onConfirm={doClear}
      title={clear?.scope === 'all' ? '清空这个 Bot 的全部记忆？' : clear?.scope === 'chats' ? '清空所有会话记忆？' : clear?.scope === 'notes' ? '清空整个 Bot 的笔记？' : `清空「${clear?.chatKey ? chatLabel(clear.chatKey) : ''}」的记忆？`}
      description="清空后无法恢复。需要备份的话请先「导出 JSON」。" />
    <Dialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader title={detail ? chatLabel(detail.key) : ''} description="这个会话里 AI 能看到的记忆。" />
        {detail && <div className="grid gap-4 text-sm">
          {detail.summary && <section className="grid gap-1"><h3 className="font-medium">更早对话的摘要</h3><pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-caption">{detail.summary}</pre></section>}
          {detail.notes.length > 0 && <section className="grid gap-1"><h3 className="font-medium">本会话笔记</h3>{detail.notes.map(([name, value]) => <p key={name} className="text-caption"><span className="font-medium">{name}：</span>{value}</p>)}</section>}
          <section className="grid gap-1"><h3 className="font-medium">最近的对话（{detail.turns.length}）</h3>
            <ol className="grid max-h-80 gap-1.5 overflow-y-auto">{detail.turns.map((turn, index) => <li key={index} className={cn('max-w-[85%] rounded-lg px-3 py-1.5 text-caption', turn.role === 'user' ? 'bg-muted' : 'ml-auto bg-primary/10')}>
              <span className="mr-1.5 font-medium">{turn.role === 'user' ? turn.name || '用户' : '我'}</span><span className="whitespace-pre-wrap break-words">{turn.text}</span></li>)}</ol>
          </section>
        </div>}
      </DialogContent>
    </Dialog>
  </div>;
}

// ---- 适用范围与限制 -----------------------------------------------------------------------------------------------------
const modeOptions = [{ value: 'all', label: '全部' }, { value: 'allow', label: '只在名单内' }, { value: 'deny', label: '名单内除外' }];
const parseIds = (value: string) => [...new Set(value.split(/[\s,，;；]+/).filter(Boolean).map(Number))];

function RuleEditor({ label, idLabel, rule, onChange }: { label: string; idLabel: string; rule: ScopeRule; onChange(rule: ScopeRule): void }) {
  const [text, setText] = useState(rule.ids.join(', '));
  const key = rule.ids.join(',');
  useEffect(() => { setText(rule.ids.join(', ')); }, [key]);
  const ids = parseIds(text);
  const bad = ids.some(id => !Number.isSafeInteger(id) || id <= 0) || ids.length > 200;
  return <div className="grid gap-2 rounded-lg border p-3.5">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{label}</span>
      <Select size="sm" className="w-40" aria-label={label + '范围'} value={rule.mode} onValueChange={mode => onChange({ ...rule, mode: mode as ScopeRule['mode'] })} options={modeOptions} /></div>
    {rule.mode !== 'all' && <Field label={idLabel} htmlFor={'rule-' + label} error={bad ? '请填写数字号码，用逗号或空格分隔，最多 200 个' : null}>
      <Textarea id={'rule-' + label} rows={2} value={text} aria-invalid={bad} aria-describedby={`rule-${label}-hint`} className="font-mono text-caption"
        onChange={event => { setText(event.target.value); const next = parseIds(event.target.value); if (!next.some(id => !Number.isSafeInteger(id) || id <= 0)) onChange({ ...rule, ids: next }); }} />
    </Field>}
  </div>;
}

export function RulesPanel({ bot }: { bot: Bot }) {
  const actions = useBotActions();
  const section = useSection<{ scope: Scope; limits: Limits }>({ scope: bot.scope, limits: bot.limits }, value => actions.update(bot.id, value));
  const { draft } = section;
  const limitField = (id: keyof Limits, label: string, description: string, min: number, max: number) => {
    const issue = intIssue(draft.limits[id], min, max);
    return <Field key={id} label={label} htmlFor={'limit-' + id} error={issue} description={description}>
      <Input id={'limit-' + id} inputMode="numeric" className="w-32" value={String(draft.limits[id])} aria-invalid={Boolean(issue)} aria-describedby={`limit-${id}-hint`}
        onChange={event => section.set({ limits: { ...draft.limits, [id]: Number(event.target.value.replace(/\D/g, '')) } })} />
    </Field>;
  };
  const valid = !intIssue(draft.limits.sendsPerMinute, 1, 120) && !intIssue(draft.limits.aiPerMinute, 1, 60) && !intIssue(draft.limits.cooldownSeconds, 0, 60);
  return <Card>
    <CardHeader><div className="grid gap-0.5"><CardTitle><ShieldAlert className="size-4 text-muted-foreground" aria-hidden />范围与限制</CardTitle><CardDescription>决定 Bot 在哪些会话里工作，并防止刷屏。超过限制的运行会被中止并记录。</CardDescription></div></CardHeader>
    <CardContent className="grid gap-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <RuleEditor label="私聊" idLabel="QQ 号名单" rule={draft.scope.private} onChange={rule => section.set({ scope: { ...draft.scope, private: rule } })} />
        <RuleEditor label="群聊" idLabel="群号名单" rule={draft.scope.group} onChange={rule => section.set({ scope: { ...draft.scope, group: rule } })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {limitField('sendsPerMinute', '每分钟最多发送', '这个 Bot 每分钟最多发出的消息条数（1–120）。', 1, 120)}
        {limitField('aiPerMinute', '每分钟最多调用 AI', '这个 Bot 每分钟最多请求 AI 的次数（1–60）。', 1, 60)}
        {limitField('cooldownSeconds', '同一个人的触发间隔（秒）', '同一个人在同一会话里连续触发时，间隔内的消息会被忽略（0–60）。', 0, 60)}
      </div>
      <p className="text-xs text-muted-foreground">每次运行另有固定上限：最多 2000 步、60 秒、每个循环 100 次、发送 5 条消息。</p>
      <SaveRow dirty={section.dirty} saving={section.saving} onSave={() => { if (valid) void section.commit('已保存'); else toast.error('请先修正标红的字段'); }} onReset={section.reset} />
    </CardContent>
  </Card>;
}
