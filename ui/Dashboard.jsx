import { useEffect, useMemo, useState } from 'react';
import { App, Button, Drawer, Form, Input, Segmented, Select, Tooltip } from 'antd';
import { CopyOutlined, DeleteOutlined, PauseOutlined, CaretRightOutlined, SearchOutlined } from '@ant-design/icons';
import Brand from './Brand.jsx';
import { ThemeToggle } from './theme.jsx';
import { useAPI, useEventStream } from './api.jsx';
import { describeEntry, identifier, messageRequest } from './format.mjs';

const phases = { detached: '未接入', starting: '正在启动', hook_installed: '等待登录', session_ready: '会话就绪', offline: '已掉线', failed: '启动失败', hook_error: '接入异常' };
const types = { message: '消息', notice: '通知', request: '请求', action: '动作', diagnostic: '诊断' };
const time = value => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
const templates = ['get_login_info', 'get_status', 'send_private_msg', 'send_group_msg', 'set_input_status'];
const reverseNames = { waiting: '等待 QQ', connecting: '连接中', connected: '已连接', reconnecting: '重连中' };

function Pill({ tone = 'neutral', children }) { return <span className={'pill pill-' + tone}>{children}</span>; }

function Composer({ ready, state, form }) {
  const { request } = useAPI(), { message } = App.useApp();
  const [mode, setMode] = useState('message'), [busy, setBusy] = useState(false), [receipt, setReceipt] = useState(null);
  const targetType = Form.useWatch('targetType', form) || 'private';
  const execute = async typing => {
    if (!ready || busy) return;
    let submitted = false;
    try {
      const values = await form.validateFields(typing ? ['target'] : mode === 'json' ? ['jsonAction'] : ['target', 'message']);
      let action;
      if (typing) action = { action: 'set_input_status', params: { user_id: identifier(values.target), event_type: 1 } };
      else if (mode === 'json') {
        try { action = JSON.parse(values.jsonAction); } catch { throw new Error('动作 JSON 格式无效'); }
        if (!action || Array.isArray(action) || typeof action.action !== 'string') throw new Error('需要 {action, params, echo?} 动作对象');
      } else action = messageRequest({ ...values, targetType });
      setBusy(true);
      submitted = true;
      const result = await request('/api/action', action); setReceipt(result);
      if (result.status === 'ok') { message.success('动作执行成功'); if (!typing && mode === 'message') form.setFieldValue('message', ''); }
      else message.error(result.message || '动作执行失败');
    } catch (error) {
      if (error.errorFields) return;
      const text = (error.name === 'TimeoutError' ? '等待回执超时' : error.message) + (submitted ? '；如已提交发送，请先在 QQ 中确认结果。' : '');
      setReceipt({ status: 'failed', message: text }); message.error(text);
    } finally { setBusy(false); }
  };
  function template(action) {
    const value = { action, ...(action.startsWith('send_') ? { params: { [action === 'send_group_msg' ? 'group_id' : 'user_id']: '', message: '', auto_escape: true } } : action === 'set_input_status' ? { params: { user_id: '', event_type: 1 } } : {}), echo: 'webui' };
    form.setFieldValue('jsonAction', JSON.stringify(value, null, 2));
  }
  return <aside className="side">
    <section className="panel composer" id="composer">
      <header className="panel-head"><h2>发送与调试</h2><Segmented size="small" value={mode} onChange={setMode} options={[{ value: 'message', label: '消息' }, { value: 'json', label: 'JSON' }]} /></header>
      <Form className="panel-body" form={form} layout="vertical" requiredMark={false} initialValues={{ targetType: 'private', jsonAction: '{\n  "action": "get_login_info",\n  "echo": "webui"\n}' }} disabled={!ready || busy} onFinish={() => execute(false)}>
        {mode === 'message' ? <>
          <Form.Item name="targetType" label="会话"><Segmented block options={[{ value: 'private', label: '私聊' }, { value: 'group', label: '群聊' }]} /></Form.Item>
          <Form.Item name="target" label={targetType === 'group' ? '群号' : 'QQ 号'} rules={[{ validator: (_, value) => { try { identifier(value); return Promise.resolve(); } catch (error) { return Promise.reject(error); } } }]}><Input placeholder={targetType === 'group' ? '输入群号' : '输入 QQ 号'} inputMode="numeric" /></Form.Item>
          <Form.Item name="message" label="内容" extra="纯文本发送 · Ctrl + Enter 发送" rules={[{ required: true, message: '请输入消息' }, { validator: (_, value) => !value || new TextEncoder().encode(value).length <= 65536 ? Promise.resolve() : Promise.reject(new Error('消息超过 64 KiB')) }]}><Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder="输入消息" maxLength={65536} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); execute(false); } }} /></Form.Item>
        </> : <>
          <Form.Item label="模板"><Select placeholder="选择动作" options={templates.map(value => ({ value, label: value }))} onChange={template} /></Form.Item>
          <Form.Item name="jsonAction" label="动作" rules={[{ required: true, message: '请输入动作 JSON' }]}><Input.TextArea className="mono" autoSize={{ minRows: 8, maxRows: 16 }} spellCheck={false} /></Form.Item>
        </>}
        <div className="composer-actions">
          <Button type="primary" htmlType="submit" block loading={busy}>{mode === 'json' ? '执行动作' : '发送'}</Button>
          {mode === 'message' && <Button block disabled={targetType !== 'private' || !ready || busy} onClick={() => execute(true)}>发送「正在输入」</Button>}
        </div>
        <p className="hint">{ready ? '通过当前登录的 QQ 会话执行。' : state.syncing ? 'QQ 正在同步，请稍候。' : 'QQ 会话就绪后才能执行动作。'}</p>
      </Form>
    </section>
    <section className="panel">
      <header className="panel-head"><h2>最近回执</h2>{receipt ? <Pill tone={receipt.status === 'ok' ? 'success' : 'danger'}>{receipt.status === 'ok' ? '成功' : '失败'}</Pill> : <Pill>暂无</Pill>}</header>
      <pre className="code receipt">{receipt ? JSON.stringify(receipt, null, 2) : '执行结果会显示在这里'}</pre>
    </section>
  </aside>;
}

