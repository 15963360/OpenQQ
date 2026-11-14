# 参与贡献

感谢你愿意改进 OpenQQ。

## 开发环境

```powershell
npm install
npm test
```

- Node.js `>= 22`；原生挂接相关改动还需要本机 CMake、C++17 x64 编译器（MinGW 还需 Ninja）（见 [README](README.md)）。
- WebUI 源码在 `ui/`（React + TypeScript），`npm run build` 会打包到 `web/`；构建产物不纳入版本控制。修改后运行 `npm run typecheck`。

## 提交 Pull Request

1. 从 `main` 新建分支，一个 PR 只做一件事。
2. 修改行为时同步补充或更新 `test/` 下的测试，并确保 `npm test` 全部通过。
3. 涉及 OneBot 字段或动作的变化，同步更新 `docs/` 中对应文档。
4. 不要提交 `config/openqq.json`、日志、截图、QQ 号、UID、令牌或任何个人数据；测试数据请使用 `123456` 之类的示例值。

## 代码约定

- 遵循 `.editorconfig`：UTF-8、LF、两空格缩进。
- 面向用户的提示与日志使用中文；源码注释说明“为什么”，而不是复述代码。
- 原生事件无法完整解析时，优先降级上报并给出可诊断的错误，而不是静默丢弃。
