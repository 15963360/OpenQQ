import { useEffect, useRef, useState } from 'react';
import { App, Alert, Button, Form, Input, InputNumber, Select, Spin, Switch, Tooltip } from 'antd';
import { ArrowLeftOutlined, CopyOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import Brand from './Brand.jsx';
import { ThemeToggle } from './theme.jsx';
import { useAPI } from './api.jsx';

const steps = [
  ['开始之前', '检查本机环境。启动桥接前，请先完全退出正在运行的 QQ。'],
  ['客户端', '确认 QQ NT 安装目录和原生引导器。'],
  ['连接方式', '选择机器人与 OpenQQ 的通信方式，可以同时启用。'],
  ['访问密钥', '机器人端需要填写相同的 Access Token。'],
  ['确认配置', '确认无误后保存到本机配置文件。'],
  ['完成', '配置已保存，可以启动 OpenQQ 并连接机器人。'],
];
const required = [{ required: true, whitespace: true, message: '请填写此项' }];
const portRules = [{ required: true, type: 'number', min: 1, max: 65535, message: '请输入 1–65535 的端口' }];
const modes = [
  { value: 'forward', title: '正向 WebSocket', note: 'OpenQQ 作为服务端，机器人主动连接。适合自写 Bot。' },
  { value: 'reverse', title: '反向 WebSocket', note: 'OpenQQ 连接到 NoneBot 等框架提供的地址。' },
  { value: 'both', title: '同时启用', note: '正向服务与反向连接一起工作。' },
];

function Probe({ detected, checking, onCheck }) {
  const items = [
    { name: 'QQ 客户端', good: detected?.qq?.valid, text: detected?.qq?.version ? 'QQ ' + detected.qq.version : '未检测到', detail: detected?.qq?.error },
    { name: 'C++ 原生引导器', good: detected?.native?.ready, text: detected?.native?.ready ? '已就绪' : '未就绪', detail: detected?.native?.error },
    { name: 'QQ 进程', good: detected ? !detected.qqRunning : false, text: detected ? detected.qqRunning ? '正在运行，请先退出' : '未运行' : '等待检测' },
  ];
  return <div className="checklist">
    <div className="checklist-head"><span>本机环境</span><Button size="small" type="text" icon={<ReloadOutlined />} loading={checking} onClick={onCheck}>重新检测</Button></div>
    {items.map(item => <div className="check-row" key={item.name}><span>{item.name}</span><Tooltip title={item.detail}><span className={'status ' + (item.good ? 'ok' : 'warn')}><span className="dot" />{item.text}</span></Tooltip></div>)}
  </div>;
}

function CopyField({ value, label, onCopy }) {
  return <div className="copy-field"><code>{value}</code><Button size="small" type="text" aria-label={'复制' + (label || '')} icon={<CopyOutlined />} onClick={() => onCopy(value)} /></div>;
}

export default function Setup() {
  const { request } = useAPI(), { message } = App.useApp();
  const [form] = Form.useForm();
  const [config, setConfig] = useState(null), [detected, setDetected] = useState(null), [path, setPath] = useState('');
  const [step, setStep] = useState(0), [highest, setHighest] = useState(0), [mode, setMode] = useState('forward');
  const [running, setRunning] = useState(false), [busy, setBusy] = useState(false), [checking, setChecking] = useState(false), [error, setError] = useState('');
  const [loading, setLoading] = useState(true); const heading = useRef(null);
  const host = Form.useWatch(['ws', 'host'], form) || '127.0.0.1', port = Form.useWatch(['ws', 'port'], form) || 3001;
  const [, setRevision] = useState(0);
  async function load() {
    setLoading(true); setError('');
    try {
      const value = await request('/api/config'); setConfig(value.config); setDetected(value.detected || null); setPath(value.configPath || 'config/openqq.json'); setRunning(Boolean(value.running));
      form.setFieldsValue(value.config);
      setMode(value.config.ws.enabled ? value.config.reverseWs.some(item => item.enabled) ? 'both' : 'forward' : 'reverse');
    } catch (error) { setError(error.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [request]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }, [step]);
  function move(next) { setError(''); setStep(next); setHighest(previous => Math.max(previous, next)); setRevision(previous => previous + 1); }
  function draft() {
    const value = form.getFieldsValue(true);
    return { version: 1, qqRoot: value.qqRoot?.trim() || '', webPort: value.webPort,
      accessToken: value.accessToken || '', ws: { enabled: mode !== 'reverse', host: value.ws?.host || '127.0.0.1', port: value.ws?.port || 3001 },
      reverseWs: (value.reverseWs || []).filter(item => item?.url?.trim()).map(item => ({ enabled: mode !== 'forward' && Boolean(item.enabled), url: item.url.trim(), token: item.token || '' })) };
  }
  async function check() {
    setChecking(true); setError('');
    try { const values = form.getFieldsValue(true); const value = await request('/api/check', { qqRoot: values.qqRoot?.trim() }); setDetected(value); return value; }
    catch (error) { setError(error.message); return null; }
    finally { setChecking(false); }
  }
  async function advance() {
    if (busy || checking) return;
    setError(''); setBusy(true);
    try {
      if (step === 1) {
        await form.validateFields(['qqRoot']);
        const result = await check();
        if (!result?.qq?.valid || !result?.native?.ready) throw new Error('QQ 或原生引导器尚未就绪，请检查检测结果。');
      }
      if (step === 2) {
        await form.validateFields(mode === 'reverse' ? ['reverseWs'] : mode === 'both' ? ['ws', 'reverseWs'] : ['ws'], { recursive: true });
        const value = draft();
        if (mode !== 'forward' && !value.reverseWs.some(item => item.enabled)) throw new Error('请至少添加并启用一个机器人地址。');
      }
      if (step === 3) {
        await form.validateFields(['accessToken', 'webPort']);
        if (mode !== 'reverse' && draft().ws.port === draft().webPort) throw new Error('WebSocket 与 WebUI 不能使用同一个端口。');
      }
      if (step === 4) {
        const value = await request('/api/config', draft()); setConfig(value.config); setRunning(previous => previous || Boolean(value.restartRequired));
      }
      if (step === 5) {
        if (!running) await request('/api/start', {});
        location.assign('/'); return;
      }
      move(step + 1);
    } catch (error) { if (!error.errorFields) setError(error.name === 'TimeoutError' ? '等待响应超时，请检查终端中的运行状态。' : error.message); }
    finally { setBusy(false); }
  }
  function chooseMode(value) {
    setMode(value);
    if (value !== 'forward' && !(form.getFieldValue('reverseWs') || []).length) form.setFieldValue('reverseWs', [{ enabled: true, url: '', token: '' }]);
  }
  async function copy(value) { try { await navigator.clipboard.writeText(value); message.success('已复制'); } catch { message.error('复制失败，请手动选择文本'); } }
  const snapshot = config ? draft() : null;
  const forwardAddress = `ws://${host === '0.0.0.0' ? '<局域网 IP>' : '127.0.0.1'}:${port}/`;
  const review = snapshot ? [['QQ 安装目录', snapshot.qqRoot], ['连接方式', modes.find(item => item.value === mode).title],
    ...(snapshot.ws.enabled ? [['正向地址', forwardAddress]] : []), ...snapshot.reverseWs.filter(item => item.enabled).map((item, i) => ['反向地址 ' + (i + 1), item.url]),
    ['Access Token', '已设置 · ' + snapshot.accessToken.length + ' 位'], ['WebUI 端口', snapshot.webPort]] : [];
  const action = step === 0 ? '开始' : step === 4 ? '保存配置' : step === 5 ? running ? '进入控制台' : '启动 OpenQQ' : '下一步';

  return <div className="app">
    <header className="topbar"><div className="topbar-inner">
      <Brand />
      <span className="topbar-title">接入设置</span>
      <div className="topbar-actions"><Button type="text" href="/" icon={<ArrowLeftOutlined />}>控制台</Button><ThemeToggle /></div>
    </div></header>

    <main className="setup">
      <ol className="stepper" aria-label="设置步骤">
        {steps.map(([title], index) => <li key={title}><button type="button" className={'step' + (index === step ? ' current' : index < step || index <= highest ? ' done' : '')} disabled={busy || index > highest} aria-current={index === step ? 'step' : undefined} onClick={() => { if (!busy && index <= highest) move(index); }}><span className="step-bar" /><span className="step-title">{title}</span></button></li>)}
      </ol>

      <section className="panel setup-card">
        {loading ? <div className="center"><Spin /><p className="muted">正在读取本机配置…</p></div>
          : !config ? <div className="center"><h1>无法读取配置</h1><p className="muted">{error}</p><Button onClick={load}>重试</Button></div>
          : <>
            <header className="setup-head">
              <span className="eyebrow">步骤 {step + 1} / {steps.length}</span>
              <h1 tabIndex={-1} ref={heading}>{steps[step][0]}</h1>
              <p className="muted">{step === 5 && running ? '新配置已保存，将在下次启动 OpenQQ 后生效。' : steps[step][1]}</p>
            </header>

            <Form form={form} layout="vertical" requiredMark={false} disabled={busy} onValuesChange={() => setRevision(previous => previous + 1)}>
              {step === 0 && <Probe detected={detected} checking={checking} onCheck={check} />}

              {step === 1 && <>
                <Form.Item name="qqRoot" label="QQ 安装目录" rules={required} extra={detected?.qq?.valid ? `已识别 QQ ${detected.qq.version || ''}` : detected?.qq?.error || 'QQ NT 的安装目录'}><Input spellCheck={false} /></Form.Item>
                {detected?.qqCandidates?.length > 0 && <div className="chips">{detected.qqCandidates.map(item => <Tooltip key={item.path} title={item.path}><Button size="small" onClick={() => form.setFieldValue('qqRoot', item.path)}>{item.version || item.path}</Button></Tooltip>)}</div>}
                <Button size="small" loading={checking} onClick={check} icon={<ReloadOutlined />}>校验路径</Button>
              </>}

              {step === 2 && <>
                <div className="choices" role="radiogroup" aria-label="连接方式">
                  {modes.map(item => <button type="button" role="radio" aria-checked={mode === item.value} key={item.value} className={'choice' + (mode === item.value ? ' selected' : '')} onClick={() => chooseMode(item.value)}>
                    <span className="radio" /><span><strong>{item.title}</strong><small>{item.note}</small></span>
                  </button>)}
                </div>
                {mode !== 'reverse' && <fieldset className="group"><legend>正向连接</legend>
                  <div className="form-grid">
                    <Form.Item name={['ws', 'host']} label="监听范围"><Select options={[{ value: '127.0.0.1', label: '仅本机 · 127.0.0.1' }, { value: '0.0.0.0', label: '局域网 · 0.0.0.0' }]} /></Form.Item>
                    <Form.Item name={['ws', 'port']} label="端口" rules={portRules}><InputNumber controls={false} min={1} max={65535} /></Form.Item>
                  </div>
                  <p className="hint">机器人连接地址 <code>{forwardAddress}</code></p>
                </fieldset>}
                {mode !== 'forward' && <fieldset className="group"><legend>反向连接</legend>
                  <Form.List name="reverseWs">{(fields, { add, remove }) => <>
                    {fields.map(field => <div className="reverse-item" key={field.key}>
                      <div className="reverse-head"><Form.Item name={[field.name, 'enabled']} valuePropName="checked" noStyle><Switch size="small" aria-label={'启用反向连接 ' + (field.name + 1)} /></Form.Item><span>地址 {field.name + 1}</span><Button type="text" size="small" icon={<DeleteOutlined />} aria-label={'移除反向连接 ' + (field.name + 1)} onClick={() => remove(field.name)} /></div>
                      <Form.Item name={[field.name, 'url']} label="机器人地址" rules={[{ validator: (_, value) => { try { const url = new URL(value); if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error(); return Promise.resolve(); } catch { return Promise.reject(new Error('请填写不含查询参数的 ws:// 或 wss:// 地址')); } } }]}><Input placeholder="ws://127.0.0.1:8080/onebot/v11/ws" /></Form.Item>
                      <Form.Item name={[field.name, 'token']} label="机器人端令牌（可选）"><Input.Password autoComplete="off" /></Form.Item>
                    </div>)}
                    <Button type="dashed" icon={<PlusOutlined />} disabled={fields.length >= 8} onClick={() => add({ enabled: true, url: '', token: '' })} block>添加地址</Button>
                  </>}</Form.List>
                </fieldset>}
              </>}

              {step === 3 && <>
                <Form.Item name="accessToken" label="OneBot Access Token" rules={[{ required: true, pattern: /^[\x21-\x7e]{16,256}$/, message: '需要 16–256 位非空格 ASCII 字符' }]} extra={<>机器人端需要填写相同的值。<Button className="inline-link" size="small" type="link" onClick={() => form.setFieldValue('accessToken', [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join(''))}>重新生成</Button></>}><Input.Password autoComplete="off" spellCheck={false} /></Form.Item>
                <Form.Item name="webPort" label="WebUI 端口" rules={portRules} extra="仅监听本机，修改后下次启动生效。"><InputNumber controls={false} min={1} max={65535} /></Form.Item>
                <p className="hint">模型服务的 API Key 在 Bot 程序中配置，不在这里填写。</p>
              </>}

              {step === 4 && <dl className="review">{review.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}

              {step === 5 && <div className="finish">
                {config.ws.enabled && <div className="done-item"><span className="label">正向连接地址</span><CopyField value={`ws://127.0.0.1:${config.ws.port}/`} label="连接地址" onCopy={copy} />{config.ws.host === '0.0.0.0' && <p className="hint">其他设备请把 127.0.0.1 换成这台电脑的局域网 IP。</p>}</div>}
                {config.reverseWs.filter(item => item.enabled).map((item, index) => <div className="done-item" key={index}><span className="label">反向地址 {index + 1}</span><CopyField value={item.url} label="反向地址" onCopy={copy} /></div>)}
                <div className="done-item"><span className="label">Access Token</span><Button size="small" icon={<CopyOutlined />} onClick={() => copy(config.accessToken)}>复制令牌</Button></div>
                <details className="more"><summary>运行示例 Bot</summary><p>新开终端，设置 OneBot 令牌并运行示例，然后私聊发送 /ping 测试。</p><pre className="code">{"$env:ONEBOT_TOKEN = '你的令牌'\nnpm run bot"}</pre><p>调用模型还需设置 BOT_API_URL、BOT_API_KEY、BOT_MODEL 和 BOT_ALLOW_USERS，再私聊发送 /ai 问题。</p></details>
                <p className="hint">配置文件 <code>{path}</code></p>
              </div>}
            </Form>

            {error && <Alert className="setup-error" type="error" title={error} showIcon />}
            <footer className="setup-actions">
              {step > 0 ? <Button disabled={busy} onClick={() => move(step - 1)}>上一步</Button> : <span className="hint">配置只保存在这台电脑</span>}
              <Button type="primary" loading={busy || checking} onClick={advance}>{action}</Button>
            </footer>
          </>}
      </section>
    </main>
  </div>;
}
