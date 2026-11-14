import { useState } from 'react';
import { ArrowLeftRight, CircleAlert, CircleCheck, Copy, Globe, Info, KeyRound, Plus, RefreshCw, Server, Trash2, TriangleAlert, WandSparkles, type LucideIcon } from 'lucide-react';
import { useConfigDraft } from '../lib/config-draft';
import { forwardAddress } from '../lib/config';
import { navigate } from '../lib/router';
import { useStream } from '../lib/stream';
import { cn, randomHex } from '../lib/utils';
import type { OpenQQConfig } from '../lib/types';
import { ErrorState, Page, PageHeader } from '../components/page';
import { SaveBar } from '../components/save-bar';
import { StatusBadge, reverseMeta } from '../components/status';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/dialog';
import { Field, Input, SecretInput, Switch } from '../components/ui/form';
import { Skeleton } from '../components/ui/misc';
import { Tooltip } from '../components/ui/overlay';
import { Select } from '../components/ui/select';
import { copyText, toast } from '../components/ui/toast';

type Check = { level: 'ok' | 'warn' | 'error' | 'info'; text: string };
function diagnose(config: OpenQQConfig, issues: Record<string, string>): Check[] {
  const checks: Check[] = [];
  if (issues.connections) checks.push({ level: 'error', text: issues.connections });
  if (config.ws.enabled && config.ws.host === '0.0.0.0') checks.push({ level: 'warn', text: '正向服务监听局域网（0.0.0.0），同一网络中的设备都能尝试连接，请确保 Access Token 足够强。' });
  if (config.ws.enabled && config.ws.host === '127.0.0.1') checks.push({ level: 'ok', text: '正向服务仅监听本机，外部设备无法直接连接。' });
  if (/^[\x21-\x7e]{32,256}$/.test(config.accessToken)) checks.push({ level: 'ok', text: `Access Token 长度 ${config.accessToken.length} 位。` });
  else if (!issues.accessToken) checks.push({ level: 'warn', text: 'Access Token 少于 32 位，建议重新生成更长的令牌。' });
  config.reverseWs.forEach((item, index) => {
    try {
      const url = new URL(item.url);
      if (item.enabled && url.protocol === 'ws:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) checks.push({ level: 'warn', text: `反向地址 ${index + 1} 使用未加密的 ws:// 连接远程主机，令牌会以明文传输，建议改用 wss://。` });
    } catch { /* reported as a field error */ }
    if (item.enabled && !item.token) checks.push({ level: 'info', text: `反向地址 ${index + 1} 未设置机器人端令牌，连接时不会携带 Authorization 头；如框架要求鉴权请填写。` });
  });
  checks.push({ level: 'info', text: 'OneBot HTTP 动作服务暂未支持，请使用正向或反向 WebSocket。' });
  return checks;
}
const checkIcons: Record<Check['level'], [LucideIcon, string]> = { ok: [CircleCheck, 'text-success'], warn: [TriangleAlert, 'text-warning'], error: [CircleAlert, 'text-destructive'], info: [Info, 'text-muted-foreground'] };

export default function Connections() {
  const config = useConfigDraft();
  const network = useStream(store => store.state.network);
  const [confirmToken, setConfirmToken] = useState(false);
  const { draft, issues } = config;

  async function save() {
    try { await config.save(); toast.success('配置已保存', config.running ? '当前连接继续使用原配置，重启 OpenQQ 后生效。' : undefined); }
    catch (error) { toast.error('保存失败', (error as Error).message); }
  }

  if (config.query.isError) return <Page><PageHeader title="连接" /><Card><ErrorState description={(config.query.error as Error).message} onRetry={() => config.query.refetch()} /></Card></Page>;
  // Live reverse states are reported for enabled entries only, in order.
  const liveIndex = (index: number) => draft ? draft.reverseWs.slice(0, index).filter(item => item.enabled).length : -1;

  return <Page>
    <PageHeader title="连接" description="机器人通过 OneBot v11 WebSocket 与 OpenQQ 通信。正向与反向可以同时启用。"
      actions={<Button variant="outline" size="sm" onClick={() => navigate('/setup')}><WandSparkles />接入向导</Button>} />

    {!draft ? <div className="grid gap-4"><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-56 rounded-xl" /></div> : <>
      <Card>
        <CardHeader>
          <div className="grid gap-0.5"><CardTitle><Server className="size-4 text-muted-foreground" aria-hidden />正向 WebSocket</CardTitle><CardDescription>OpenQQ 作为服务端，机器人主动连接，适合自写 Bot。</CardDescription></div>
          <div className="flex items-center gap-3">
            {network && config.saved?.ws.enabled && <StatusBadge meta={{ label: network.ws.clients + ' 个客户端', tone: network.ws.clients ? 'success' : 'neutral' }} icon={false} />}
            <Switch checked={draft.ws.enabled} onCheckedChange={value => config.update(next => { next.ws.enabled = value; })} aria-label="启用正向 WebSocket" />
          </div>
        </CardHeader>
        <CardContent className={cn('grid gap-4', !draft.ws.enabled && 'opacity-60')}>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
            <Field label="监听范围" htmlFor="ws-host">
              <Select id="ws-host" value={draft.ws.host} disabled={!draft.ws.enabled} onValueChange={value => config.update(next => { next.ws.host = value as OpenQQConfig['ws']['host']; })}
                options={[{ value: '127.0.0.1', label: '仅本机 · 127.0.0.1' }, { value: '0.0.0.0', label: '局域网 · 0.0.0.0' }]} />
            </Field>
            <Field label="端口" htmlFor="ws-port" error={issues['ws.port']}>
              <Input id="ws-port" inputMode="numeric" className="tabular font-mono" disabled={!draft.ws.enabled} value={String(draft.ws.port)} aria-invalid={Boolean(issues['ws.port'])} aria-describedby="ws-port-hint"
                onChange={event => config.update(next => { next.ws.port = Number(event.target.value.replace(/\D/g, '')) || 0; })} />
            </Field>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            <span className="text-xs text-muted-foreground">连接地址</span>
            <code className="min-w-0 flex-1 truncate font-mono text-caption">{network?.ws.address && !config.dirty ? network.ws.address + '/' : forwardAddress(draft)}</code>
            <Tooltip content="复制地址"><Button variant="ghost" size="icon-xs" aria-label="复制连接地址" onClick={() => copyText(forwardAddress({ ws: { ...draft.ws, host: '127.0.0.1' } }))}><Copy /></Button></Tooltip>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid gap-0.5"><CardTitle><ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden />反向 WebSocket</CardTitle><CardDescription>OpenQQ 主动连接 NoneBot 等框架提供的地址，最多 8 个。</CardDescription></div>
          <Button variant="outline" size="sm" disabled={draft.reverseWs.length >= 8} onClick={() => config.update(next => { next.reverseWs.push({ enabled: true, url: '', token: '' }); })}><Plus />添加地址</Button>
        </CardHeader>
        {draft.reverseWs.length ? <ul className="divide-y">
          {draft.reverseWs.map((item, index) => {
            const saved = config.saved?.reverseWs[index];
            const live = saved?.enabled && saved.url === item.url ? network?.reverseWs[liveIndex(index)] : undefined;
            return <li key={index} className="grid gap-4 p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <Switch checked={item.enabled} onCheckedChange={value => config.update(next => { next.reverseWs[index].enabled = value; })} aria-label={`启用反向地址 ${index + 1}`} />
                <span className="text-sm font-medium">地址 {index + 1}</span>
                {live ? <StatusBadge meta={reverseMeta[live.state] ?? { label: live.state, tone: 'neutral' }} icon={false} /> : !item.enabled && <Badge tone="outline">已停用</Badge>}
                <Tooltip content="移除"><Button variant="destructive-ghost" size="icon-xs" className="ml-auto" aria-label={`移除反向地址 ${index + 1}`} onClick={() => config.update(next => { next.reverseWs.splice(index, 1); })}><Trash2 /></Button></Tooltip>
              </div>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_240px]">
                <Field label="机器人地址" htmlFor={`reverse-url-${index}`} error={issues[`reverseWs.${index}.url`]}>
                  <Input id={`reverse-url-${index}`} value={item.url} placeholder="ws://127.0.0.1:8080/onebot/v11/ws" className="font-mono text-caption" spellCheck={false}
                    aria-invalid={Boolean(issues[`reverseWs.${index}.url`])} aria-describedby={`reverse-url-${index}-hint`} onChange={event => config.update(next => { next.reverseWs[index].url = event.target.value; })} />
                </Field>
                <Field label="机器人端令牌（可选）" htmlFor={`reverse-token-${index}`} error={issues[`reverseWs.${index}.token`]}>
                  <SecretInput id={`reverse-token-${index}`} value={item.token} aria-invalid={Boolean(issues[`reverseWs.${index}.token`])} aria-describedby={`reverse-token-${index}-hint`}
                    onChange={event => config.update(next => { next.reverseWs[index].token = event.target.value; })} />
                </Field>
              </div>
            </li>;
          })}
        </ul> : <CardContent><p className="text-caption text-muted-foreground">尚未添加反向地址。使用 NoneBot、Koishi 等框架时，在这里填写框架提供的 OneBot v11 反向 WebSocket 地址。</p></CardContent>}
      </Card>

      <Card>
        <CardHeader><div className="grid gap-0.5"><CardTitle><KeyRound className="size-4 text-muted-foreground" aria-hidden />鉴权</CardTitle><CardDescription>机器人端需要填写相同的 Access Token。</CardDescription></div></CardHeader>
        <CardContent>
          <Field label="OneBot Access Token" htmlFor="access-token" error={issues.accessToken} description="16–256 位非空格 ASCII 字符，保存在本机配置文件中。">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1"><SecretInput id="access-token" value={draft.accessToken} aria-invalid={Boolean(issues.accessToken)} aria-describedby="access-token-hint"
                onChange={event => config.update(next => { next.accessToken = event.target.value; })} /></div>
              <Tooltip content="复制令牌"><Button variant="outline" size="icon" aria-label="复制令牌" onClick={() => copyText(draft.accessToken, '令牌已复制')}><Copy /></Button></Tooltip>
              <Tooltip content="重新生成"><Button variant="outline" size="icon" aria-label="重新生成令牌" onClick={() => setConfirmToken(true)}><RefreshCw /></Button></Tooltip>
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div className="grid gap-0.5"><CardTitle><Globe className="size-4 text-muted-foreground" aria-hidden />连接诊断</CardTitle><CardDescription>根据当前编辑中的配置检查常见问题。</CardDescription></div></CardHeader>
        <ul className="divide-y">{diagnose(draft, issues).map((check, index) => { const [Icon, color] = checkIcons[check.level]; return <li key={index} className="flex items-start gap-3 px-4 py-3 text-caption sm:px-5">
          <Icon className={cn('mt-0.5 size-4 shrink-0', color)} aria-hidden /><span className="text-secondary-foreground">{check.text}</span>
        </li>; })}</ul>
      </Card>
    </>}

    <SaveBar dirty={config.dirty} valid={config.valid} saving={config.saving} running={config.running} onSave={save} onReset={config.reset} />
    <ConfirmDialog open={confirmToken} onOpenChange={setConfirmToken} title="重新生成 Access Token？" confirmLabel="重新生成"
      description="保存后，所有机器人都需要改用新令牌才能连接；旧令牌在重启 OpenQQ 后失效。"
      onConfirm={() => config.update(next => { next.accessToken = randomHex(32); })} />
  </Page>;
}
