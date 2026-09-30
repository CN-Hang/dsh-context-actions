# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-09-28

### Changed

- 适配 dsh 0.2（0.2.0-rc.x）的设置服务重构：宿主侧不再调用已移除的 `settings.register(ns, schema)`，改为在 loader 行导出带 `.volatile()` 字段的 `Config`，运行时通过引用直接读取（设置页保存后无需重启），并用 `settings.configure({ auto: false })` 关闭自动生成的表单。
- 浏览器侧配置页从已移除的 `settings.plugin.item` 卡片迁移到 0.2 的 `plugins.row.config` 行配置页（key = `dsh-context-actions#context-actions`），配合 `configForms` 服务读写。
- 上下文面板探测适配 0.2 的 portal 浮层：在旧版 inline 定位之外，新增「锚定几何 + 面板结构」配对（面板贴齐 trigger、ContextMeter bar + ≥2 行 dt/dd），并保留对非上下文浮窗的排除。

### Fixed

- 补回重写时丢失的 `promptText` / `workspaceIdOf` / `PACKAGE_NAME` 定义（此前会导致交接按钮运行时抛 `ReferenceError`）。
- 声明缺失的 `@deepseek-ai/schemastery` 运行时依赖。
- 单元测试全部迁移到 0.2 契约（19 项全部通过）。

## [0.1.3] - 2026-09-15

### Fixed

- 交接新建的会话现在会带上原会话的 `workspaceId`，归入原来的 Workspace，不再掉进「未分组」。已存在的历史未分组会话不会自动迁移。

## [0.1.2] - 2026-09-15

### Added

- 模型总结的默认提示词明确要求「待办与下一步」给出 1-3 条可执行的计划。
- 脚本节选交接的新会话首条消息会先询问用户：① 由新会话生成「下一步计划」供确认（只输出计划、不改文件、不执行），② 由用户手动输入计划；用户确认后才开始执行。

### Changed

- 移除「输出上限」配置（`maxOutputTokens`）：模型总结不再由插件设置输出 token 上限，改为在提示词中要求简洁（目标 1-2 页）。
- 输入预算改为扣除固定输出预留（8192 tokens）与余量；设置页卡片字段从 5 项变为 4 项。

## [0.1.1] - 2026-09-15

### Fixed

- 「压缩 / 交接」按钮不再注入「会话统计 / 本轮用量 / 本轮用时 / tok 统计」等其它浮窗，只在上下文圆环（ContextMeter）面板中出现。

### Changed

- 「压缩 / 交接」按钮改为透明底 + 细边框 + `backdrop-filter` 毛玻璃样式，与上下文面板的原生圆角/层级保持一致。

## [0.1.0] - 2026-09-15

### Added

- 零依赖单元测试（Node 内置 `node:test`）：宿主命令链、参数/配置/路径校验、机械折叠与 llm 回退；浏览器半侧 bundle 契约与设置卡片字段显隐。
- GitHub Actions：CI（Node 18/20/22 矩阵：语法检查 + 单元测试 + 打包 dry-run）与 Release（`v*` 标签生成 GitHub Release；配置 `NPM_TOKEN` 后同步发布 npm）。
- 在「上下文已用」面板底部新增「压缩」「交接」两个按钮，并带状态反馈。
- `/handover`、`/handover --where`、`/handover --write <绝对路径>` 命令；文档默认写入 `<系统临时目录>/dsh-handover`。
- 两种生成方式：`脚本节选`（默认，零模型调用）与 `模型总结`（整段派生历史一次喂给模型）。
- 设置页卡片：生成方式、总结模型 provider / model（复用部署已配置的模型目录下拉）、自定义提示词、输出上限；字段跟随生成方式显示，支持一键恢复全部默认。
- 内置默认交接提示词（固定七段式交接文档结构）。
- 模型总结失败时自动回退脚本节选，并在文档中注明原因。
