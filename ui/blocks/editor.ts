// Scratch 式积木编辑器：Blockly + zelos 渲染器，打包成独立的 /blocks.js，由 Bot 页面按需加载。
// 积木的定义来自 src/bot/blocks.mjs（服务端用同一份定义校验程序）；这里只负责外观、工具箱和对话框。
// WebUI 有严格的 CSP（没有 CDN、<style> 必须带 nonce），所以：库全部本地打包；Blockly 注入样式时补上 nonce；
// 弹窗用自带的 DOM 对话框，不用浏览器的 prompt / confirm。
import * as Blockly from 'blockly/core';
import * as zhHans from 'blockly/msg/zh-hans';
import { blockDefinitions } from '../../src/bot/blocks.mjs';

export interface EditorHandle {
  /** Blockly 序列化后的工作区（可直接保存到服务器）。 */
  getState(): unknown;
  setState(state: unknown): void;
  setDark(dark: boolean): void;
  blockCount(): number;
  resize(): void;
  dispose(): void;
}
export interface EditorOptions { state: unknown; dark: boolean; onChange(): void }

// ---- CSP：给 Blockly 创建的 <style> 加上页面的 nonce ----------------------------------------------------------------
const nonce = document.querySelector<HTMLMetaElement>('meta[name="style-nonce"]')?.content;
if (nonce) {
  const create = Document.prototype.createElement as (this: Document, ...args: unknown[]) => HTMLElement;
  (Document.prototype as unknown as { createElement: typeof create }).createElement = function (this: Document, ...args: unknown[]) {
    const element = create.apply(this, args);
    if (element instanceof HTMLStyleElement) element.nonce = nonce;
    return element;
  };
}

// ---- 积木颜色 -------------------------------------------------------------------------------------------------------
const palette = {
  events: '#D99A00', control: '#E0792B', sensing: '#2E9BD6', operator: '#3AA75A',
  variable: '#E8801A', send: '#8F6BE0', ai: '#3B6FE0', memory: '#D9467A',
};
const blockStyles = Object.fromEntries(Object.entries(palette).map(([name, colour]) => [`oq_${name}`, { colourPrimary: colour, ...(name === 'events' ? { hat: 'cap' } : {}) }]));
const categoryStyles = Object.fromEntries(Object.entries(palette).map(([name, colour]) => [`oq_${name}_category`, { colour }]));
const fontStyle = { family: '"Inter Variable", Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif', weight: '600', size: 12 };

function makeTheme(dark: boolean) {
  return Blockly.Theme.defineTheme(dark ? 'openqq-dark' : 'openqq-light', {
    name: dark ? 'openqq-dark' : 'openqq-light', base: Blockly.Themes.Classic, blockStyles, categoryStyles, fontStyle,
    componentStyles: dark
      ? { workspaceBackgroundColour: '#171717', toolboxBackgroundColour: '#1f1f1f', toolboxForegroundColour: '#e5e5e5', flyoutBackgroundColour: '#262626', flyoutForegroundColour: '#e5e5e5', flyoutOpacity: 0.97, scrollbarColour: '#737373', scrollbarOpacity: 0.5, insertionMarkerColour: '#ffffff', insertionMarkerOpacity: 0.3, cursorColour: '#d0d0d0' }
      : { workspaceBackgroundColour: '#f6f7f9', toolboxBackgroundColour: '#ffffff', toolboxForegroundColour: '#404040', flyoutBackgroundColour: '#f0f1f4', flyoutForegroundColour: '#404040', flyoutOpacity: 0.97, scrollbarColour: '#a3a3a3', scrollbarOpacity: 0.5, insertionMarkerColour: '#000000', insertionMarkerOpacity: 0.2, cursorColour: '#404040' },
  });
}

// ---- 工具箱 ---------------------------------------------------------------------------------------------------------
type Inputs = Record<string, { shadow?: { type: string; fields?: Record<string, unknown> }; block?: { type: string; fields?: Record<string, unknown> } }>;
const item = (type: string, fields?: Record<string, unknown>, inputs?: Inputs) => ({ kind: 'block', type, ...(fields ? { fields } : {}), ...(inputs ? { inputs } : {}) });
const text = (value = '') => ({ shadow: { type: 'oq_text', fields: { TEXT: value } } });
const num = (value = 0) => ({ shadow: { type: 'oq_number', fields: { NUM: value } } });
const info = (field: string) => ({ block: { type: 'oq_event_info', fields: { FIELD: field } } });
const category = (name: string, style: string, contents: unknown[]) => ({ kind: 'category', name, categorystyle: `oq_${style}_category`, contents });

