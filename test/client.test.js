/**
 * dsh-context-actions 浏览器半侧单元测试。
 *
 * 不依赖 jsdom / React：用极简桩捕获 window.__ModuleLoader__.load 的 factory，
 * 再用假 React 渲染设置卡片，验证 bundle 契约与字段显隐规则。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const clientFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/client.js');

let captured;
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => {
      captured = entry;
    },
  },
};

await import(pathToFileURL(clientFile).href);

/** 极简 React 桩：createElement 只造普通对象，hooks 只在渲染设置卡片时用到。 */
function makeReact() {
  let hookIndex = 0;
  let states = [];
  return {
    createElement(type, props, ...children) {
      return { type, props: Object.assign({}, props, { children: children.length <= 1 ? children[0] : children }) };
    },
    useState(initial) {
      const index = hookIndex;
      hookIndex += 1;
      const hasValue = Object.prototype.hasOwnProperty.call(states, index);
      return [hasValue ? states[index] : initial, () => {}];
    },
    useEffect() {},
    useMemo(fn) {
      return fn();
    },
    useCallback(fn) {
      return fn;
    },
    useRef(value) {
      return { current: value };
    },
    reset(nextStates) {
      hookIndex = 0;
      states = nextStates === undefined ? [] : nextStates;
    },
  };
}

const react = makeReact();
const exports = captured.factory((name) => {
  if (name === 'react') return react;
  throw new Error('unexpected require: ' + name);
});

test('bundle 契约：id / name / apply', () => {
  assert.equal(captured.id, 'dsh-context-actions');
  assert.equal(exports.name, 'dsh-context-actions');
  assert.equal(typeof exports.apply, 'function');
});

/** 用假 ctx 触发 apply()，捕获 settings.plugin.item 的组件函数。 */
function renderCard(snapshot) {
  let registered;
  const fakeCtx = {
    inject(services, callback) {
      if (services.length === 1 && services[0] === 'locale') {
        callback({
          effect: (fn) => fn(),
          locale: { register() {}, bind: () => (key) => key },
        });
        return;
      }
      if (services.includes('slots')) {
        callback({
          settingsScope: {
            bind: () => ({
              getSnapshot: () => snapshot,
              subscribe: () => () => {},
              set: async () => {},
              mutate: async () => {},
            }),
          },
          slots: {
            inject: (name, fn) => fn(),
            register: (config, view) => {
              registered = { config, view };
            },
          },
          remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [], failures: [] } }) } },
        });
      }
    },
  };
  exports.apply(fakeCtx);
  assert.ok(registered !== undefined, '应注册 settings.plugin.item');
  assert.equal(registered.config.key, 'dsh-context-actions');
  const descriptor = registered.view({});
  assert.equal(typeof descriptor.type, 'function');
  return descriptor.type;
}

function baseProps(snapshot) {
  return {
    useHandoverCard: () => snapshot,
    setHandoverField: async () => {},
    resetAllHandoverFields: async () => {},
    loadModelCatalog: async () => ({ ok: true, value: { groups: [], failures: [] } }),
  };
}

/** 从假 React 树里收集 CardField 的 spec。 */
function specKeys(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) specKeys(child, out);
    return out;
  }
  if (node === null || typeof node !== 'object') return out;
  if (node.props !== undefined && node.props.spec !== undefined && typeof node.props.spec.key === 'string') {
    out.push(node.props.spec);
  }
  if (node.props !== undefined) specKeys(node.props.children, out);
  return out;
}

test('脚本节选：只显示「交接文档生成方式」一项，并带机械提示', () => {
  const snapshot = { status: 'ready', writable: true, user: {}, value: { mode: 'mechanical' } };
  const Card = renderCard(snapshot);
  react.reset([true]);
  const tree = Card(baseProps(snapshot));
  const specs = specKeys(tree);
  assert.deepEqual(specs.map((spec) => spec.key), ['mode']);
  assert.equal(specs[0].hintText, 'card.mechanicalHint');
});

test('模型总结：显示 4 个字段，并保留已保存但目录里没有的 provider', () => {
  const snapshot = {
    status: 'ready',
    writable: true,
    user: { provider: 'qiniu' },
    value: { mode: 'llm', provider: 'qiniu', model: 'deepseek-flash', prompt: '提示词', maxOutputTokens: 2000 },
  };
  const Card = renderCard(snapshot);
  react.reset([true]);
  const specs = specKeys(Card(baseProps(snapshot)));
  assert.deepEqual(specs.map((spec) => spec.key), ['mode', 'provider', 'model', 'prompt']);
  const provider = specs.find((spec) => spec.key === 'provider');
  assert.ok(provider.options.some((option) => option.value === ''));
  assert.ok(provider.options.some((option) => option.value === 'qiniu'));
  assert.equal(specs.find((spec) => spec.key === 'model').locked, false);
});

test('模型总结：未选 provider 时 model 下拉锁定', () => {
  const snapshot = {
    status: 'ready',
    writable: true,
    user: {},
    value: { mode: 'llm', provider: '', model: '', prompt: '提示词', maxOutputTokens: 2000 },
  };
  const Card = renderCard(snapshot);
  react.reset([true]);
  const specs = specKeys(Card(baseProps(snapshot)));
  assert.equal(specs.find((spec) => spec.key === 'model').locked, true);
});

