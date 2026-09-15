/**
 * dsh-context-actions · 宿主半侧（Host half）
 *
 * 职责：把「交接文档」写进系统临时目录。
 * 浏览器半侧（lib/client.js）在上下文占用面板里新增两个按钮，并通过
 * 本模块注册的 /handover 命令与宿主通信：
 *
 *   /handover                        生成交接文档（自动命名），返回路径
 *   /handover --where                返回交接目录与当前生成方式（JSON）
 *   /handover --write <绝对路径>      在指定路径生成交接文档
 *   /handover --llm | --mechanical    本次调用强制指定生成方式
 *
 * 生成方式（config.handover.mode）：
 *   mechanical（默认）：把持久日志的派生历史按固定规则折叠成 Markdown，零模型调用。
 *   llm：先按同一规则生成「纪要材料」，再让模型把它总结成交接文档；
 *        摘要写入正文，纪要、文件/命令清单作为附录；失败可自动回退 mechanical。
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

/** Cordis 插件名；与 package.json 的包名保持一致。 */
export const name = 'dsh-context-actions'

/** 依赖的宿主服务：命令注册表 + 会话存储（读取当前会话日志）。 */
export const inject = ['commands', 'sessions']

/** 设置 namespace 名（与浏览器卡片 settings.plugin.item 的 key 必须一致）。 */
const SETTINGS_NAMESPACE = 'dsh-context-actions'

/** 交接文档目录：<系统临时目录>/dsh-handover。 */
const HANDOVER_DIR = path.join(tmpdir(), 'dsh-handover')

/** 单份交接文档的字符上限；超出预算时优先保留最近的内容。 */
const MAX_DOC_CHARS = 60000
/** mechanical 模式下单条消息正文 / 工具结果的截断上限。 */
const MESSAGE_TEXT_LIMIT = 1200
const TOOL_RESULT_LIMIT = 600
/** 「涉及的文件」「执行过的命令」两节的条目上限。 */
const FILE_LIST_LIMIT = 60
const COMMAND_LIST_LIMIT = 40

const USAGE =
  '用法：/handover [--llm|--mechanical] | /handover --where | /handover --write <绝对路径>'

/** 内置默认交接提示词；设置页里留空即用这份（也可以一键填入后再改）。 */
const DEFAULT_SUMMARY_PROMPT = [
  '你是资深工程助理。下面是一整段会话的完整记录：用户需求、助手回复、工具调用与结果，可能还包含较早的压缩摘要。',
  '请把它整理成一份交接文档，交给一个完全没有这段记忆的新会话，让对方读完就能接着干活。',
  '',
  '用 Markdown 输出，结构固定如下（没有内容的写「无」）：',
  '',
  '# 交接文档：<一句话任务名>',
  '',
  '## 任务目标',
  '- 用户要什么、验收标准是什么；引用用户原话里的关键措辞。',
  '- 边界与限制：明确不做的事、必须遵守的约束。',
  '',
  '## 当前状态',
  '- 已完成：做到哪一步、结果如何（含关键命令/测试的结论）。',
  '- 进行中：正在做什么、卡在哪、最后停在哪一步。',
  '',
  '## 关键决策与约定',
  '- 已经定下来的技术选型、命名、接口与目录约定，以及为什么这么定。',
  '- 用户纠正过的地方：原样保留关键措辞，避免新会话重犯。',
  '',
  '## 涉及的文件与命令',
  '- 关键文件/路径（精确到大小写）、各自作用、最近一次改动。',
  '- 复现与验证命令（原样保留），以及当前是否通过。',
  '- 依赖环境：服务地址、端口、环境变量、数据目录等。',
  '',
  '## 待办与下一步',
  '- 按优先级列出下一步该做什么，尽量写成可执行的小步骤。',
  '- 已知的坑与注意事项。',
  '',
  '## 风险与未解决的问题',
  '- 不确定、未验证、可能有副作用的地方。',
  '- 需要向用户确认的问题。',
  '',
  '## 接手建议',
  '- 新会话开头建议先做的 1-3 件事（例如先跑某个测试确认基线、先读某个文件）。',
  '',
  '硬性规则：',
  '- 只写记录里出现过的事实；不确定就写「未知」，禁止编造文件、接口、命令或结论。',
  '- 路径、命令、标识符、错误原文、版本号、数值、函数签名必须原样保留，不要改写、不要翻译。',
  '- 记录里的压缩摘要/检查点属于可信背景：仍然成立的事实要带上，已被后续推翻的不要带。',
  '- 长工具输出只取结论与关键片段，不要整段照抄。',
  '- 篇幅控制在 1-2 页，分点写，宁短勿虚。',
  '- 不要输出开场白、结语，也不要提到本次总结请求。',
  '- 使用记录主要使用的语言（记录以中文为主就用中文）。',
].join('\n')

