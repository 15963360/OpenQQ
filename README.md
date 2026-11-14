# OpenQQ

[![CI](https://github.com/feijx3/OpenQQ/actions/workflows/ci.yml/badge.svg)](https://github.com/feijx3/OpenQQ/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

> [!WARNING]
> 本项目为非官方实现，与腾讯公司无任何关联。挂接 QQ 客户端可能违反《QQ 软件许可及服务协议》，并可能导致账号被限制或封禁。请仅在自己的账号与设备上用于学习研究，风险自负。

面向 Windows x64 QQ NT 的独立 OneBot v11 原生桥接实现。通过 C++ 启动器和自有 DLL 在 N-API 注册边界（`qq_magic_napi_register`）挂接会话，使用 Windows 调试 API，不开启 Electron `--inspect` 端口。原生组件使用系统 UCRT，不需要额外安装运行库；OneBot、WebUI 和会话业务继续由 Node.js / JavaScript 执行。

## 功能概览

- **OneBot v11 接入**：支持正向 WebSocket 服务端（Bearer Header 或 `access_token` 查询参数鉴权，带失败限流）和反向 WebSocket 客户端（断线指数退避重连，支持多目标与自定义心跳）。
- **环境自动探测**：自动扫描 Windows 注册表与常见路径定位 QQ NT 客户端目录，并检查已编译的 C++ 原生引导器。
- **PE64 原生兼容性检查**：启动前静态解析 `QQNT.dll` 与 `wrapper.node` 的 x64 PE 导出表与架构，验证所需 N-API 符号与 `qq_magic_napi_register` 存在。
- **WebUI 配置向导与控制台**：本地回环 WebUI（仅监听 `127.0.0.1`，随机生成临时访问密钥）提供图形化配置向导（`/setup`）与控制台：概览（会话、吞吐、连接健康）、按会话收发消息、事件流、OneBot 动作调试、运行日志，以及账号、连接和设置管理。
- **终端交互与 JSONL 输出**：交互式终端支持命令补全、历史记录与 `/verbose`、`/clear`、`/quit`；在管道或 `--json` 模式下输出标准 OneBot JSON Lines。

## 环境要求

- **操作系统**：Windows 10 / 11 x64
- **QQ 客户端**：Windows x64 QQ NT 9.x（已实机验证 `9.9.33-52230`，其他包含完整 N-API 导出的 9.x 构建可运行但会提示未经过完整实机验证）
- **Node.js**：`>= 22`
- **源码构建**：本机已有的 CMake、C++17 x64 编译器（LLVM-MinGW / MinGW 或 Visual Studio）；使用 MinGW 时还需 Ninja。发布包已包含原生组件，无需编译器。

当前 C++ 引导器已通过本地模拟宿主测试，并在 QQ `9.9.33-52230` 上验证启动、登录和同步完成；真实消息发送尚未验证。

## 快速开始

### 1. 安装依赖

```powershell
git clone https://github.com/feijx3/OpenQQ.git
cd OpenQQ
npm install

npm run build
```

### 2. 检查本机环境

```powershell
npm run doctor
```

该命令以只读 JSON 格式输出当前探测到的 QQ NT 目录、版本、原生导出兼容状态、原生引导器状态，以及 QQ 进程是否在运行。也可通过环境变量覆盖默认搜索路径：

```powershell
$env:OPENQQ_QQ_ROOT = "D:\Programs\QQNT"
npm run doctor
```

### 3. 初始化配置并启动

如果工作区尚未生成 `config/openqq.json`（也可从 `config/openqq.example.json` 复制修改）：

- **浏览器图形向导**（首次运行 `npm start` 会自动进入，或随时执行 `npm run webui`）：

```powershell
npm start
```

终端会输出一次性的本机访问地址（`http://127.0.0.1:17860/setup#token=...`），在向导中确认 QQ 目录、OneBot 正/反向 WebSocket 配置及密钥即可保存并拉起 QQ。

- **命令行交互初始化**：

```powershell
npm run init
```

- **命令行参数覆盖启动**：

```powershell
npm start -- --qq-root "C:\Program Files\Tencent\QQNT"
```

启动前请先**完全退出正在运行的 QQ 进程**，再由 OpenQQ 拉起 QQ 并在 QQ 窗口中正常登录。当终端与控制台显示「QQ 会话就绪」后，即可接入机器人框架。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run doctor` | 检查本机 QQ NT、C++ 原生引导器与路径兼容性 |
| `npm run init` | 在终端交互生成 `config/openqq.json` |
| `npm run webui` | 仅启动 Web 配置向导与预览模式 |
| `npm start` | 启动 OpenQQ、WebUI、OneBot WS 并挂接 QQ |
| `npm run bot` | 运行内置 OneBot 机器人示例（需配置 `ONEBOT_TOKEN`） |
| `npm run build` | 编译 C++ 原生组件并打包 WebUI（`start`、`webui`、`test` 会自动执行） |
| `npm run build:native` | 使用本机工具链编译原生启动器、DLL 和模拟宿主 |
| `npm run test:native` | 编译并验证原生挂接链路 |
| `npm test` | 运行 Node.js 单元测试与集成测试 |

## 目录结构

| 路径 | 内容 |
| --- | --- |
| `src/` | Node 主进程：配置、环境探测、OneBot 网络层、终端与 WebUI 服务 |
| `native/` | C++ 启动器与自有 DLL，以及 QQ 内的 JavaScript 会话、事件与动作处理 |
| `ui/` | WebUI 源码（React + TypeScript、Tailwind CSS、Radix UI），构建产物输出到 `web/` |
| `web/` | WebUI 静态入口页面与构建产物 |
| `config/` | 配置示例；本地 `openqq.json` 不纳入版本控制 |
| `docs/` | 接入、动作、事件与原生挂接文档 |
| `examples/` | OneBot 机器人示例 |
| `test/` | Node 测试与原生模拟宿主 |

## 安全设计说明

- **管理界面隔离**：WebUI 仅绑定 `127.0.0.1`，通过 `timingSafeEqual` 校验随机生成的会话 Bearer Token，页面加载后立即通过 `history.replaceState` 清除 URL Fragment 中的密钥，仅存放在当前标签页的 `sessionStorage`。
- **IPC 凭据不进命令行**：`native/bin/openqq-launch.exe` 从标准输入接收路径和会话脚本（含命名管道与一次性令牌），避免进程命令行参数泄露敏感凭据。
- **可执行文件与路径约束**：配置文件拒绝 UNC 路径和控制字符；原生启动器固定从项目内加载，通过文件句柄校验并规范化客户端、wrapper 与 DLL 路径。
- **鉴权防爆破**：OneBot WebSocket 服务端与本地配置校验限制单 IP 连续鉴权失败次数（60 秒超过 20 次触发 429 限制），禁止协议相对 URL 转发与不安全跳转。

## 测试与原生验证

运行完整测试套件（包括编译原生组件）：

```powershell
npm test
```

`npm test` 包含本地模拟宿主验证，覆盖原生启动器与 DLL 的挂接链路，不启动已安装的 QQ。也可单独运行：

```powershell
npm run test:native
```

## 文档

- [机器人接入与示例配置](docs/connect.md)
- [支持的 OneBot 动作与终端交互](docs/actions.md)
- [事件格式、扩展字段与已知限制](docs/events.md)
- [原生挂接原理与客户端兼容性检查](docs/local-client.md)

## 参与贡献

欢迎提交 Issue 与 Pull Request，提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

本项目以 [GNU Affero General Public License v3.0 或更高版本](LICENSE) 发布。基于本项目修改并通过网络提供服务时，须向用户提供对应源代码。

## 协议与技术参考

- [OneBot v11 协议规范](https://github.com/botuniverse/onebot-11)
- [Node-API (N-API) 头文件声明](https://github.com/nodejs/node/blob/v22.16.0/src/node_api.h)
