# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-09-15

### Added

- 在「上下文已用」面板底部新增「压缩」「交接」两个按钮，并带状态反馈。
- `/handover`、`/handover --where`、`/handover --write <绝对路径>` 命令；文档默认写入 `<系统临时目录>/dsh-handover`。
- 两种生成方式：`脚本节选`（默认，零模型调用）与 `模型总结`（整段派生历史一次喂给模型）。
- 设置页卡片：生成方式、总结模型 provider / model（复用部署已配置的模型目录下拉）、自定义提示词、输出上限；字段跟随生成方式显示，支持一键恢复全部默认。
- 内置默认交接提示词（固定七段式交接文档结构）。
- 模型总结失败时自动回退脚本节选，并在文档中注明原因。
