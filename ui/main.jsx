import { createRoot } from 'react-dom/client';
import { App as AntApp, Button, ConfigProvider, Form, Input } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { APIProvider, useAPI } from './api.jsx';
import Dashboard from './Dashboard.jsx';
import Setup from './Setup.jsx';
import Brand from './Brand.jsx';
import { ThemeProvider, ThemeToggle, antdThemeConfig, useTheme } from './theme.jsx';
import './styles.css';

function Login() {
  const { setToken } = useAPI();
  return <div className="auth-page">
    <header className="auth-top"><Brand /><ThemeToggle /></header>
    <main className="auth-card panel">
      <h1>输入访问密钥</h1>
      <p className="muted">打开终端显示的完整 WebUI 地址，或粘贴本次启动的访问密钥。</p>
      <Form layout="vertical" requiredMark={false} onFinish={values => setToken(values.token.trim())}>
        <Form.Item name="token" label="访问密钥" rules={[{ required: true, whitespace: true, message: '请输入访问密钥' }]}><Input.Password autoComplete="off" placeholder="粘贴访问密钥" autoFocus /></Form.Item>
        <Button type="primary" htmlType="submit" block>进入控制台</Button>
      </Form>
      <p className="hint">密钥只保存在当前标签页的会话中。</p>
    </main>
  </div>;
}

function Application() {
  const { token } = useAPI();
  if (!token) return <Login />;
  return location.pathname === '/setup' ? <Setup /> : <Dashboard />;
}

function Root() {
  const { dark } = useTheme();
  const nonce = document.querySelector('meta[name="style-nonce"]')?.content;
  return <ConfigProvider locale={zhCN} csp={{ nonce }} button={{ autoInsertSpace: false }} theme={antdThemeConfig(dark)}>
    <AntApp><APIProvider><Application /></APIProvider></AntApp>
  </ConfigProvider>;
}

window.addEventListener('hashchange', () => { if (new URLSearchParams(location.hash.slice(1)).has('token')) location.reload(); });
createRoot(document.getElementById('root')).render(<ThemeProvider><Root /></ThemeProvider>);
