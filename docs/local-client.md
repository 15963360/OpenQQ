# 原生挂接原理与客户端兼容性

本文档说明 OpenQQ 如何在不依赖 Electron `--inspect` 端口、不加载第三方注入模块的前提下，对 Windows x64 QQ NT 客户端进行环境校验与原生会话接入。

## 安装目录与 PE64 兼容性检查

在配置校验、`npm run doctor` 以及启动前的 `inspectQQ()`（位于 `src/qq.mjs`）阶段，OpenQQ 会对目标安装目录执行以下只读检查：

1. **目录与版本元数据**：验证目录下存在 `QQ.exe`、`QQNT.dll`、`resources/app/package.json`、`versions/config.json`，以及当前活动版本目录下的 `wrapper.node`。
2. **目录结构校验**：验证活动资源目录及入口指针均解析在 QQ 安装根目录以内，防止路径逃逸。
3. **x64 PE 导出表解析（`readPE64Info`）**：
   - 解析 `QQNT.dll` 的 PE32+ 头确认架构为 `x64`（`Machine === 0x8664`），并读取导出表验证包含关键符号：
     - `qq_magic_napi_register`
     - `napi_create_function`
     - `napi_set_named_property`
     - `napi_get_named_property`
   - 解析当前版本目录下的 `wrapper.node` 确认同样为有效的 `x64` 二进制文件。
4. **Electron Fuses 只读状态**：支持读取 `QQ.exe` 中的 `electron_fuses` 标志位，用于诊断客户端运行时安全选项，读取异常时降级为空而不中断正常启动探测。

### 版本兼容策略

- **基准实机验证版本**：`9.9.33-52230`（`targetMatch: true`）。
- **其他 Windows x64 QQ NT 9.x 构建**：只要满足 `x64` 架构并包含上述所需 N-API 导出和 `qq_magic_napi_register`，即判定为 `supported: true` 允许启动，启动时会输出非基准版本提示，提醒结合运行诊断或 WebUI 核对事件收发情况。

## N-API 原生挂接机制

Windows QQ NT 启用 Electron Fuses 禁用调试参数后，仍通过 `QQNT.dll` 导出的 `qq_magic_napi_register` 与 Node N-API 函数向原生插件 `wrapper.node` 注册与暴露核心业务对象。

OpenQQ 启动链路如下：

1. **标准输入传参**：Node 主进程创建命名管道（`src/ipc.mjs`）及一次性随机会话令牌，通过标准输入（`--config-stdin`）将 `{ pipe, token, wrapper, payload }` 传给 `native/launch.py`，不把凭据写入进程命令行参数。
2. **加载前拦截**：`native/launch.py` 使用 Frida 以挂起或子进程附加方式拉起 `QQ.exe`，在目标加载 `QQNT.dll` 与 `wrapper.node` 时注入 `native/agent.js`（并在捕获目标模块后立即移除模块加载监听器）。
3. **无调试端口会话接入**：`native/agent.js` 在 `qq_magic_napi_register` 与核心 N-API 函数处接入模块导出对象创建流程，将 `native/session.cjs`、`native/events.cjs` 和 `native/actions.cjs` 绑定到 QQ 原生服务对象（`msg`、`buddy`、`group`、`getUixConvertService` 等）的调用与事件回调中。
4. **结构化事件桥接**：原生侧将回调事件序列化为内部消息后通过命名管道发送给 Node 主进程，再由 `src/onebot.mjs` 统一校验、映射消息 ID 并按 OneBot v11 协议格式分发至终端、WebUI 和 WebSocket 连接。

## 环境自动探测逻辑

`src/env.mjs` 提供跨环境自动查找能力：

- **QQ NT 查找**：依次检查环境变量 `OPENQQ_QQ_ROOT`、Windows 注册表卸载与安装键（`HKLM/HKCU` 下的 Tencent QQNT / `Uninstall\QQ`）及常见安装盘符目录，筛选存在有效可执行文件且通过结构检查的安装位置。
- **Python 与 Frida 查找**：依次检查指定路径、`OPENQQ_PYTHON`、项目本地 `.venv`/`venv`、`py -0p`、`where python` 及系统常规安装目录，跳过 Microsoft Store 应用别名占位符并执行导入探测，优先选择已安装 `frida >= 17.8` 的 64 位解释器，同时拒绝 UNC 路径与批处理/脚本外壳。