/** 设置页卡片暴露的全部配置项；loader 行 config.handover 提供 base 默认值。 */
const DEFAULTS = {
  mode: 'mechanical',
  provider: '',
  model: '',
  // 默认值就是内置提示词：设置页的输入框会直接显示它，用户改了才成为用户层。
  prompt: DEFAULT_SUMMARY_PROMPT,
  maxOutputTokens: 2000,
}

/** 以下策略固定，刻意不做成配置项（保持卡片只有 5 个字段）。 */
const SUMMARY_TIMEOUT_MS = 180000
/** 解析不到模型上下文窗口时的兜底（tokens）。 */
const DEFAULT_CONTEXT_TOKENS = 131072
/** tokens → 字符的保守估算系数（按 CJK 偏保守取 1.5）。 */
const CHARS_PER_TOKEN = 1.5

/**
 * 注册 /handover 命令。
 * @param ctx - 宿主 Cordis 上下文。
 * @param rawConfig - loader 行配置（可含 handover 段）。
 */
export function apply(ctx, rawConfig) {
  // 组合层：loader 行 config.handover，就是「设置 → 插件」卡片里的默认值（base）。
  const composition = normalizeConfig(rawConfig)
  const runtime = { scope: undefined }

  // 运行时设置：宿主注册同名 namespace 后，浏览器卡片才能被派发；
  // 部署里没有 settings 提供方时这段不会跑，一切照组合配置。
  ctx.inject(['settings'], (settingsCtx) => {
    void (async () => {
      try {
        const schemastery = await import('@deepseek-ai/schemastery')
        const z = schemastery.default ?? schemastery
        runtime.scope = settingsCtx.settings.register(SETTINGS_NAMESPACE, handoverSchema(z), { base: composition })
        const resolved = resolveSettings(runtime, composition)
        console.log(
          '[dsh-context-actions] settings namespace registered: ' +
            SETTINGS_NAMESPACE +
            ' | handover.mode=' +
            resolved.mode +
            (resolved.provider === '' ? '' : ' | provider=' + resolved.provider + '/' + resolved.model),
        )
      } catch (error) {
        console.warn('[dsh-context-actions] settings namespace 注册失败，继续使用组合配置：' + describeError(error))
      }
    })()
  })

  ctx.commands.register({
    name: 'handover',
    description: '生成交接文档到临时目录，供新会话接续（脚本节选 / 模型总结，见 设置→插件）',
    handler: async ({ agent, rawInput, signal }) => {
      const parsed = parseArgs(typeof rawInput === 'string' ? rawInput.trim() : '')
      const settings = resolveSettings(runtime, composition)
      const mode = parsed.mode ?? settings.mode
      try {
        if (parsed.text === '--where') {
          await mkdir(HANDOVER_DIR, { recursive: true })
          return { kind: 'success', text: JSON.stringify({ dir: HANDOVER_DIR, mode }) }
        }

        const explicit = /^--write\s+([\s\S]+)$/.exec(parsed.text)
        let target
        if (explicit !== null) {
          target = path.resolve(stripQuotes(explicit[1].trim()))
          if (!isInside(HANDOVER_DIR, target)) {
            return { kind: 'error', text: '拒绝写入：交接文档必须位于 ' + HANDOVER_DIR + ' 之内。' }
          }
        } else if (parsed.text === '') {
          await mkdir(HANDOVER_DIR, { recursive: true })
          target = path.join(HANDOVER_DIR, autoFileName(agent.id))
        } else {
          return { kind: 'error', text: USAGE }
        }

        return { kind: 'success', text: await writeDocument(ctx, agent, target, { mode, settings, signal }) }
      } catch (error) {
        return { kind: 'error', text: '交接文档生成失败：' + describeError(error) }
      }
    },
  })
}

/* ------------------------------------------------------------------ *
 * 参数与配置
 * ------------------------------------------------------------------ */

/**
 * 取出 --llm / --mechanical 开关，返回剩余的命令行文本。
 * @param input - 命令名之后的原始输入（已 trim）。
 * @returns 本次调用的模式覆盖（可能为 undefined）与剩余文本。
 */
function parseArgs(input) {
  let mode
  let text = input
  if (/(?:^|\s)--llm(?=\s|$)/.test(text)) {
    mode = 'llm'
    text = text.replace(/(?:^|\s)--llm(?=\s|$)/, ' ').trim()
  }
  if (/(?:^|\s)--mechanical(?=\s|$)/.test(text)) {
    mode = 'mechanical'
    text = text.replace(/(?:^|\s)--mechanical(?=\s|$)/, ' ').trim()
  }
  return { mode, text }
}