test('snapshot 不可用时卡片返回 null', () => {
  const Card = renderCard(undefined);
  react.reset([true]);
  assert.equal(Card(baseProps(undefined)), null);
});

/** 造一个极简 DOM 节点，供 findContextPanel 测试使用。 */
function makeNode(attrs, children) {
  const node = {
    attrs: attrs || {},
    children: children || [],
    parentElement: null,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    querySelector() {
      return null;
    },
  };
  for (const child of node.children) if (child !== null && child !== undefined) child.parentElement = node;
  return node;
}

function makeTrigger(label, hasRing) {
  const trigger = makeNode({ 'aria-haspopup': 'dialog', 'aria-expanded': 'true', 'aria-label': label }, []);
  trigger.querySelector = (selector) => (hasRing && selector === 'svg[viewBox="0 0 14 14"]' ? { ring: true } : null);
  return trigger;
}

test('findContextPanel：只认上下文圆环，不认会话统计浮窗', () => {
  const find = exports.__test.findContextPanel;
  assert.equal(typeof find, 'function');

  // 上下文圆环（中文）：面板是 trigger 的兄弟节点（inline，不是 portal）
  const contextPanel = makeNode({ role: 'dialog' }, []);
  const contextTrigger = makeTrigger('上下文已用 45%', true);
  makeNode({}, [contextTrigger, contextPanel]);
  const contextDoc = { querySelectorAll: (selector) => (selector.startsWith('button') ? [contextTrigger] : []) };
  assert.equal(find(contextDoc), contextPanel);

  // 上下文圆环（英文，靠 label 里的 context 命中）
  const enPanel = makeNode({ role: 'dialog' }, []);
  const enTrigger = makeTrigger('45% of context used', false);
  makeNode({}, [enTrigger, enPanel]);
  const enDoc = { querySelectorAll: (selector) => (selector.startsWith('button') ? [enTrigger] : []) };
  assert.equal(find(enDoc), enPanel);

  // 其它语言：label 里没有 context，但 trigger 里有 14x14 圆环 SVG
  const otherPanel = makeNode({ role: 'dialog' }, []);
  const otherTrigger = makeTrigger('コンテキスト 45%', true);
  makeNode({}, [otherTrigger, otherPanel]);
  const otherDoc = { querySelectorAll: (selector) => (selector.startsWith('button') ? [otherTrigger] : []) };
  assert.equal(find(otherDoc), otherPanel);

  // 会话统计 / 缓存命中 pill：label 带 % 但不是上下文，面板 portal 到 body，不在祖先链里
  const statTrigger = makeTrigger('7.3M tok · 缓存命中 97%', false);
  makeNode({}, [statTrigger]);
  const statDoc = { querySelectorAll: (selector) => (selector.startsWith('button') ? [statTrigger] : []) };
  assert.equal(find(statDoc), null);

  // TPS pill：label 里没有 %
  const tpsTrigger = makeTrigger('13 轮 65 步 · 170 tok/s', false);
  makeNode({}, [tpsTrigger]);
  const tpsDoc = { querySelectorAll: (selector) => (selector.startsWith('button') ? [tpsTrigger] : []) };
  assert.equal(find(tpsDoc), null);
});

test('client 源码：保留了圆环专用选择逻辑，且不再用任意 dt/dd 兜底', () => {
  const source = fs.readFileSync(clientFile, 'utf8');
  assert.ok(source.includes('findContextPanel(document)'));
  assert.ok(source.includes('svg[viewBox="0 0 14 14"]'));
  assert.ok(!source.includes("dialog.querySelector('dl')"));
});

test('promptText：脚本交接先询问用户，不直接开工', () => {
  const prompt = exports.__test.promptText('/tmp/handover.md', 'mechanical');
  assert.ok(prompt.includes('/tmp/handover.md'));
  assert.ok(prompt.includes('下一步计划'));
  assert.ok(prompt.includes('手动输入'));
  assert.ok(prompt.includes('先不要动手'));
  assert.ok(!prompt.includes('直接继续推进'));
});

test('promptText：模型交接沿用「读文档 → 复述 → 计划 → 继续」', () => {
  const prompt = exports.__test.promptText('/tmp/handover.md', 'llm');
  assert.ok(prompt.includes('直接继续推进'));
  assert.ok(!prompt.includes('手动输入'));
});

test('workspaceIdOf：沿用原会话的 Workspace，未归属返回 undefined', () => {
  const workspaces = {
    list: {
      getSnapshot: () => ({
        items: [
          { workspaceId: 'ws-1', sessionIds: ['s1', 's2'] },
          { workspaceId: 'ws-2', sessionIds: ['s3'] },
        ],
      }),
    },
  };
  assert.equal(exports.__test.workspaceIdOf(workspaces, 's2'), 'ws-1');
  assert.equal(exports.__test.workspaceIdOf(workspaces, 's9'), undefined);
  assert.equal(exports.__test.workspaceIdOf(undefined, 's1'), undefined);
  assert.equal(exports.__test.workspaceIdOf({ list: { getSnapshot: () => ({ items: null }) } }, 's1'), undefined);
});