const toolbox = {
  kind: 'categoryToolbox',
  contents: [
    category('触发', 'events', [
      item('oq_on_mention'), item('oq_on_message', { SCOPE: 'private' }), item('oq_on_keyword'), item('oq_on_command'),
    ]),
    category('控制', 'control', [
      item('oq_if', undefined, { COND: {} }), item('oq_if_else'), item('oq_repeat', undefined, { TIMES: num(3) }), item('oq_while'), item('oq_stop'),
    ]),
    category('消息信息', 'sensing', [
      item('oq_event_info', { FIELD: 'text' }), item('oq_event_info', { FIELD: 'sender_name' }), item('oq_event_info', { FIELD: 'sender_id' }), item('oq_event_info', { FIELD: 'group_id' }),
      item('oq_event_info', { FIELD: 'args' }), item('oq_event_flag', { FLAG: 'mentioned' }), item('oq_event_flag', { FLAG: 'group' }), item('oq_event_flag', { FLAG: 'image' }), item('oq_time'),
    ]),
    category('运算', 'operator', [
      item('oq_text'), item('oq_number'), item('oq_bool'),
      item('oq_join', undefined, { A: text('你好，'), B: text('') }),
      item('oq_text_contains', undefined, { TEXT: text(''), SUB: text('') }),
      item('oq_text_length', undefined, { TEXT: text('') }),
      item('oq_text_replace', undefined, { TEXT: text(''), FROM: text(''), TO: text('') }),
      item('oq_text_sub', undefined, { TEXT: text(''), FROM: num(1), TO: num(5) }),
      item('oq_arith', undefined, { A: num(1), B: num(1) }),
      item('oq_compare', undefined, { A: text(''), B: text('') }),
      item('oq_logic'), item('oq_not'),
      item('oq_random', undefined, { FROM: num(1), TO: num(6) }), item('oq_random_pick'),
    ]),
    { kind: 'category', name: '变量', categorystyle: 'oq_variable_category', custom: 'OQ_VARIABLES' },
    category('发送', 'send', [
      item('oq_reply', undefined, { TEXT: text('收到') }),
      item('oq_send_to', undefined, { ID: text(''), TEXT: text('') }),
      item('oq_send_media', undefined, { SRC: text('https://') }),
      item('oq_send_fun', { TYPE: 'dice' }), item('oq_send_fun', { TYPE: 'rps' }),
      item('oq_send_face', undefined, { ID: num(14) }),
    ]),
    category('AI', 'ai', [
      item('oq_ai_reply', undefined, { PROMPT: info('text') }),
      item('oq_ai_ask', undefined, { PROMPT: info('text') }),
    ]),
    category('记忆', 'memory', [
      item('oq_mem_set', undefined, { KEY: text('名字'), VALUE: text('') }),
      item('oq_mem_get', undefined, { KEY: text('名字') }),
      item('oq_mem_forget', undefined, { KEY: text('名字') }),
      item('oq_mem_clear_chat'),
    ]),
  ],
};