/**
 * 归一化配置：只接受已知字段，非法值退回默认。
 * @param rawConfig - loader 传入的配置对象。
 * @returns 完整配置。
 */
function normalizeConfig(rawConfig) {
  const root = rawConfig !== null && typeof rawConfig === 'object' ? rawConfig : {}
  const input = root.handover !== null && typeof root.handover === 'object' ? root.handover : {}
  const string = (value, fallback) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback)
  const number = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback)
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
  const mode = string(input.mode, DEFAULTS.mode)
  return {
    mode: mode === 'llm' ? 'llm' : 'mechanical',
    provider: string(input.provider, DEFAULTS.provider),
    model: string(input.model, DEFAULTS.model),
    // 提示词按原文保留（含换行），只有全空白才算「没写」。
    prompt: typeof input.prompt === 'string' && input.prompt.trim() !== '' ? input.prompt : DEFAULTS.prompt,
    maxOutputTokens: number(input.maxOutputTokens, DEFAULTS.maxOutputTokens),
  }
}

/**
 * 设置 namespace 的 schema：与浏览器卡片字段一一对应。
 * 每个字段都有默认值，所以「未设置」等价于组合层默认。
 * @param z - schemastery 模块。
 * @returns namespace schema。
 */
function handoverSchema(z) {
  return z.object({
    mode: z.union(['mechanical', 'llm']).default('mechanical'),
    provider: z.string().default(''),
    model: z.string().default(''),
    prompt: z.string().default(DEFAULT_SUMMARY_PROMPT),
    maxOutputTokens: z.number().default(2000),

  })
}

/**
 * 读取当前生效配置：运行时设置（设置页保存的值）优先，读不到就退回组合配置。
 * 每次命令调用都读一次，所以设置页保存后无需重启。
 * @param runtime - 保存 settings scope 的容器。
 * @param fallback - 组合层配置。
 * @returns 归一化后的配置。
 */
function resolveSettings(runtime, fallback) {
  const scope = runtime === undefined ? undefined : runtime.scope
  if (scope === undefined || typeof scope.get !== 'function') return fallback
  try {
    const value = scope.get()
    if (value === null || typeof value !== 'object') return fallback
    return normalizeConfig({ handover: value })
  } catch (error) {
    console.warn('[dsh-context-actions] 读取设置失败，使用组合配置：' + describeError(error))
    return fallback
  }
}

/** 自动文件名：handover-<会话短id>-<YYYYMMDD-HHmmss>.md。 */
function autoFileName(sessionId) {
  return 'handover-' + shortId(sessionId) + '-' + stamp(new Date()) + '.md'
}

/* ------------------------------------------------------------------ *
 * 文档生成
 * ------------------------------------------------------------------ */

/**
 * 生成并落盘一份交接文档。
 * @param ctx - 宿主 Cordis 上下文。
 * @param agent - 触发命令的 agent（其 id 即会话 id）。
 * @param target - 目标绝对路径。
 * @param plan - 模式、配置与调用方取消信号。
 * @returns 面向用户的结果说明。
 */
async function writeDocument(ctx, agent, target, plan) {
  const built = await buildDocument(ctx, agent, plan)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, built.markdown, 'utf8')
  const parts = [
    '交接文档已生成（' + describeGeneration(built) + '）：' + target,
    '\n（来源会话 ' +
      agent.id +
      '，' +
      built.stats.messages +
      ' 条消息 / ' +
      built.stats.toolCalls +
      ' 次工具调用 / ' +
      built.stats.chars +
      ' 字符',
  ]
  if (built.summary !== undefined) {
    parts.push(
      '，总结模型 ' +
        built.summary.route +
        '，喂入 ' +
        built.stats.fedChars +
        ' 字符' +
        (built.stats.omittedBlocks > 0 ? '（省略最早 ' + built.stats.omittedBlocks + ' 条）' : '（完整上下文）') +
        '，输入 ' +
        tokenText(built.summary.usage, 'inputTokens') +
        ' / 输出 ' +
        tokenText(built.summary.usage, 'outputTokens') +
        ' tokens，耗时 ' +
        Math.round(built.summary.ms / 1000) +
        's',
    )
  }
  if (built.warning !== undefined) parts.push('；模型总结失败，已回退脚本节选：' + built.warning)
  parts.push('）')
  return parts.join('')
}

/** 生成方式的人话描述。 */
function describeGeneration(built) {
  if (built.summary !== undefined) return built.summary.truncated ? '模型总结，输出被 maxTokens 截断' : '模型总结'
  if (built.mode === 'llm') return '脚本节选（模型总结回退）'
  return '脚本节选'
}

