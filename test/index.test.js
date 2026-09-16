/**
 * dsh-context-actions 宿主半侧单元测试。
 *
 * 零外部依赖：只用 Node 内置的 node:test / node:assert / node:fs。
 * 思路：用假的 Cordis ctx + session 驱动真实的 apply() -> /handover handler，
 * 覆盖参数解析、配置归一化、路径校验、机械折叠与 llm 回退。
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 必须在 import 插件之前改环境：HANDOVER_DIR 在模块加载时由 os.tmpdir() 计算。
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-context-actions-test-'));
process.env.TEMP = sandbox;
process.env.TMP = sandbox;
process.env.TMPDIR = sandbox;
process.env.DSH_HOME = path.join(sandbox, 'dsh-home');
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });

const mod = await import('../lib/index.js');
const HANDOVER_DIR = path.join(sandbox, 'dsh-handover');
const SESSION_ID = 'session-abc12345-1111-2222-3333-444444444444';

after(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 与 dsh 派生历史形状一致的测试消息。 */
function fixtureMessages() {
  return [
    { role: 'system', content: [{ type: 'text', text: 'system prompt' }] },
    { role: 'user', content: [{ type: 'text', text: '帮我把「交接」按钮做出来' }], source: { kind: 'user' } },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: '好的，先跑测试。' },
        {
          type: 'tool-call',
          id: 'tc-1',
          name: 'pwsh',
          arguments: JSON.stringify({ command: 'npm test', cwd: 'C:/work' }),
        },
      ],
    },
    {
      role: 'tool',
      source: { kind: 'tool' },
      content: [{ type: 'tool-result', toolCallId: 'tc-1', content: [{ type: 'text', text: 'PASS 12 tests' }] }],
    },
    {
      role: 'user',
      content: [{ type: 'text', text: '这段注入指令不应出现在交接文档里' }],
      source: { kind: 'plugin', plugin: 'system', form: 'instructions' },
    },
    {
      role: 'user',
      content: [{ type: 'text', text: '压缩检查点：之前完成了 X' }],
      source: { kind: 'plugin', plugin: 'compact' },
    },
  ];
}

function makeSession(messages) {
  return {
    id: SESSION_ID,
    deriveMessages: () => messages ?? fixtureMessages(),
    header: { cwd: 'C:/work', agentPreset: 'minimal', createdAt: '2026-09-15T00:00:00.000Z' },
    requestContext: () => ({ provider: 'qiniu', model: 'deepseek-flash', contextWindow: 128000 }),
    requestHeader: () => ({ config: { provider: 'qiniu', model: 'deepseek-flash' } }),
  };
}

/** 记录 ctx.commands.register 的定义，返回可直接调用的 handler。 */
function makeHost(options = {}) {
  const session = options.session === undefined ? makeSession() : options.session;
  let definition;
  const ctx = {
    // 不触发 settings 注册：测试只使用 loader 行 config（组合层）。
    inject() {},
    commands: { register: (value) => { definition = value; } },
    sessions: { get: () => session },
    get: (name) => (name === 'llm' ? options.llm : undefined),
  };
  mod.apply(ctx, options.config);
  assert.ok(definition !== undefined, 'apply() 应该注册 /handover 命令');
  return {
    definition,
    invoke: (rawInput, agentId = SESSION_ID) =>
      definition.handler({ agent: { id: agentId }, rawInput, signal: new AbortController().signal }),
  };
}

test('导出契约：name / inject', () => {
  assert.equal(mod.name, 'dsh-context-actions');
  assert.deepEqual(mod.inject, ['commands', 'sessions']);
});

test('注册命令：name / description / handler', () => {
  const host = makeHost();
  assert.equal(host.definition.name, 'handover');
  assert.equal(typeof host.definition.description, 'string');
  assert.equal(typeof host.definition.handler, 'function');
});

test('--where：返回交接目录与当前生成方式', async () => {
  const mechanical = await makeHost().invoke('--where');
  assert.equal(mechanical.kind, 'success');
  assert.deepEqual(JSON.parse(mechanical.text), { dir: HANDOVER_DIR, mode: 'mechanical' });
  assert.ok(fs.existsSync(HANDOVER_DIR), '--where 应创建交接目录');

  const llm = await makeHost({ config: { handover: { mode: 'llm' } } }).invoke('--where');
  assert.deepEqual(JSON.parse(llm.text), { dir: HANDOVER_DIR, mode: 'llm' });

  const override = await makeHost().invoke('--where --llm');
  assert.deepEqual(JSON.parse(override.text), { dir: HANDOVER_DIR, mode: 'llm' });
});

test('配置归一化：非法 mode 回退默认', async () => {
  const host = makeHost({ config: { handover: { mode: 'bogus', provider: '   ' } } });
  const result = await host.invoke('--where');
  assert.deepEqual(JSON.parse(result.text), { dir: HANDOVER_DIR, mode: 'mechanical' });
});

test('mechanical：--write 生成文档并提取文件 / 命令 / 工具结果', async () => {
  const target = path.join(HANDOVER_DIR, 'mechanical.md');
  const result = await makeHost().invoke('--write "' + target + '"');
  assert.equal(result.kind, 'success', result.text);
  const markdown = fs.readFileSync(target, 'utf8');
  assert.ok(markdown.startsWith('# 会话交接文档'));
  assert.ok(markdown.includes('帮我把「交接」按钮做出来'));
  assert.ok(markdown.includes('npm test'));
  assert.ok(markdown.includes('PASS 12 tests'));
  assert.ok(markdown.includes('压缩检查点：之前完成了 X'));
  assert.ok(markdown.includes('`C:/work` ×1'));
  assert.ok(markdown.includes('未调用模型'));
  assert.ok(markdown.includes('请用户选择'));
  assert.ok(!markdown.includes('直接继续推进工作'));
  assert.ok(markdown.includes('| 会话消息 / 用户轮次 / 工具调用 | 6 / 2 / 1 |'));
  assert.ok(!markdown.includes('这段注入指令不应出现在交接文档里'));
});

test('mechanical：未指定路径时自动命名', async () => {
  const result = await makeHost().invoke(undefined);
  assert.equal(result.kind, 'success', result.text);
  const files = fs.readdirSync(HANDOVER_DIR).filter((name) => name.startsWith('handover-abc12345-'));
  assert.equal(files.length, 1, JSON.stringify(files));
  assert.match(files[0], /^handover-abc12345-\d{8}-\d{6}\.md$/);
});

test('拒绝把文档写到交接目录之外', async () => {
  const outside = path.join(sandbox, 'outside.md');
  const result = await makeHost().invoke('--write ' + outside);
  assert.equal(result.kind, 'error');
  assert.ok(result.text.includes('拒绝写入'), result.text);
  assert.ok(!fs.existsSync(outside));
});

test('未知参数返回用法', async () => {
  const result = await makeHost().invoke('--bogus');
  assert.equal(result.kind, 'error');
  assert.ok(result.text.includes('用法'), result.text);
});

test('llm：没有 llm 服务时回退脚本节选并写明原因', async () => {
  const target = path.join(HANDOVER_DIR, 'fallback.md');
  const host = makeHost({ config: { handover: { mode: 'llm' } } });
  const result = await host.invoke('--write "' + target + '"');
  assert.equal(result.kind, 'success', result.text);
  assert.ok(result.text.includes('回退'), result.text);
  const markdown = fs.readFileSync(target, 'utf8');
  assert.ok(markdown.includes('模型总结失败'));
  assert.ok(markdown.includes('脚本节选（模型总结回退）'));
  assert.ok(markdown.includes('请用户选择'));
});
