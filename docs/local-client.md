# 原生挂接原理与客户端兼容性

本文档说明 OpenQQ 如何在不依赖 Electron `--inspect` 端口、使用自有 C++ DLL 与 Windows 系统运行库的前提下，对 Windows x64 QQ NT 客户端进行环境校验与原生会话接入。

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

1. **标准输入传参**：Node 主进程创建命名管道（`src/ipc.mjs`）及一次性随机会话令牌，将 QQ、wrapper、自有 DLL 路径和脚本作为四行 UTF-8 数据传给 `native/bin/openqq-launch.exe`。脚本中的路径与令牌经过 JSON 转义，凭据不进入命令行或临时文件。
2. **加载前拦截**：`native/launch.cpp` 使用 `CreateProcessW(DEBUG_ONLY_THIS_PROCESS)` 拉起 QQ，在 DLL 加载事件中解析 `QQNT.dll` 的导出，并为各线程设置一次性的硬件执行断点。根据初始化回调所属模块的规范化文件路径，只选择配置指定的 wrapper。
3. **无调试端口会话接入**：在 wrapper 初始化回调入口，启动器暂挂该线程，通过系统 `LoadLibraryW` 加载 `openqq-bootstrap.dll`，随后将回调入口转交 DLL。DLL 先调用原始初始化函数，再使用 QQ 自身的 N-API 执行 `native/session.cjs`；脚本绑定原生服务的调用与事件回调，导出对象通过 escapable handle scope 安全返回。原始初始化异常保留，桥接脚本新增的异常会清理并上报。
4. **脱离与清理**：启动器清除硬件断点并脱离调试。超时、取消和初始化失败也执行清理并恢复暂挂线程。自有 DLL 与少量配置内存保留到 QQ 退出；无需持续运行调试器。
5. **结构化事件桥接**：原生侧将回调事件序列化为内部消息后通过命名管道发送给 Node 主进程，再由 `src/onebot.mjs` 统一校验、映射消息 ID 并按 OneBot v11 协议格式分发至终端、WebUI 和 WebSocket 连接。

## 环境自动探测逻辑

`src/env.mjs` 提供跨环境自动查找能力：

- **QQ NT 查找**：依次检查环境变量 `OPENQQ_QQ_ROOT`、Windows 注册表卸载与安装键（`HKLM/HKCU` 下的 Tencent QQNT / `Uninstall\QQ`）及常见安装盘符目录，筛选存在有效可执行文件且通过结构检查的安装位置。
- **原生组件检查**：检查项目内的 `native/bin/openqq-launch.exe` 与 `openqq-bootstrap.dll`。源码构建使用本机已有的 CMake 和 C++17 x64 编译器；MinGW 静态链接编译器运行库，仅动态使用 Windows 系统库。未找到组件时提示运行 `npm run build:native`。