/**
 * 构建交接文档：机械折叠 + 可选的模型总结。
 * @param ctx - 宿主 Cordis 上下文。
 * @param agent - 触发命令的 agent。
 * @param plan - 模式、配置与取消信号。
 * @returns Markdown 正文、统计、总结结果与回退告警。
 */
async function buildDocument(ctx, agent, plan) {
  const session = ctx.sessions.get(agent.id)
  const messages = session === undefined ? [] : session.deriveMessages()
  const gathered = collect(messages)
  const files = [...gathered.fileHits.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, FILE_LIST_LIMIT)
  const commands = dedupe(gathered.commands).slice(-COMMAND_LIST_LIMIT)
  const header = session === undefined ? undefined : session.header
  const route = session === undefined ? undefined : session.requestContext()
  const meta = {
    sessionId: agent.id,
    messageCount: messages.length,
    cwd: header === undefined ? undefined : header.cwd,
    preset: header === undefined ? undefined : header.agentPreset,
    createdAt: header === undefined ? undefined : header.createdAt,
    model: route === undefined ? undefined : route.provider + '/' + route.model,
    logPath: await findSessionLog(agent.id),
  }

  let summary
  let warning
  let fed
  if (plan.mode === 'llm') {
    try {
      fed = buildTranscript(meta, messages, resolveInputBudget(session, plan.settings))
      summary = await summarize(ctx, agent, session, fed.text, plan.settings, plan.signal)
    } catch (error) {
      warning = describeError(error)
      console.warn('[dsh-context-actions] 模型总结失败，回退脚本节选：' + warning)
    }
  }

  const markdown = render(meta, gathered, files, commands, new Date(), {
    mode: plan.mode,
    summary,
    warning,
    fed,
    includeDigest: true,
  })
  return {
    mode: plan.mode,
    markdown,
    summary,
    warning,
    fed,
    stats: {
      messages: messages.length,
      toolCalls: gathered.toolCalls,
      chars: markdown.length,
      fedChars: fed === undefined ? 0 : fed.chars,
      omittedBlocks: fed === undefined ? 0 : fed.omitted,
    },
  }
}

/**
 * 构建喂给模型的「纪要材料」：会话元信息 + 从最近端截断的对话纪要。
 * @param meta - 会话元信息。
 * @param messages - 派生历史。
 * @param settings - 归一化配置。
 * @returns 纯文本材料。
 */
/**
 * 计算喂给模型的字符预算：用该会话最近一次请求的上下文窗口，扣掉输出上限与余量后换算字符（保守估算）。
 * @param session - 当前会话（可能为 undefined）。
 * @param settings - 归一化配置。
 * @returns 字符预算。
 */
function resolveInputBudget(session, settings) {
  const context = session === undefined ? undefined : session.requestContext()
  const window =
    context !== undefined && typeof context.contextWindow === 'number' && context.contextWindow > 0
      ? context.contextWindow
      : DEFAULT_CONTEXT_TOKENS
  const usableTokens = Math.max(2048, window - settings.maxOutputTokens - 1024)
  // 下限只防「预算算成 0」；小窗口时宁可多裁，也不要发出超窗请求。
  return Math.max(2000, Math.floor(usableTokens * CHARS_PER_TOKEN))
}

/**
 * 把整段会话记录渲染成喂给模型的纯文本：单条不做截断；
 * 只有总量超过预算时，才从最早的记录开始丢，必要时再截断最早的一条。
 * @param meta - 会话元信息。
 * @param messages - 派生历史（整段）。
 * @param budgetChars - 字符预算。
 * @returns 文本、字符数、省略条数与是否发生过截断。
 */
function buildTranscript(meta, messages, budgetChars) {
  const gathered = collect(messages, {
    messageText: Number.MAX_SAFE_INTEGER,
    toolResult: Number.MAX_SAFE_INTEGER,
  })
  const head = [
    '会话元信息：',
    '- 会话 id：' + meta.sessionId,
    '- 工作目录：' + (typeof meta.cwd === 'string' ? meta.cwd : '未知'),
    '- 模型路由：' + (typeof meta.model === 'string' ? meta.model : '未知'),
    '- Agent 预设：' + (typeof meta.preset === 'string' ? meta.preset : '未知'),
    '- 派生消息数：' + meta.messageCount + '，用户轮次：' + gathered.userTurns + '，工具调用：' + gathered.toolCalls,
    '',
  ].join('\n')

  const budget = budgetChars - head.length
  const kept = []
  let used = 0
  let omitted = 0
  let truncated = false
  for (let index = gathered.blocks.length - 1; index >= 0; index -= 1) {
    const block = gathered.blocks[index]
    const text = '### ' + block.title + '\n\n' + block.body + '\n\n'
    const remaining = budget - used
    if (remaining <= 400) {
      omitted = index + 1
      break
    }
    if (text.length > remaining) {
      kept.push('### ' + block.title + '\n\n' + cut(block.body, Math.max(200, remaining - 40)) + '\n\n')
      used = budget
      omitted = index
      truncated = true
      break
    }
    used += text.length
    kept.push(text)
  }
  kept.reverse()

  const parts = [head]
  if (omitted > 0) {
    parts.push('（已省略最早的 ' + omitted + ' 条记录' + (truncated ? '，并截断了紧随其后的一条' : '') + '：超出本次模型的输入预算）\n')
  }
  parts.push(kept.length === 0 ? '（本会话还没有可总结的对话记录）' : kept.join(''))
  const text = parts.join('\n')
  return { text: text, chars: text.length, omitted: omitted, truncated: truncated }
}