export default function Dashboard() {
  const { state, counts, entries, connected } = useEventStream();
  const [view, setView] = useState('events'), [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [paused, setPaused] = useState(null), [cutoff, setCutoff] = useState(0), [detail, setDetail] = useState(null);
  const [form] = Form.useForm(); const { message } = App.useApp();
  const ready = connected && state.phase === 'session_ready' && state.syncing !== true;
  useEffect(() => { if (state.phase === 'setup') location.replace('/setup'); }, [state.phase]);
  const data = useMemo(() => (paused || entries).filter(entry => entry.id > cutoff && (view === 'diagnostics' ? entry.kind === 'diagnostic' : entry.kind !== 'diagnostic'))
    .map(entry => ({ ...entry, description: describeEntry(entry) })).filter(entry => (filter === 'all' || view === 'diagnostics' || entry.description.kind === filter) && (!query || JSON.stringify(entry.data).toLowerCase().includes(query.toLowerCase()))).reverse(), [entries, paused, cutoff, view, filter, query]);
  const network = state.network;
  const phaseTone = ready ? 'success' : ['failed', 'offline', 'hook_error'].includes(state.phase) ? 'danger' : 'neutral';
  const links = network ? [network.ws.enabled ? network.ws.clients + ' 个正向客户端' : '', ...network.reverseWs.map(item => '反向 ' + (item.index + 1) + ' ' + (reverseNames[item.state] || item.state))].filter(Boolean).join(' · ') || '未启用连接' : '等待服务启动';
  async function copy(value) { try { await navigator.clipboard.writeText(value); message.success('已复制'); } catch { message.error('复制失败，请手动选择文本'); } }
  function useTarget() {
    const value = detail.data; form.setFieldsValue({ targetType: value.group_id ? 'group' : 'private', target: String(value.group_id || value.user_id) }); setDetail(null);
    document.getElementById('composer')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const nav = [['events', '工作台'], ['diagnostics', '运行日志']];
  return <div className="app">
    <header className="topbar"><div className="topbar-inner">
      <Brand />
      <nav className="nav" aria-label="主导航">
        {nav.map(([key, label]) => <button type="button" key={key} className={'nav-item' + (view === key ? ' active' : '')} aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)}>{label}</button>)}
        <a className="nav-item" href="/setup">接入设置</a>
      </nav>
      <div className="topbar-actions"><span className={'live' + (connected ? ' on' : '')}><span className="dot" />{connected ? '实时' : '重连中'}</span><ThemeToggle /></div>
    </div></header>

    <main className="container">
      <section className="stats" aria-label="运行状态">
        <div className="stat stat-wide"><span className="stat-label">QQ 会话</span><strong className="stat-value">{state.self_id || '未登录'}</strong><span className="stat-meta"><Pill tone={phaseTone}>{state.syncing ? '同步中' : phases[state.phase] || state.phase}</Pill>{state.version && <span>QQ {state.version}</span>}</span></div>
        <div className="stat stat-wide"><span className="stat-label">机器人连接</span><strong className="stat-value mono">{network?.ws.enabled ? network.ws.address || '正在启动' : '正向未启用'}</strong><span className="stat-meta">{links}</span></div>
        <div className="stat"><span className="stat-label">事件</span><strong className="stat-value">{counts.events.toLocaleString()}</strong></div>
        <div className="stat"><span className="stat-label">动作</span><strong className="stat-value">{counts.actions.toLocaleString()}</strong></div>
        <div className={'stat' + (counts.errors ? ' stat-danger' : '')}><span className="stat-label">异常</span><strong className="stat-value">{counts.errors.toLocaleString()}</strong></div>
      </section>

      <div className="layout">
        <section className="panel feed">
          <header className="panel-head">
            <h2>{view === 'diagnostics' ? '运行日志' : '实时事件'}{paused && <Pill tone="warning">已暂停</Pill>}</h2>
            <div className="toolbar">
              <Input className="search" size="small" prefix={<SearchOutlined />} placeholder="搜索内容或 QQ 号" allowClear value={query} onChange={event => setQuery(event.target.value)} />
              {view !== 'diagnostics' && <Select size="small" className="filter" aria-label="事件类型" value={filter} onChange={setFilter} options={[{ value: 'all', label: '全部' }, ...Object.entries(types).filter(([key]) => key !== 'diagnostic').map(([value, label]) => ({ value, label }))]} />}
              <Tooltip title={paused ? '继续' : '暂停'}><Button size="small" type="text" aria-label={paused ? '继续事件流' : '暂停事件流'} icon={paused ? <CaretRightOutlined /> : <PauseOutlined />} onClick={() => setPaused(paused ? null : entries.slice())} /></Tooltip>
              <Tooltip title="清空视图"><Button size="small" type="text" aria-label="清空当前视图" icon={<DeleteOutlined />} onClick={() => { setCutoff(entries.at(-1)?.id || 0); setPaused(null); }} /></Tooltip>
            </div>
          </header>
          {data.length ? <ul className="rows">{data.map(row => <li key={row.id}>
            <button type="button" className="row" onClick={() => setDetail(row)}>
              <span className={'kind' + (row.description.failed ? ' failed' : '')}>{types[row.description.kind]}</span>
              <span className="row-main"><span className="row-title">{row.description.title}<span className="row-source">{row.description.source}</span></span><span className="row-text">{row.description.text.slice(0, 200)}</span></span>
              <time className="row-time">{time(row.time)}</time>
            </button>
          </li>)}</ul> : <div className="empty"><strong>暂无记录</strong><span>{query ? '没有匹配的记录，换个关键词试试。' : view === 'diagnostics' ? '运行日志会显示在这里。' : '新的消息、通知和动作回执会实时出现在这里。'}</span></div>}
          <footer className="panel-foot"><span>{data.length} 条</span><span>仅保存在内存 · 最近 200 条</span></footer>
        </section>
        <Composer ready={ready} state={state} form={form} />
      </div>
    </main>

    <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title="事件详情" size={560} extra={<Button size="small" icon={<CopyOutlined />} onClick={() => copy(JSON.stringify(detail?.data, null, 2))}>复制 JSON</Button>}>
      {detail && <div className="detail">
        <div className="detail-meta"><span className={'kind' + (detail.description.failed ? ' failed' : '')}>{types[detail.description.kind]}</span><span>{time(detail.time)}</span><span>{detail.description.source}</span></div>
        <h3>{detail.description.title}</h3>
        <p className="muted">{detail.description.text}</p>
        {detail.kind === 'event' && (detail.data.group_id || detail.data.user_id) && <Button size="small" onClick={useTarget}>填入发送目标</Button>}
        <pre className="code">{JSON.stringify(detail.data, null, 2)}</pre>
      </div>}
    </Drawer>
  </div>;
}
