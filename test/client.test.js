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

/** 用假 ctx 触发 apply()，捕获 plugins.row.config 的页面组件（0.2 起的行配置页）。 */
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
          configForms: {
            get: () => ({
              getSnapshot: () => snapshot,
              subscribe: () => () => {},
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
        return;
      }
      // 按钮注入（sessions 等服务）与设置页无关，测试里跳过。
    },
  };
  exports.apply(fakeCtx);
  assert.ok(registered !== undefined, '应注册 plugins.row.config');
  assert.equal(registered.config.name, 'plugins.row.config');
  assert.equal(registered.config.key, 'dsh-context-actions#context-actions');
  const descriptor = registered.view({});
  assert.equal(typeof descriptor.type, 'function');
  return descriptor.type;
}

function baseProps(snapshot) {
  return {
    useHandoverForm: () => snapshot,
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
  const snapshot = { status: 'ready', writable: true, user: {}, value: { handover: { mode: 'mechanical' } } };
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
    user: { handover: { provider: 'qiniu' } },
    value: { handover: { mode: 'llm', provider: 'qiniu', model: 'deepseek-flash', prompt: '提示词' } },
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
    value: { handover: { mode: 'llm', provider: '', model: '', prompt: '提示词' } },
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

test('client 源码：保留圆环选择逻辑，图例不再是硬性条件', () => {
  const source = fs.readFileSync(clientFile, 'utf8');
  assert.ok(source.includes('findContextPanel(document)'));
  assert.ok(source.includes('svg[viewBox="0 0 14 14"]'));
  // 0.2 起 portal 面板用「锚定几何 + 结构 + 措辞」三重证据。
  assert.ok(source.includes('hasContextPanelShape'));
  assert.ok(source.includes('hasContextPanelLabel'));
  assert.ok(source.includes('isAnchoredAbove'));
  // v0.2.1：图例缺失时仍可凭 bar + 几何/措辞认出面板。
  assert.ok(!source.includes("querySelectorAll('dt').length < 2"));
});

/* ------------------------------------------------------------------ *
 * portal 面板探测（0.2+）：几何 + 结构 + 措辞三重证据
 * ------------------------------------------------------------------ */

/** 造一个带包围盒的 portal 面板节点，可控制结构特征。 */
function makePortalPanel(rect, shape) {
  const opts = shape === undefined ? {} : shape;
  const panel = makeNode({ role: 'dialog', 'aria-label': opts.label }, []);
  panel.getBoundingClientRect = () => rect;
  panel.querySelector = (selector) => {
    if (selector === '[class*="_bar"]') return opts.bar === false ? null : { bar: true };
    if (selector === '[class*="_rows"]') return opts.rows === false ? null : { rows: true };
    if (selector === 'dl') {
      if (opts.legend === false) return null;
      const dtCount = opts.dtCount === undefined ? 3 : opts.dtCount;
      return { querySelectorAll: () => new Array(dtCount).fill({}) };
    }
    return null;
  };
  return panel;
}

/** trigger 在 (x=100..140, y=500..520)；面板贴着它上方 8px。 */
const TRIGGER_RECT = { left: 100, top: 500, right: 140, bottom: 520, width: 40, height: 20 };
const PANEL_RECT = { left: 60, top: 380, right: 260, bottom: 492, width: 200, height: 112 };

function portalDoc(panel) {
  const trigger = makeTrigger('上下文已用 45%', true);
  trigger.getBoundingClientRect = () => TRIGGER_RECT;
  return { querySelectorAll: (selector) => (selector.startsWith('button') ? [trigger] : [panel]) };
}

test('portal 面板：有 bar + 三行图例时命中', () => {
  const panel = makePortalPanel(PANEL_RECT, { label: '上下文已用' });
  assert.equal(exports.__test.findContextPanel(portalDoc(panel)), panel);
});

test('portal 面板：图例缺失（上游不再渲染 dl）仍靠 bar + 几何命中', () => {
  const panel = makePortalPanel(PANEL_RECT, { label: '上下文已用', legend: false });
  assert.equal(exports.__test.findContextPanel(portalDoc(panel)), panel);
});

test('portal 面板：CSS module 哈希变化（无 _bar/_rows）仍靠措辞命中', () => {
  const panel = makePortalPanel(PANEL_RECT, { label: '上下文已用', bar: false, rows: false });
  assert.equal(exports.__test.findContextPanel(portalDoc(panel)), panel);
});

test('portal 面板：几何侧翻（面板偏右但仍重叠）也能命中', () => {
  const sideRect = { left: 130, top: 380, right: 330, bottom: 492, width: 200, height: 112 };
  const panel = makePortalPanel(sideRect, { label: '上下文已用' });
  assert.equal(exports.__test.findContextPanel(portalDoc(panel)), panel);
});

test('portal 面板：完全不重叠的浮窗不认', () => {
  const farRect = { left: 900, top: 380, right: 1100, bottom: 492, width: 200, height: 112 };
  const panel = makePortalPanel(farRect, { label: '会话统计' });
  assert.equal(exports.__test.findContextPanel(portalDoc(panel)), null);
});

test('portal 面板：只有一个非上下文 dialog 时不会被兜底误认', () => {
  const panel = makePortalPanel(PANEL_RECT, { label: '会话统计', bar: false, rows: false, legend: false });
  assert.equal(exports.__test.findContextPanel(portalDoc(panel)), null);
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