/**
 * 调用模型把纪要材料总结成交接文档正文。
 * @param ctx - 宿主 Cordis 上下文。
 * @param agent - 触发命令的 agent（提供会话 id 供路由/计量）。
 * @param session - 当前会话（提供最近使用的模型路由）。
 * @param material - 纪要材料。
 * @param settings - 归一化配置。
 * @param signal - 调用方取消信号（命令 RPC 的 signal）。
 * @returns 摘要文本、路由、用量、耗时与截断标记。
 */
async function summarize(ctx, agent, session, material, settings, signal) {
  const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
  if (llm === undefined || typeof llm.stream !== 'function') {
    throw new Error('宿主没有可用的 llm 服务，无法做模型总结')
  }
  const target = resolveRoute(session, settings)
  if (target === undefined) {
    throw new Error(
      '无法确定总结用的模型路由：请先在该会话发一次消息，或在插件配置里设置 handover.provider 与 handover.model',
    )
  }
  const module = await loadLlmModule()

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error('模型总结超时（' + SUMMARY_TIMEOUT_MS + 'ms）')),
    SUMMARY_TIMEOUT_MS,
  )
  const forward = () => controller.abort(signal === undefined ? undefined : signal.reason)
  if (signal !== undefined) {
    if (signal.aborted) forward()
    else signal.addEventListener('abort', forward)
  }

  const started = Date.now()
  try {
    const assembler = new module.BlockAssembler()
    const question = module.createUserMessage({
      content: [{ type: 'text', text: '以下是这次会话的完整记录：\n\n' + material }],
      source: { kind: 'plugin', plugin: 'dsh-context-actions' },
    })
    const options = {
      provider: target.provider,
      model: target.model,
      system: settings.prompt.trim() === '' ? DEFAULT_SUMMARY_PROMPT : settings.prompt,
      messages: [question],
      maxTokens: settings.maxOutputTokens,
      sessionId: agent.id,
      signal: controller.signal,
    }
    if (typeof target.reasoningEffort === 'string' && target.reasoningEffort !== '') {
      options.reasoningEffort = target.reasoningEffort
    }

    for await (const chunk of llm.stream(options)) assembler.push(chunk)

    const finish = assembler.finish
    if (finish.kind === 'error') {
      throw new Error('模型调用失败：' + describeFailure(finish.failure))
    }
    if (finish.kind === 'aborted') {
      throw new Error('模型调用被取消：' + describeFailure(finish.failure))
    }
    const text = textOf(assembler.blocks()).trim()
    if (text === '') throw new Error('模型没有输出任何文本内容')

    console.log(
      '[dsh-context-actions] 模型总结完成：' +
        target.provider +
        '/' +
        target.model +
        '，耗时 ' +
        Math.round((Date.now() - started) / 1000) +
        's',
    )
    return {
      text,
      route: target.provider + '/' + target.model,
      usage: assembler.usage,
      ms: Date.now() - started,
      truncated: finish.kind === 'max-tokens',
    }
  } finally {
    clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener('abort', forward)
  }
}

/**
 * 解析总结用的模型路由：配置优先，其次会话最近一次请求的 header / context。
 * @param session - 当前会话（可能为 undefined）。
 * @param settings - 归一化配置。
 * @returns provider/model/reasoningEffort，或 undefined。
 */
function resolveRoute(session, settings) {
  // 推理档位沿用会话最近一次请求的设置（不再单独配置）。
  const effort = undefined
  if (settings.provider !== '' && settings.model !== '') {
    return { provider: settings.provider, model: settings.model, reasoningEffort: effort }
  }
  if (session !== undefined) {
    const header = session.requestHeader()
    const config = header === undefined ? undefined : header.config
    if (config !== undefined && typeof config.provider === 'string' && typeof config.model === 'string') {
      return {
        provider: config.provider,
        model: config.model,
        reasoningEffort: effort ?? (typeof config.reasoningEffort === 'string' ? config.reasoningEffort : undefined),
      }
    }
    const context = session.requestContext()
    if (context !== undefined) {
      return { provider: context.provider, model: context.model, reasoningEffort: effort }
    }
  }
  return undefined
}

