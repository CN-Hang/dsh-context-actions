# dsh-context-actions

[![CI](https://github.com/CN-Hang/dsh-context-actions/actions/workflows/ci.yml/badge.svg)](https://github.com/CN-Hang/dsh-context-actions/actions/workflows/ci.yml)
[![Release](https://github.com/CN-Hang/dsh-context-actions/actions/workflows/release.yml/badge.svg)](https://github.com/CN-Hang/dsh-context-actions/actions/workflows/release.yml)

> **非官方开源插件，与 DeepSeek 官方无关。** MIT License。

给 DeepSeek Harness（`dsh`）Web GUI 的「上下文已用」面板加两个按钮。

| 按钮 | 行为 |
| --- | --- |
| **压缩** | 对当前会话执行宿主命令 `/compact`，就地压缩上下文；执行前先探测该会话的 agent 预设是否挂载了压缩后端，没有就给出可操作的提示 |
| **交接** | 把当前会话的持久日志生成一份交接文档写到系统临时目录（`%TEMP%\dsh-handover\`）。默认「脚本节选」零模型调用、不消耗 token；可在设置页切换为「模型总结」（按所选模型计费），然后新建一个会话并把文档路径发过去让它接着干 |

两个按钮都出现在上下文占用面板底部（点 composer 右侧的圆环弹出），并带一行状态反馈。

## 安装

要求：Node.js ≥ 18，已安装并可使用 `dsh`（在 `dsh 0.1.5-rc.1` 上验证；dsh 升级后若内部结构变化可能需要跟着调整）。

从 npm（发布后）：

```powershell
dsh plugin --profile web add dsh-context-actions
```

从源码 / 本地目录（把 `<仓库绝对路径>` 换成实际路径，Windows 用正斜杠最稳）：

```powershell
dsh plugin --profile web add file:<仓库绝对路径>
```

官方 `dsh plugin add` 会自动把依赖写进 profile 的 `dependencies`、同步 `dsh.profile.bundles`，并发现包里的 `dsh.bundle.patch`。

安装后：

- 宿主半侧（`/handover` 命令）需要 **重启 dsh** 才生效；
- 浏览器半侧（按钮）**刷新页面**即可（Ctrl/Cmd+R）。

验证装配：

```powershell
dsh --profile web --dump-config | Select-String context-actions -Context 1,1
```

期望看到：

```yaml
# == dsh-context-actions
- id: context-actions
  name: dsh-context-actions
```

## 使用

1. 打开任意会话，点 composer 右侧的上下文圆环，面板底部就是「压缩 / 交接」。
2. **压缩**：会话的 agent 预设挂载了 `dsh-compaction-basic` + `dsh-command-compact` 时才可用（`standard` / `ptc` / `cordis` 预设都带；`minimal` 预设刻意不带）。结果文本会显示在按钮下方状态行里。
3. **交接**：
   - 交接文档写入 `<系统临时目录>\dsh-handover\handover-<会话短id>-<时间戳>.md`；
   - 文档内容 = 该会话持久日志的派生历史（元信息表 + 按时间排序的对话与工具记录 + 涉及的文件 + 执行过的命令 + 接手指引），超出体积预算时省略最早的部分；
   - 随后插件新建一个会话（沿用原会话所属的 Workspace、当前工作目录与模型选择），切换过去，并发送首条消息让它先读交接文档：
     - `模型总结`：文档里已经包含「待办与下一步」的计划，新会话读完文档后按计划继续推进；
     - `脚本节选`：新会话读完文档后会先问你选哪种方式确定接下来的计划——① 由它根据文档生成一份「下一步计划」给你确认（只输出计划，不改文件、不执行），② 由你手动输入计划；你确认后才开始执行。

命令行也能直接用：

```
/handover                          生成交接文档并返回路径
/handover --where                  返回交接目录（不存在则创建）
/handover --write <绝对路径>        在指定路径生成交接文档（路径必须在交接目录内）
```

## 在「设置 → 插件」里改（推荐）

插件在宿主注册了 settings namespace `dsh-context-actions`，并在浏览器注册了同名卡片，所以在 **设置 → 插件 → 插件配置** 里会出现一张「上下文动作（压缩 / 交接）」卡片：

- 卡片里的字段**跟着生成方式显示**：`脚本节选`（默认）时只有「交接文档生成方式」一项；选成 `模型总结` 后，才出现 总结模型 provider、总结模型 model id、**自定义提示词**（整段可编辑的文本框）；
- **自定义提示词默认就显示内置那份**（不再是空白框）：直接在上面改，改完即保存；点「恢复全部默认」又回到内置文本；
- provider / model 是**下拉框**，候选来自本部署**已配置的模型目录**（`session/modelCatalog`）：provider 列出所有已配置的 provider（含当前不可用的），选中后 model 才解锁并列出该 provider 的模型；两栏的第一项都是「跟随会话（不固定）」；
- 目录读不到时会**自动退回手动输入**（不会卡住）；已保存但不在目录里的路由显示成「…（已保存但当前不可用）」，不会被清掉；
- 每项保存即写入用户设置（`settings.yaml` 的 `dsh-context-actions:` 段），**无需重启**：命令每次执行都会重新读取当前值；
- 被用户改过的字段会标「已覆盖」；底部「恢复全部默认」**一键清空本插件的全部用户设置**（回到组合层/内置默认），没有覆盖时该按钮是灰的；
- 卡片标题/描述/字段文案随语言（中/英）切换。

命令行方式（不改文件、只影响一次调用）：`/handover --llm`、`/handover --mechanical`。

配置的优先级：**用户设置（设置页）> loader 行的 config（base）> 内置默认值**。所以下面的 YAML 写法仍然有效，只是会被设置页覆盖。

其余策略是固定的（刻意不放进卡片）：单次总结超时 180s、输出长度不设上限（由提示词要求简洁）、总结失败自动回退脚本节选并在文档顶部注明、摘要后附一份脚本节选纪要。
## 生成方式：脚本节选 / 模型总结

默认沿用脚本节选（零模型调用）。想固化成**部署默认值**（设置页的 base）时，在 profile 的 `cordis.patch.yml` 里给这一行加 config：

```yaml
- id: context-actions
  config:
    handover:
      mode: llm          # mechanical（默认）| llm
      provider: ''       # 可选：总结用模型；留空 = 跟随该会话最近一次请求的路由（设置页里是下拉选择）
      model: ''
      prompt: ''         # 可选：整段替换发给模型的提示词；留空 = 内置默认（默认已要求简洁、1-2 页，并包含下一步计划）
```

> 插件不再限制模型输出 token；输出长度由提示词控制。默认提示词要求文档控制在 1-2 页，并在「待办与下一步」里给出 1-3 条可执行的计划。

模型总结（`mode: llm`）怎么工作：

- **整段上下文一次发过去**：把该会话的派生历史（用户需求、助手回复、工具调用与结果）整段渲染成文本，**不做单条截断**，加上会话元信息后一次请求发给模型；
- 只有总量超过「该会话模型上下文窗口 − 固定输出预留（8192 tokens）− 1024 tokens 余量」时，才从**最早**的记录开始省略（必要时再截断最早那一条），并在文档表格里写明「省略最早 N 条」；上下文窗口取自该会话最近一次请求的 `request/context`，拿不到时按 128k 估；
- 提示词可在设置页整段替换（`prompt`）；**默认值就是内置那份**，所以框里直接能看到、直接改。内置默认要求输出固定结构：标题「交接文档：<一句话任务名>」，二级小节为 任务目标 / 当前状态 / 关键决策与约定 / 涉及的文件与命令 / 待办与下一步（1-3 条可执行的下一步计划）/ 风险与未解决的问题 / 接手建议，并附带硬性规则（只写事实、原样保留路径命令与错误原文、压缩摘要里的既有事实要带上、长工具输出只取结论、1-2 页、不写开场白）；
- 文档结构：元信息表（含生成方式、总结模型、喂了多少字符、输入/输出 token、耗时）+ `## 交接摘要（模型生成）` + `## 附：对话纪要（脚本节选）` + 文件/命令清单 + 接手指引；
- 失败（无路由、无适配器、超时、限流、空输出等）自动回退脚本节选，并在文档顶部注明原因；
- 成本：一次总结按所选模型计费，输入规模就是上面的「整段上下文」（超大窗口模型下通常几万到几十万 token）；想省钱就给该会话选小模型，或把提示词改得更短、更严格。输出长度不再由插件设上限，由提示词与提供方共同决定。
## 关于「压缩」按钮和 agent 预设

Web 部署故意把压缩后端交给 **agent 预设**：`minimal` 预设的注释写着 "Context compaction is absent."，所以用它创建的会话里 `/compact` 根本不存在（命令目录里没有它）。此时「压缩」按钮不会瞎执行，而是提示：

> 当前 agent 预设未挂载压缩后端（/compact）

想让它在 `minimal` 会话里也能用，二选一：

1. **换预设**：新建会话时选 `standard`（或 `ptc` / `cordis`）预设；
2. **把两行开回宿主面**：在 `$DSH_HOME/profiles/web/cordis.patch.yml` 里加（本插件的补丁层之后应用，会覆盖 `dsh-web-app` 的 `disabled: true`）：

```yaml
- id: compaction-basic
  disabled: false
- id: command-compact
  disabled: false
```

注意：`compaction-basic` 的 `auto` 默认是 `true`，所以第 2 种做法会给 **所有** 会话（含 `minimal`）打开自动压缩，这是官方架构里刻意放在预设面的行为，请自行权衡；只想要手动 `/compact` 可以再补 `config: { auto: false }`。

## 实现要点

- **宿主半侧** `lib/index.js`：Cordis 插件（`inject: ['commands', 'sessions']`），注册 `/handover` 命令。文档内容来自 `ctx.sessions.get(agent.id).deriveMessages()`，即该会话持久日志的派生历史，因此不额外请求模型；写入前校验目标路径必须落在自己的临时目录内。顺带尽力解析 `<DSH_HOME>/sessions/**/<sessionId>/session.*.jsonl*` 原始日志路径写进文档。
- **浏览器半侧** `lib/client.js`：`window.__ModuleLoader__.load({ id, factory })` 形式的客户端 bundle。`apply(ctx)` 里用 `ctx.inject(['sessions', 'remote', 'remote.commands', 'remote.session'], ...)` 等必需服务（缺服务只会让这个 fiber 挂起，不会拖垮 Web 启动），然后：
  - `MutationObserver` 监听 DOM，用 `button[aria-haspopup="dialog"]` 且 `aria-label` 含百分号的触发器定位上下文面板，把按钮容器插到面板末尾（面板由 `dsh-client-ui-conversation` 内部渲染，没有对外 slot，因此走 DOM 注入）；
  - 交接流程：`remote.commands.execute(id, '/handover --where')` 取目录，拼文件名，`--write` 写入，`sessions.create({ cwd })` 建会话，`sessions.open(newId)` 切过去，`beginSubmission() + prompt()` 发送首条消息；
  - 新会话尽力沿用当前会话的模型（`projectionValues.modelSelection` 转 `remote.session.selectModel`）。

## 源码结构

```
<仓库根目录>\
  package.json        # dsh.bundle.patch + dsh.client(platform: web) + exports["./client"]
  cordis.patch.yml    # 向 profile 树 insert 一行：id: context-actions
  lib\index.js        # 宿主半侧：/handover 命令 + 交接文档生成
  lib\client.js       # 浏览器半侧：面板按钮注入 + 两个动作
  README.md           # 使用与开发文档
  CHANGELOG.md        # 版本记录
  LICENSE             # MIT
  test\               # node:test 单元测试（宿主 + 浏览器半侧）
  .github\workflows\  # CI / Release
```

改动后同步到 profile（`dsh plugin add` 用的是硬链接副本，改同样的文件路径即可就地生效；新增文件需要重跑一次）：

```powershell
dsh plugin --profile web add file:<仓库绝对路径>
```

## 排查

| 现象 | 处理 |
| --- | --- |
| 面板里没有按钮 | 刷新页面；确认 `dsh --profile web --dump-config` 里有 `context-actions` 行；看浏览器控制台里 `[dsh-context-actions]` 前缀的告警 |
| 交接报「宿主未注册 /handover 命令」 | 宿主半侧没加载，重启 dsh |
| 交接报「拒绝写入」 | 目标路径不在 `<系统临时目录>\dsh-handover` 内 |
| 压缩报「当前 agent 预设未挂载压缩后端」 | 见上一节 |
| 新建会话的首条消息没送达 | 状态行停在「已新建会话，但首条消息未送达」，会话已建好，手动把文档路径发过去即可 |

## 已知取舍

- 上下文面板是包内实现：选择器基于 `aria-haspopup=dialog` 加 `aria-label` 含 `%` 加 `role=dialog`，dsh 后续版本若改结构，需要同步调整 `lib/client.js` 里的 `findPanel()`。
- 交接文档默认是 **机械摘要**（日志的忠实节选）：零 token、零延迟、内容可信；代价是没有「人话总结」。
  开 `handover.mode: llm` 后正文改为模型总结（模型看不到你没想到要喂给它的东西，仍受截断与预算约束），附录依旧是脚本节选，便于核对。
- 「压缩」不做任何绕过预设的 hack，避免改掉部署的自动压缩行为。

## 开发与测试

```powershell
npm test          # Node 内置 node:test，零依赖
npm run check     # lib/index.js + lib/client.js 语法检查
npm run pack:dry  # 预览 npm 包内容
```

测试分两层：

- `test/index.test.js`：用假 ctx/session 驱动真实的 `/handover` 命令链（参数解析、配置回退、路径校验、机械折叠、llm 回退）。
- `test/client.test.js`：用假 `window`/React 桩加载浏览器 bundle，校验 bundle 契约与「脚本节选 / 模型总结」字段显隐。

CI：push / PR 触发 Node 18、20、22 矩阵；推送 `v*` 标签触发 Release workflow —— 生成 GitHub Release，配置 `NPM_TOKEN` secret 后会同时发布到 npm（带 provenance）。

## 开源许可

MIT License，全文见 [LICENSE](LICENSE)。

## 参与贡献

- 提交 Issue / PR 前先跑：`npm test`（18 个零依赖单元测试）与 `npm run check`。
- 改完源码后用 `dsh plugin --profile web add file:<仓库绝对路径>` 重新同步到 profile，再重启 dsh（宿主半侧）并刷新页面（浏览器半侧）验证。
- 打包预览：`npm pack --dry-run`；正式打包：`npm pack --pack-destination dist`，产物为 `dsh-context-actions-0.1.0.tgz`。
- 仓库地址：<https://github.com/CN-Hang/dsh-context-actions>；如果你 fork 后发布，请把 `package.json` 里的 `author`、`repository`、`homepage` 换成你自己的信息。