// ---- 对话框（替换浏览器自带的 prompt / confirm）------------------------------------------------------------------------
function dialog(message: string, { input, confirmLabel = '确定', cancel = true }: { input?: string; confirmLabel?: string; cancel?: boolean }, done: (value: string | null) => void) {
  const previous = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:var(--overlay,rgba(0,0,0,.3))';
  const box = document.createElement('div');
  box.style.cssText = 'width:min(360px,calc(100vw - 32px));display:grid;gap:12px;padding:20px;border:1px solid var(--border);border-radius:12px;background:var(--popover,#fff);color:var(--foreground);box-shadow:var(--shadow-lg);font:14px var(--font-sans)';
  const label = document.createElement('div');
  label.textContent = message;
  label.style.cssText = 'white-space:pre-wrap;line-height:1.5';
  box.append(label);
  let field: HTMLInputElement | undefined;
  if (input !== undefined) {
    field = document.createElement('input');
    field.value = input;
    field.maxLength = 40;
    field.style.cssText = 'height:36px;padding:0 12px;border:1px solid var(--input);border-radius:6px;background:var(--card);color:inherit;font:inherit;outline:none';
    box.append(field);
  }
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';
  const button = (labelText: string, primary: boolean) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = labelText;
    element.style.cssText = `height:34px;padding:0 14px;border-radius:6px;font:inherit;font-weight:500;cursor:pointer;border:1px solid ${primary ? 'transparent' : 'var(--border)'};background:${primary ? 'var(--primary)' : 'var(--card)'};color:${primary ? 'var(--primary-foreground)' : 'inherit'}`;
    return element;
  };
  const close = (value: string | null) => { overlay.remove(); previous?.focus?.(); done(value); };
  if (cancel) { const no = button('取消', false); no.addEventListener('click', () => close(null)); row.append(no); }
  const yes = button(confirmLabel, true);
  yes.addEventListener('click', () => close(field ? field.value : 'ok'));
  row.append(yes);
  box.append(row);
  overlay.append(box);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(null); }
    else if (event.key === 'Enter' && (event.target === field || event.target === overlay)) { event.preventDefault(); close(field ? field.value : 'ok'); }
  });
  overlay.addEventListener('mousedown', event => { if (event.target === overlay && cancel) close(null); });
  document.body.append(overlay);
  (field ?? yes).focus();
  field?.select();
}
Blockly.dialog.setPrompt((message, defaultValue, callback) => dialog(message, { input: defaultValue }, callback));
Blockly.dialog.setConfirm((message, callback) => dialog(message, { confirmLabel: '确定' }, value => callback(value !== null)));
Blockly.dialog.setAlert((message, callback) => dialog(message, { cancel: false }, () => callback?.()));

// ---- 挂载 -----------------------------------------------------------------------------------------------------------
let defined = false;
export function mountEditor(container: HTMLElement, options: EditorOptions): EditorHandle {
  if (!defined) {
    Blockly.setLocale(zhHans as unknown as { [key: string]: string });
    Blockly.defineBlocksWithJsonArray(blockDefinitions as unknown as object[]);
    defined = true;
  }
  const themes = { light: makeTheme(false), dark: makeTheme(true) };
  const workspace = Blockly.inject(container, {
    renderer: 'zelos', media: '/blockly-media/', theme: options.dark ? themes.dark : themes.light, toolbox, sounds: false, trashcan: true, collapse: true, comments: false, maxBlocks: 300,
    grid: { spacing: 24, length: 3, colour: options.dark ? '#2e2e2e' : '#e3e5ea', snap: true },
    zoom: { controls: true, wheel: true, startScale: 0.9, maxScale: 1.6, minScale: 0.4, scaleSpeed: 1.1 },
    move: { scrollbars: true, drag: true, wheel: false },
  });

  // 「变量」分类：Scratch 风格的「新建变量」按钮，加上设置/增加/读取积木。
  workspace.registerButtonCallback('OQ_CREATE_VARIABLE', button => Blockly.Variables.createVariableButtonHandler(button.getTargetWorkspace()));
  workspace.registerToolboxCategoryCallback('OQ_VARIABLES', ws => {
    const contents: unknown[] = [{ kind: 'button', text: '新建变量', callbackKey: 'OQ_CREATE_VARIABLE' }];
    const variables = ws.getAllVariables();
    if (variables.length) {
      const first = { VAR: { id: variables[0].getId() } };
      contents.push(item('oq_var_set', first, { VALUE: text('') }), item('oq_var_change', first, { DELTA: num(1) }));
      for (const variable of variables) contents.push(item('oq_var_get', { VAR: { id: variable.getId() } }));
    }
    return contents as never;
  });

  const load = (state: unknown) => {
    Blockly.Events.disable();
    try {
      workspace.clear();
      if (state && typeof state === 'object') Blockly.serialization.workspaces.load(state as never, workspace);
    } finally { Blockly.Events.enable(); }
    workspace.scrollCenter();
  };
  load(options.state);

  // 只有真正修改了积木才算「有改动」；拖动画布、选中积木、点开工具箱等界面事件不算。
  workspace.addChangeListener(event => {
    if (event.isUiEvent || event.type === Blockly.Events.FINISHED_LOADING || workspace.isDragging()) return;
    options.onChange();
  });
  const observer = new ResizeObserver(() => Blockly.svgResize(workspace));
  observer.observe(container);

  return {
    getState: () => Blockly.serialization.workspaces.save(workspace),
    setState: load,
    setDark(dark) { workspace.setTheme(dark ? themes.dark : themes.light); },
    blockCount: () => workspace.getAllBlocks(false).length,
    resize: () => Blockly.svgResize(workspace),
    dispose() { observer.disconnect(); workspace.dispose(); },
  };
}