/** 懒加载 dsh-llm：缺包时给出可读错误，而不是让整个插件加载失败。 */
async function loadLlmModule() {
  try {
    return await import('@deepseek-ai/dsh-llm')
  } catch (error) {
    throw new Error('无法加载 @deepseek-ai/dsh-llm（需要 dsh 自带的宿主 LLM 包）：' + describeError(error))
  }
}

/** 用量字段的可读文本。 */
function tokenText(usage, key) {
  if (usage === null || typeof usage !== 'object') return '?'
  const value = usage[key]
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '?'
}

/** 提供方失败对象的可读文本。 */
function describeFailure(failure) {
  if (failure === null || typeof failure !== 'object') return 'unknown'
  if (typeof failure.message === 'string' && failure.message !== '') return failure.message
  if (typeof failure.code === 'string' && failure.code !== '') return failure.code
  return 'unknown'
}

/* ------------------------------------------------------------------ *
 * 折叠规则
 * ------------------------------------------------------------------ */

/**
 * 把会话消息折叠成可读的段落、文件清单与命令清单。
 * @param messages - session.deriveMessages() 的模型历史。
 * @param limits - 可选的单条截断覆盖（LLM 模式用更大的限额）。
 * @returns 折叠结果。
 */
function collect(messages, limits) {
  const messageLimit =
    limits !== undefined && typeof limits.messageText === 'number' ? limits.messageText : MESSAGE_TEXT_LIMIT
  const toolLimit =
    limits !== undefined && typeof limits.toolResult === 'number' ? limits.toolResult : TOOL_RESULT_LIMIT

  const blocks = []
  const fileHits = new Map()
  const commands = []
  const callNames = new Map()
  let toolCalls = 0
  let userTurns = 0

  for (const message of messages) {
    const content = Array.isArray(message === null || message === void 0 ? void 0 : message.content)
      ? message.content
      : []
    const source = (message === null || message === void 0 ? void 0 : message.source) ?? {}

    if (message.role === 'system') continue

    if (message.role === 'assistant') {
      const lines = []
      const text = textOf(content)
      if (text !== '') lines.push(cut(collapse(text), messageLimit))
      for (const block of content) {
        if (block === null || typeof block !== 'object' || block.type !== 'tool-call') continue
        toolCalls += 1
        if (typeof block.id === 'string') callNames.set(block.id, block.name)
        const args = parseJson(block.arguments)
        for (const file of collectFiles(args)) {
          fileHits.set(file, (fileHits.get(file) ?? 0) + 1)
        }
        const command = collectCommand(block.name, args)
        if (command !== undefined) commands.push(command)
        lines.push('- 调用工具 `' + block.name + '`' + describeArgs(args))
      }
      if (lines.length > 0) blocks.push({ title: '助手', body: lines.join('\n') })
      continue
    }

    if (source.kind === 'tool') {
      const result = content.find((b) => b !== null && typeof b === 'object' && b.type === 'tool-result')
      const inner = result !== undefined && Array.isArray(result.content) ? result.content : content
      const name = result !== undefined ? callNames.get(result.toolCallId) : undefined
      const text = collapse(textOf(inner))
      if (text === '') continue
      blocks.push({
        title:
          '工具结果 · ' +
          (name ?? '未知工具') +
          (result !== undefined && result.isError === true ? '（失败）' : ''),
        body: cut(text, toolLimit),
      })
      continue
    }

    // 插件注入的上下文：可再生的样板（指令、目录、快照）跳过，压缩检查点必须保留。
    if (source.kind === 'plugin' && source.plugin !== 'compact') {
      if (source.form === 'instructions' || source.form === 'catalog' || source.form === 'snapshot') continue
    }

    const text = textOf(content)
    if (text === '') continue
    userTurns += 1
    const title =
      source.kind === 'plugin'
        ? source.plugin === 'compact'
          ? '压缩检查点（上一轮压缩后的摘要）'
          : '注入上下文 · ' + String(source.plugin ?? 'plugin')
        : '用户'
    blocks.push({ title, body: cut(collapse(text), messageLimit) })
  }

  return { blocks, fileHits, commands, toolCalls, userTurns }
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

/**
 * 渲染 Markdown 文档；超出预算时从最早的对话开始省略。
 * @param meta - 会话元信息。
 * @param gathered - collect() 的结果。
 * @param files - 已排序的文件清单。
 * @param commands - 已去重的命令清单。
 * @param now - 生成时间。
 * @param extra - 生成方式、模型总结、回退告警与是否附纪要。
 * @returns 完整 Markdown 正文。
 */
function render(meta, gathered, files, commands, now, extra) {
  const summary = extra === undefined ? undefined : extra.summary
  const warning = extra === undefined ? undefined : extra.warning
  const fed = extra === undefined ? undefined : extra.fed
  const mode = extra === undefined ? 'mechanical' : extra.mode
  const includeDigest = extra === undefined ? true : extra.includeDigest !== false

  const head = []
  head.push('# 会话交接文档')
  head.push('')
  head.push(
    summary !== undefined
      ? '> 由 `dsh-context-actions` 插件自动生成：正文为模型对会话纪要的总结，附录为脚本节选。'
      : '> 由 `dsh-context-actions` 插件自动生成：内容来自上一会话的持久事件日志，未调用模型。',
  )
  if (warning !== undefined) {
    head.push('>')
    head.push('> 注意：模型总结失败（' + warning + '），本文档为脚本节选。')
  }
  head.push('')
  head.push('| 项 | 值 |')
  head.push('| --- | --- |')
  head.push('| 来源会话 | `' + meta.sessionId + '` |')
  head.push('| 生成方式 | ' + describeGeneration({ mode, summary }) + ' |')
  head.push('| 工作目录 | ' + code(meta.cwd) + ' |')
  head.push('| 模型 | ' + code(meta.model) + ' |')
  head.push('| Agent 预设 | ' + code(meta.preset) + ' |')
  head.push('| 会话创建时间 | ' + code(meta.createdAt === undefined ? undefined : new Date(meta.createdAt).toISOString()) + ' |')
  head.push(
    '| 会话消息 / 用户轮次 / 工具调用 | ' +
      meta.messageCount +
      ' / ' +
      gathered.userTurns +
      ' / ' +
      gathered.toolCalls +
      ' |',
  )
  if (summary !== undefined) {
    head.push(
      '| 总结模型 / 用量 / 耗时 | ' +
        code(summary.route) +
        ' / 输入 ' +
        tokenText(summary.usage, 'inputTokens') +
        ' + 输出 ' +
        tokenText(summary.usage, 'outputTokens') +
        ' tokens / ' +
        Math.round(summary.ms / 1000) +
        's |',
    )
  }
  if (fed !== undefined) {
    head.push(
      '| 喂给模型 | ' +
        fed.chars +
        ' 字符' +
        (fed.omitted > 0 ? '（省略最早 ' + fed.omitted + ' 条记录）' : '（整段上下文）') +
        ' |',
    )
  }
  head.push('| 交接文档生成时间 | ' + new Date(now.getTime()).toISOString() + ' |')
  head.push('| 原始事件日志 | ' + code(meta.logPath) + ' |')
  head.push('')

  const tail = []
  tail.push('## 涉及的文件')
  tail.push('')
  if (files.length === 0) {
    tail.push('（本次会话没有记录到文件路径参数）')
  } else {
    for (const entry of files) tail.push('- `' + entry[0] + '` ×' + entry[1])
  }
  tail.push('')
  tail.push('## 执行过的命令')
  tail.push('')
  if (commands.length === 0) {
    tail.push('（本次会话没有记录到 shell 命令）')
  } else {
    for (const command of commands) tail.push('- `' + cut(command, 200) + '`')
  }
  tail.push('')
  tail.push('## 交给接手会话')
  tail.push('')
  tail.push('你正在接手上面这个会话。请：')
  tail.push('')
  if (summary !== undefined) {
    tail.push('1. 先通读上面的交接摘要；需要原始细节时，看附录纪要或按上表路径解压原始日志检索。')
  } else {
    tail.push('1. 先通读本文档；如需细节，可按上表路径解压原始日志检索。')
  }
  tail.push('2. 用 3-5 行复述你对当前任务状态的理解。')
  tail.push('3. 给出下一步计划，并直接继续推进工作。')
  tail.push('')

  const summarySection =
    summary === undefined ? '' : '## 交接摘要（模型生成）\n\n' + summary.text.trim() + '\n'
  const headText = head.join('\n')
  const tailText = tail.join('\n')
  let budget = MAX_DOC_CHARS - headText.length - tailText.length - summarySection.length
  if (budget < 1000) budget = 1000

  const kept = []
  let used = 0
  let omitted = 0
  for (let index = gathered.blocks.length - 1; index >= 0; index -= 1) {
    const block = gathered.blocks[index]
    const text = '### ' + block.title + '\n\n' + block.body + '\n\n'
    if (used + text.length > budget && kept.length > 0) {
      omitted = index + 1
      break
    }
    used += text.length
    kept.push(text)
  }
  kept.reverse()

  const body = []
  body.push(summarySection)
  if (includeDigest) {
    body.push(summary === undefined ? '## 对话记录（按时间顺序，越靠后越新）' : '## 附：对话纪要（脚本节选，按时间顺序）')
    body.push('')
    if (omitted > 0) {
      body.push('> 本文档已省略最早的 ' + omitted + ' 条记录（超出体积预算）；完整历史见原始事件日志。')
      body.push('')
    }
    if (kept.length === 0) {
      body.push('（本次会话还没有可交接的对话记录）')
      body.push('')
    } else {
      body.push(kept.join(''))
    }
  } else {
    body.push('')
  }

  return headText + '\n' + body.join('\n') + '\n' + tailText
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 取内容块里的纯文本。 */
function textOf(content) {
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

/** 压掉多余空白，便于阅读。 */
function collapse(text) {
  return String(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 截断长文本。 */
function cut(text, limit) {
  const value = String(text)
  return value.length <= limit ? value : value.slice(0, limit) + ' …（已截断）'
}

/** 容错解析工具参数 JSON。 */
function parseJson(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** 从工具参数里挑出文件/目录路径。 */
function collectFiles(args) {
  const found = new Set()
  const keys = [
    'file_path',
    'filePath',
    'path',
    'paths',
    'target_file',
    'targetFile',
    'notebook_path',
    'absolute_path',
    'abspath',
    'cwd',
    'dir',
    'directory',
    'root',
  ]
  if (args === null || typeof args !== 'object') return found
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') found.add(value.trim())
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === 'string' && item.trim() !== '') found.add(item.trim())
    }
  }
  return found
}

/** 从工具调用里挑出真正的 shell 命令。 */
function collectCommand(toolName, args) {
  if (typeof toolName !== 'string' || !/bash|pwsh|powershell|shell|terminal|exec/i.test(toolName)) return undefined
  if (args === null || typeof args !== 'object') return undefined
  const command = args.command ?? args.cmd ?? args.script
  return typeof command === 'string' && command.trim() !== '' ? collapse(command) : undefined
}

/** 给工具调用补一句参数摘要。 */
function describeArgs(args) {
  if (args === null || typeof args !== 'object') return ''
  const keys = collectFiles(args)
  const first = [...keys][0]
  const command = args.command ?? args.cmd ?? args.script
  if (typeof command === 'string' && command.trim() !== '') return '：`' + cut(collapse(command), 160) + '`'
  if (first !== undefined) return '：`' + first + '`'
  const pattern = args.pattern ?? args.query
  if (typeof pattern === 'string' && pattern.trim() !== '') return '：`' + cut(collapse(pattern), 120) + '`'
  return ''
}

/** 数组去重（保持原顺序）。 */
function dedupe(values) {
  return [...new Set(values)]
}

/** Markdown 行内代码；缺值时给出占位符。 */
function code(value) {
  return typeof value === 'string' && value !== '' ? '`' + value + '`' : '—'
}

/** 去掉用户输入两端可能带的引号。 */
function stripQuotes(value) {
  const match = /^(["'])([\s\S]*)\1$/.exec(value)
  return match === null ? value : match[2]
}

/** 判断 target 是否落在 dir 之内。 */
function isInside(dir, target) {
  const relative = path.relative(path.resolve(dir), path.resolve(target))
  if (relative === '') return true
  if (relative.startsWith('..')) return false
  return !path.isAbsolute(relative)
}

/** 会话 id 的短标识（取 UUID 前 8 位）。 */
function shortId(sessionId) {
  const match = /([0-9a-f]{8})-[0-9a-f]{4}-/i.exec(String(sessionId))
  return match === null ? String(sessionId).slice(-8) : match[1]
}

/** 文件名用时间戳：YYYYMMDD-HHmmss。 */
function stamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  )
}

/** 定位会话的持久化事件日志（尽力而为：找不到就返回 undefined）。 */
async function findSessionLog(sessionId) {
  try {
    const home = await resolveHome()
    const root = path.join(home, 'sessions')
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = path.join(root, entry.name, sessionId)
      let files
      try {
        files = await readdir(dir)
      } catch {
        continue
      }
      const hit = files.find(
        (file) => file.startsWith('session.') && (file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd')),
      )
      if (hit !== undefined) return path.join(dir, hit)
    }
  } catch {
    // 日志路径只是加分项，失败不影响交接。
  }
  return undefined
}

/** 解析 DSH home（优先官方 helper，其次 $DSH_HOME，最后 ~/.dsh）。 */
async function resolveHome() {
  try {
    const mod = await import('@deepseek-ai/dsh-home-paths')
    if (typeof mod.resolveDshHome === 'function') return mod.resolveDshHome()
  } catch {
    // 框架包不可用时退回环境变量。
  }
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  return path.join(homedir(), '.dsh')
}

/** 稳定的错误描述。 */
function describeError(error) {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}
