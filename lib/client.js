/**
 * dsh-context-actions · 浏览器半侧（Client half）
 *
 * 在「上下文已用」面板底部注入两个按钮：
 *   - 压缩：对当前会话执行宿主命令 /compact（复用 dsh-command-compact）
 *   - 交接：让宿主把交接文档写进临时目录，然后新建会话并让新会话引用它
 *
 * 为什么用 DOM 注入而不是 slot：上下文占用面板由 dsh-client-ui-conversation
 * 内部渲染，没有对外开放的 slot。这里通过 MutationObserver 找到面板
 * （触发按钮 aria-haspopup="dialog" 且 aria-label 含百分比），把按钮容器
 * 追加到面板末尾；面板关闭时随面板一起销毁。
 */
window.__ModuleLoader__.load({
  id: 'dsh-context-actions',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    /** React 来自客户端平台模块表（seed）：只用于「设置 → 插件」里的配置卡片。 */
    const React = require('react');

    /** 包名 = Cordis 插件名 = loader 行名。 */
    const NAME = 'dsh-context-actions';
    /** i18n 命名空间。 */
    const NS = 'dsh-context-actions';
    /** 宿主命令名（不含斜杠）。 */
    const COMMAND = 'handover';

    const DICTS = {
      zh: {
        'button.compact': '压缩',
        'button.handover': '交接',
        'tip.compact': '压缩上下文：对当前会话执行 /compact',
        'tip.handover': '交接：生成交接文档到临时目录，并新建会话接续',
        'state.noSession': '当前没有可用会话',
        'state.compacting': '正在压缩上下文…',
        'state.compacted': '已请求压缩，结果见对话流',
        'state.compactMissing': '宿主未注册 /compact 命令',
        'state.compactUnsupported': '当前 agent 预设未挂载压缩后端（/compact）',
        'tip.compactPresetHint':
          '当前会话的 agent 预设没有压缩后端。二选一：① 用 standard 预设新建会话；② 在 profile 的 cordis.patch.yml 里加两行：- id: compaction-basic / disabled: false 与 - id: command-compact / disabled: false（注意后者会为该部署开启自动压缩）。',
        'state.handoverStart': '正在生成交接文档…',
        'state.handoverSummarizing': '正在调用模型总结交接文档…',
        'state.handoverWritten': '文档已生成，正在新建会话…',
        'state.handoverDone': '已新建会话并引用交接文档',
        'state.handoverNoPrompt': '已新建会话，但首条消息未送达',
        'state.hostMissing': '宿主未注册 /' + COMMAND + ' 命令，请重启 dsh 后重试',
        'state.failed': '失败',
        'opt.followSession': '跟随会话（不固定）',
        'opt.unavailable': '当前不可用',
        'opt.savedUnavailable': '已保存但当前不可用',
        'card.catalogLoading': '正在读取已配置的模型目录…',
        'card.catalogUnavailable': '模型目录读取失败，改为手动输入',
        'field.provider.hint': '从已配置的 provider 里选一条固定路由；跟随会话 = 用该会话最近一次请求的路由',
        'field.model.hint': '先选 provider；跟随会话 = 不固定模型',
        'card.resetAll': '恢复全部默认',
        'card.resetAllTitle': '清空本插件的全部用户设置，恢复部署默认值',
        'card.mechanicalHint': '脚本节选：零模型调用。选「模型总结」后可配置总结模型、提示词与输出上限',
        'field.prompt': '自定义提示词',
        'field.prompt.hint': '整段替换发给模型的提示词；留空 = 用内置默认',
        'card.title': '上下文动作（压缩 / 交接）',
        'card.desc': '面板按钮的交接文档生成方式：脚本节选或模型总结。保存后立即生效。',
        'card.open': '展开',
        'card.close': '收起',
        'card.loading': '正在读取设置…',
        'card.unavailable': '本部署未暴露该设置，或当前连接只在本地生效。',
        'card.readOnly': '当前设置存储只读，修改无法保存。',
        'card.saving': '保存中…',
        'card.saved': '已保存',
        'card.failed': '保存失败',
        'card.overridden': '已覆盖',
        'card.reset': '重置',
        'card.resetTitle': '清除该字段的用户值，恢复为组合配置 / 默认值',
        'card.invalidNumber': '请输入大于 0 的数字',
        'card.hint.mode': '压缩/交接的生成方式',
        'field.mode': '交接文档生成方式',
        'opt.mechanical': '脚本节选（零模型调用）',
        'opt.llm': '模型总结（调用一次模型）',
        'field.provider': '总结模型 provider',
        'field.provider.hint': '留空 = 跟随该会话最近一次请求的路由',
        'field.model': '总结模型 model id',
        'field.model.hint': '留空 = 跟随该会话最近一次请求的路由',
        'field.reasoningEffort': '推理档位',
        'field.reasoningEffort.hint': '留空 = 沿用会话的档位',
        'field.maxOutputTokens': '输出上限（tokens）',
        'field.timeoutMs': '单次总结超时（ms）',
        'field.maxInputChars': '喂给模型的纪要字符上限',
        'field.llmMessageTextLimit': '喂模型时单条消息截断',
        'field.llmToolResultLimit': '喂模型时单条工具结果截断',
        'field.includeDigest': '摘要后附脚本节选纪要',
        'field.fallback': '总结失败时回退脚本节选',
      },
      en: {
        'button.compact': 'Compact',
        'button.handover': 'Handover',
        'tip.compact': 'Compact context: run /compact on this session',
        'tip.handover': 'Handover: write a handover document to a temp dir, then start a new session',
        'state.noSession': 'No active session',
        'state.compacting': 'Compacting context…',
        'state.compacted': 'Compaction requested; see the transcript',
        'state.compactMissing': '/compact is not registered on the host',
        'state.compactUnsupported': 'This agent preset mounts no compaction backend (/compact)',
        'tip.compactPresetHint':
          'The current agent preset has no compaction backend. Either start a session with the standard preset, or add "- id: compaction-basic / disabled: false" and "- id: command-compact / disabled: false" to the profile cordis.patch.yml (the latter also turns on automatic compaction for this deployment).',
        'state.handoverStart': 'Writing the handover document…',
        'state.handoverSummarizing': 'Summarizing the handover document with the model…',
        'state.handoverWritten': 'Document written, creating a new session…',
        'state.handoverDone': 'New session started with the handover document',
        'state.handoverNoPrompt': 'New session created, but the first message was not delivered',
        'state.hostMissing': '/' + COMMAND + ' is not registered on the host — restart dsh and retry',
        'state.failed': 'failed',
        'opt.followSession': 'Follow the session',
        'opt.unavailable': 'currently unavailable',
        'opt.savedUnavailable': 'saved but currently unavailable',
        'card.catalogLoading': 'Loading the configured model catalog…',
        'card.catalogUnavailable': 'Could not read the model catalog; falling back to manual input',
        'field.provider.hint': 'Pick one configured provider to pin the route; Follow the session uses the session last request route',
        'field.model.hint': 'Pick a provider first; Follow the session leaves the model unpinned',
        'card.resetAll': 'Restore all defaults',
        'card.resetAllTitle': 'Clear every user value of this plugin and fall back to the deployment defaults',
        'card.mechanicalHint': 'Script digest: no model call. Pick "Model summary" to configure the model, prompt and output cap',
        'field.prompt': 'Custom prompt',
        'field.prompt.hint': 'Replaces the whole prompt sent to the model; empty = built-in default',
        'card.title': 'Context actions (Compact / Handover)',
        'card.desc': 'How the panel button writes its handover document: script digest or model summary. Changes apply immediately.',
        'card.open': 'Expand',
        'card.close': 'Collapse',
        'card.loading': 'Reading settings…',
        'card.unavailable': 'This deployment does not expose the section, or this connection keeps preferences local.',
        'card.readOnly': 'The settings store is read-only; changes cannot be saved.',
        'card.saving': 'Saving…',
        'card.saved': 'Saved',
        'card.failed': 'Save failed',
        'card.overridden': 'overridden',
        'card.reset': 'Reset',
        'card.resetTitle': 'Clear the user value and inherit the composition/default again',
        'card.invalidNumber': 'Enter a number greater than 0',
        'card.hint.mode': 'How compaction/handover documents are produced',
        'field.mode': 'Handover document mode',
        'opt.mechanical': 'Script digest (no model call)',
        'opt.llm': 'Model summary (one model call)',
        'field.provider': 'Summary provider',
        'field.provider.hint': 'Empty = follow the session last request route',
        'field.model': 'Summary model id',
        'field.model.hint': 'Empty = follow the session last request route',
        'field.reasoningEffort': 'Reasoning effort',
        'field.reasoningEffort.hint': 'Empty = inherit the session effort',
        'field.maxOutputTokens': 'Output cap (tokens)',
        'field.timeoutMs': 'Summarization timeout (ms)',
        'field.maxInputChars': 'Digest input cap (chars)',
        'field.llmMessageTextLimit': 'Per-message truncation for the model',
        'field.llmToolResultLimit': 'Per-tool-result truncation for the model',
        'field.includeDigest': 'Append the script digest after the summary',
        'field.fallback': 'Fall back to the script digest on failure',
      },
    };

    /** 默认语言（中文），locale 服务可用时会被替换。 */
    let t = (key) => DICTS.zh[key] ?? key;

    const CSS = [
      '.dsch-box{display:flex;flex-direction:column;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28))}',
      '.dsch-row{display:flex;gap:8px}',
      '.dsch-btn{flex:1 1 0;min-width:0;height:26px;display:inline-flex;align-items:center;justify-content:center;padding:0 8px;font:inherit;font-size:12px;line-height:1;color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-button-tool-bar-fill,rgba(128,128,128,.12));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));border-radius:8px;cursor:pointer}',
      '.dsch-btn:hover:not(:disabled){background:var(--dsw-alias-button-tool-bar-hover,rgba(128,128,128,.2))}',
      '.dsch-btn:disabled{opacity:.5;cursor:default}',
      '.dsch-status{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,inherit);word-break:break-all}',
      '.dsch-status:empty{display:none}',
      '.dsch-status[data-kind="ok"]{color:var(--dsw-alias-state-success-primary,inherit)}',
      '.dsch-status[data-kind="error"]{color:var(--dsw-alias-state-error-primary,inherit)}',
    ].join('');

    /* ---------------------------------------------------------------- *
     * 注入逻辑
     * ---------------------------------------------------------------- */

    /** 「设置 → 插件」卡片的样式（沿用设计变量，尽量贴近原生卡片）。 */
    /**
     * 「设置 → 插件」卡片的样式。
     * 数值与 token 逐条对齐 dsh-client-ui-settings-plugins 的卡片（PluginCard）与字段（fields）CSS 模块,
     * 这样和「终端 / Agent 循环 / Subagent / 网页搜索」那些原生卡片看起来是同一套。
     */
    const CARD_CSS = [
      '.dsch-set-card{list-style:none;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;transition:border-color .16s,background .16s}',
      '.dsch-set-card:hover{border-color:var(--dsw-alias-label-dimmed)}',
      '.dsch-set-card.dsch-set-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
      '.dsch-set-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}',
      '.dsch-set-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dsch-set-headtext{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0}',
      '.dsch-set-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
      '.dsch-set-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
      '.dsch-set-chevron{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px;transition:transform .16s}',
      '.dsch-set-open .dsch-set-chevron{transform:rotate(180deg)}',
      '.dsch-set-body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}',
      '.dsch-set-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
      '.dsch-set-field+.dsch-set-field{border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.dsch-set-row{display:flex;align-items:center;gap:8px}',
      '.dsch-set-label{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}',
      '.dsch-set-badges{display:inline-flex;align-items:center;gap:8px}',
      '.dsch-set-badge{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
      '.dsch-set-input,.dsch-set-select{box-sizing:border-box;width:100%;height:34px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font:inherit;font-size:13px;line-height:1.5}',
      '.dsch-set-input:focus-visible,.dsch-set-select:focus-visible,.dsch-set-textarea:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
      '.dsch-set-input:disabled,.dsch-set-select:disabled,.dsch-set-textarea:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
      '.dsch-set-textarea{box-sizing:border-box;width:100%;min-height:132px;padding:8px 12px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;font:inherit;font-size:13px;line-height:1.5;resize:vertical}',
      '.dsch-set-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
      '.dsch-set-foot{display:flex;justify-content:flex-end;align-items:center;gap:8px;border-top:.5px solid var(--dsw-alias-border-l2);padding:12px 0 4px}',
      '.dsch-set-status{flex:1;min-width:0;color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
      '.dsch-set-status[data-kind="error"]{color:var(--dsw-alias-label-error,var(--dsw-alias-state-error-primary,#e5484d))}',
      '.dsch-set-btn{appearance:none;font:inherit;font-size:13px;line-height:1.5;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 14px;color:var(--dsw-alias-label-secondary);background:0 0}',
      '.dsch-set-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
      '.dsch-set-btn:disabled{opacity:.4;cursor:default}',
      '.dsch-set-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
    ].join('');

    /** 全局单例容器状态：同一时刻只会开一个上下文面板。 */
    const ui = {
      box: null,
      panel: null,
      status: null,
      buttons: [],
      busy: false,
    };

    /**
     * 挂载：等待 sessions / remote 服务就绪后再接 UI。
     * @param ctx - 浏览器 Cordis 上下文。
     */
    function apply(ctx) {
      // locale 可选：拿不到就用内置中文。
      ctx.inject(['locale'], (localeCtx) => {
        try {
          localeCtx.effect(() => localeCtx.locale.register(NS, 'zh', DICTS.zh));
          localeCtx.effect(() => localeCtx.locale.register(NS, 'en', DICTS.en));
          const bound = localeCtx.locale.bind(NS);
          if (typeof bound === 'function') {
            t = (key) => {
              const value = bound(key);
              return typeof value === 'string' && value !== '' ? value : DICTS.zh[key] ?? key;
            };
          }
        } catch (error) {
          console.warn('[dsh-context-actions] locale 注册失败，使用内置中文', error);
        }
      });

      // 「设置 → 插件」卡片：宿主注册了同名 settings namespace 时才会被派发。
      applySettingsCard(ctx);

      // 必需服务：会话对象层 + 远程命名空间（命令、模型选择）。
      ctx.inject(['sessions', 'remote', 'remote.commands', 'remote.session'], (scope) => {
        let timer = 0;
        const schedule = () => {
          if (timer !== 0) return;
          timer = setTimeout(() => {
            timer = 0;
            sync();
          }, 60);
        };
        const observer = new MutationObserver(schedule);
        scope.effect(() => {
          ensureStyles();
          observer.observe(document.body, { childList: true, subtree: true });
          schedule();
          return () => {
            observer.disconnect();
            if (timer !== 0) clearTimeout(timer);
            removeBox();
          };
        });
        scope.effect(() => () => {});

        /** 页面结构变化后把按钮容器对到面板末尾。 */
        function sync() {
          const panel = findPanel();
          if (panel === null) {
            if (ui.box !== null && !document.contains(ui.box)) removeBox();
            return;
          }
          ensureBox(panel);
          // React 可能在展开期间追加图例行，保证按钮始终贴在面板底部。
          if (ui.panel === panel && panel.lastElementChild !== ui.box) panel.appendChild(ui.box);
        }

        /** 找到「上下文已用」面板。 */
        function findPanel() {
          const triggers = document.querySelectorAll('button[aria-haspopup="dialog"][aria-expanded="true"]');
          for (const trigger of triggers) {
            const label = trigger.getAttribute('aria-label') || '';
            if (!/\d\s*%/.test(label)) continue; // 语义无关的锚点：读数里一定带百分号
            let node = trigger.parentElement;
            for (let depth = 0; depth < 4 && node !== null; depth += 1, node = node.parentElement) {
              for (const child of node.children) {
                if (child.getAttribute('role') === 'dialog') return child;
              }
            }
          }
          // 结构兜底：带三行图例（dt/dd）的 dialog 就是上下文面板。
          for (const dialog of document.querySelectorAll('div[role="dialog"]')) {
            const list = dialog.querySelector('dl');
            if (list !== null && list.querySelectorAll('dt').length >= 3) return dialog;
          }
          return null;
        }

        /** 在指定面板里创建按钮容器。 */
        function ensureBox(panel) {
          if (ui.box !== null && ui.panel === panel && panel.contains(ui.box)) return;
          removeBox();

          const box = document.createElement('div');
          box.className = 'dsch-box';
          box.dataset.dshContextActions = '';
          box.addEventListener('pointerdown', (event) => event.stopPropagation());

          const row = document.createElement('div');
          row.className = 'dsch-row';

          const compact = makeButton('button.compact', 'tip.compact', () => runCompact());
          const handover = makeButton('button.handover', 'tip.handover', () => runHandover());
          row.append(compact.button, handover.button);

          const status = document.createElement('div');
          status.className = 'dsch-status';
          status.setAttribute('role', 'status');

          box.append(row, status);
          panel.appendChild(box);

          ui.box = box;
          ui.panel = panel;
          ui.status = status;
          ui.buttons = [compact.button, handover.button];
        }

        /** 移除按钮容器。 */
        function removeBox() {
          if (ui.box !== null) ui.box.remove();
          ui.box = null;
          ui.panel = null;
          ui.status = null;
          ui.buttons = [];
          ui.busy = false;
        }

        /** 造一个按钮。 */
        function makeButton(labelKey, tipKey, onClick) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'dsch-btn';
          button.textContent = t(labelKey);
          button.title = t(tipKey);
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (ui.busy) return;
            onClick();
          });
          return { button };
        }

        /** 写状态行（可选提示全文放到 title）。 */
        function setStatus(text, kind, hint) {
          if (ui.status === null) return;
          ui.status.textContent = text ?? '';
          ui.status.dataset.kind = kind ?? '';
          if (typeof hint === 'string' && hint !== '') ui.status.title = hint;
          else ui.status.removeAttribute('title');
        }

        /** 忙碌时禁用两个按钮。 */
        function setBusy(busy) {
          ui.busy = busy;
          for (const button of ui.buttons) button.disabled = busy;
        }

        /** 当前会话（id + 列表行）。 */
        function currentSession() {
          const state = scope.sessions.list.getSnapshot();
          const id = state.current;
          if (id === undefined) return undefined;
          return { id: id, summary: state.byId[id] };
        }

        /**
         * 动作一：压缩上下文。
         * /compact 由 agent 预设提供的压缩后端注册（web 部署默认把 compaction-basic 与
         * command-compact 交给预设），所以先查命令目录再执行，缺后端时给出可操作的提示。
         */
        async function runCompact() {
          const current = currentSession();
          if (current === undefined) {
            setStatus(t('state.noSession'), 'error');
            return;
          }
          setBusy(true);
          setStatus(t('state.compacting'), 'busy');
          try {
            const commands = scope.remote.commands;
            const listed = await commands.list(current.id);
            const available =
              listed.ok === true && Array.isArray(listed.value) && listed.value.some((item) => item !== null && item.name === 'compact');
            if (!available) {
              setStatus(t('state.compactUnsupported'), 'error', t('tip.compactPresetHint'));
              return;
            }
            const executed = await commands.execute(current.id, '/compact', [], new AbortController().signal);
            if (executed.ok !== true) throw new Error(failureText(executed.error));
            const outcome = executed.value === undefined || executed.value === null ? undefined : executed.value.result;
            if (outcome === undefined) throw new Error(t('state.compactMissing'));
            if (outcome.kind !== 'success') {
              setStatus(typeof outcome.text === 'string' && outcome.text !== '' ? outcome.text : t('state.failed'), 'error');
              return;
            }
            const text = typeof outcome.text === 'string' && outcome.text !== '' ? outcome.text : t('state.compacted');
            setStatus(text, 'ok');
          } catch (error) {
            setStatus(t('state.failed') + '：' + messageOf(error), 'error');
          } finally {
            setBusy(false);
          }
        }

        /** 动作二：交接（写文档 → 新建会话 → 新会话引用文档）。 */
        async function runHandover() {
          const current = currentSession();
          if (current === undefined) {
            setStatus(t('state.noSession'), 'error');
            return;
          }
          setBusy(true);
          setStatus(t('state.handoverStart'), 'busy');
          try {
            const commands = scope.remote.commands;
            const where = await commands.execute(current.id, '/' + COMMAND + ' --where', [], new AbortController().signal);
            if (where.ok !== true) throw new Error(failureText(where.error));
            const described = parseWhere(resultText(where.value));
            if (described.dir === '') throw new Error(t('state.hostMissing'));

            const target = joinPath(described.dir, 'handover-' + shortId(current.id) + '-' + stamp(new Date()) + '.md');
            const startedAt = Date.now();
            let ticker = 0;
            if (described.mode === 'llm') {
              setStatus(t('state.handoverSummarizing'), 'busy', target);
              ticker = setInterval(() => {
                setStatus(t('state.handoverSummarizing') + ' ' + Math.round((Date.now() - startedAt) / 1000) + 's', 'busy', target);
              }, 2000);
            }
            let written;
            try {
              written = await commands.execute(
                current.id,
                '/' + COMMAND + ' --write ' + target,
                [],
                new AbortController().signal,
              );
            } finally {
              if (ticker !== 0) {
                clearInterval(ticker);
                ticker = 0;
              }
            }
            if (written.ok !== true) throw new Error(failureText(written.error));
            const outcome = written.value !== undefined && written.value !== null ? written.value.result : undefined;
            if (outcome === undefined || outcome.kind !== 'success') {
              throw new Error(outcome !== undefined && typeof outcome.text === 'string' ? outcome.text : t('state.failed'));
            }
            if (typeof outcome.text === 'string' && outcome.text !== '') setStatus(outcome.text, 'ok', target);
            setStatus(t('state.handoverWritten'), 'busy', target);

            const created = await scope.sessions.create(
              current.summary !== undefined && typeof current.summary.cwd === 'string' && current.summary.cwd !== ''
                ? { cwd: current.summary.cwd }
                : {},
            );
            await inheritModel(current.summary, created);
            scope.sessions.open(created);
            const binding = scope.sessions.binding(created);
            if (binding === undefined) throw new Error(t('state.handoverNoPrompt'));

            const text = promptText(target);
            let handle;
            try {
              handle = binding.session.beginSubmission({ mode: 'queue', text: text, attachments: [] });
            } catch (error) {
              console.warn('[dsh-context-actions] 提交回显注册失败，改为直接发送', error);
            }
            const result = await binding.session.prompt(
              [{ type: 'text', text: text }],
              'queue',
              undefined,
              handle === undefined ? undefined : handle.requestId,
            );
            if (result.ok !== true) {
              if (handle !== undefined) handle.abandon();
              throw new Error(failureText(result.error));
            }
            setStatus(t('state.handoverDone'), 'ok', target);
          } catch (error) {
            setStatus(t('state.failed') + '：' + messageOf(error), 'error');
          } finally {
            setBusy(false);
          }
        }

        /** 新会话沿用当前会话的模型（尽力而为）。 */
        async function inheritModel(summary, sessionId) {
          try {
            const values = summary === undefined ? undefined : summary.projectionValues;
            const selection = values === undefined ? undefined : values.modelSelection;
            const next = selection === undefined || selection === null ? undefined : selection.next ?? selection.lastUsed;
            if (next === undefined || next === null) return;
            await scope.remote.session.selectModel({
              sessionId: sessionId,
              provider: next.provider,
              model: next.model,
              reasoningEffort: next.reasoningEffort,
            });
          } catch (error) {
            console.warn('[dsh-context-actions] 继承模型选择失败', error);
          }
        }

        /** 发给新会话的首条消息。 */
        function promptText(target) {
          return [
            '你正在接手上一会话的工作。',
            '',
            '交接文档：' + target,
            '',
            '请先用文件读取工具读完整份交接文档——它记录上一会话的任务背景、已完成的工作、涉及的文件与命令、以及未完成的事项。',
            '读完后请：',
            '1. 用 3-5 行复述你对当前任务状态的理解；',
            '2. 给出下一步计划；',
            '3. 直接继续推进，不要等待额外确认。',
          ].join('\n');
        }
      });
    }

    /* ---------------------------------------------------------------- *
     * 纯函数工具
     * ---------------------------------------------------------------- */

    /** 注入按钮样式（幂等）。 */
    function ensureStyles() {
      if (document.querySelector('style[data-dsh-context-actions]') !== null) return;
      const style = document.createElement('style');
      style.dataset.dshContextActions = '';
      style.textContent = CSS + CARD_CSS;
      document.head.appendChild(style);
    }

    /** 命令结果的文本（未匹配到命令时为 undefined）。 */
    function resultText(value) {
      const outcome = value !== undefined && value !== null ? value.result : undefined;
      if (outcome === undefined || outcome.kind !== 'success' || typeof outcome.text !== 'string') return undefined;
      return outcome.text.trim();
    }

    /** 解析 /handover --where 的返回：JSON { dir, mode }；兼容旧的纯路径文本。 */
    function parseWhere(text) {
      const value = typeof text === 'string' ? text.trim() : '';
      if (value.startsWith('{')) {
        try {
          const parsed = JSON.parse(value);
          return {
            dir: typeof parsed.dir === 'string' ? parsed.dir : '',
            mode: typeof parsed.mode === 'string' ? parsed.mode : '',
          };
        } catch (error) {
          console.warn('[dsh-context-actions] --where 返回不是合法 JSON，按纯路径处理', error);
        }
      }
      return { dir: value, mode: '' };
    }

    /** 远程失败 → 可读文本。 */
    function failureText(error) {
      if (error === undefined || error === null) return 'unknown remote failure';
      if (typeof error.message === 'string' && error.message !== '') return error.message;
      if (typeof error.code === 'string' && error.code !== '') return error.code;
      return String(error);
    }

    /** 任意异常 → 可读文本。 */
    function messageOf(error) {
      if (error instanceof Error && error.message !== '') return error.message;
      return String(error);
    }

    /** 拼接目录与文件名，自动识别宿主分隔符。 */
    function joinPath(dir, name) {
      const separator = dir.includes('\\') ? '\\' : '/';
      return dir.endsWith('\\') || dir.endsWith('/') ? dir + name : dir + separator + name;
    }

    /** 会话 id 的短标识。 */
    function shortId(sessionId) {
      const match = /([0-9a-f]{8})-[0-9a-f]{4}-/i.exec(String(sessionId));
      return match === null ? String(sessionId).slice(-8) : match[1];
    }

    /** 时间戳：YYYYMMDD-HHmmss。 */
    function stamp(date) {
      const pad = (value) => String(value).padStart(2, '0');
      return (
        String(date.getFullYear()) +
        pad(date.getMonth() + 1) +
        pad(date.getDate()) +
        '-' +
        pad(date.getHours()) +
        pad(date.getMinutes()) +
        pad(date.getSeconds())
      );
    }

    /* ---------------------------------------------------------------- *
     * 「设置 → 插件」卡片（settings.plugin.item，key = settings namespace）
     * ---------------------------------------------------------------- */

    /** 卡片字段表；顺序即渲染顺序。 */
    /** 卡片字段表；顺序即渲染顺序。 */
    const CARD_FIELDS = [
      {
        key: 'mode',
        kind: 'select',
        options: [
          { value: 'mechanical', label: 'opt.mechanical' },
          { value: 'llm', label: 'opt.llm' },
        ],
      },
      { key: 'provider', kind: 'provider', hint: 'field.provider.hint' },
      { key: 'model', kind: 'model', hint: 'field.model.hint' },
      { key: 'prompt', kind: 'textarea', hint: 'field.prompt.hint' },
      { key: 'maxOutputTokens', kind: 'number' },
    ];

    /** 卡片里「一键重置」用的占位 field 名（pseudo field）。 */
    const ALL_FIELDS_KEY = '__all__';

    /**
     * 注册「设置 → 插件」里的卡片。
     * 宿主未注册同名 settings namespace 时，这一页根本不会派发这个 key，卡片自然不出现。
     * @param ctx - 浏览器 Cordis 上下文。
     */
    function applySettingsCard(ctx) {
      ctx.inject(['slots', 'settingsScope', 'remote', 'remote.session'], (child) => {
        const binder = child.settingsScope;
        const slots = child.slots;
        if (binder === undefined || slots === undefined || typeof binder.bind !== 'function') return;
        let scope;
        try {
          scope = binder.bind({ namespace: NS });
        } catch (error) {
          console.warn('[dsh-context-actions] settingsScope 绑定失败', error);
          return;
        }
        const bindings = {
          hooks: {
            handoverCard: {
              getSnapshot: () => scope.getSnapshot(),
              subscribe: (listener) => scope.subscribe(listener),
            },
          },
          setHandoverField: (field, value) => scope.set(field, value),
          // 部署里已配置的 provider/model 目录（客户端 remote.session）。
          loadModelCatalog: () => child.remote.session.modelCatalog(),
          // 一键恢复全部默认：unset 空 path = 清空本 namespace 的整个用户层。
          resetAllHandoverFields: () => scope.mutate([{ op: 'unset', path: [] }]),
        };
        slots.inject('settings.plugin.item', () => {
          return slots.register(
            {
              name: 'settings.plugin.item',
              key: NS,
              locale: NS,
              inject: () => bindings,
            },
            (props) => React.createElement(HandoverSettingsCard, props),
          );
        });
      });
    }

    /** 用户层里出现过该字段即为「已覆盖」（值相同也算）。 */
    function isOverridden(user, key) {
      return user !== null && typeof user === 'object' && Object.prototype.hasOwnProperty.call(user, key);
    }

    /** 一张可展开的配置卡片。 */
    function HandoverSettingsCard(props) {
      const [open, setOpen] = React.useState(false);
      const [pendingField, setPendingField] = React.useState('');
      const [error, setError] = React.useState('');
      const [saved, setSaved] = React.useState(false);
      // 框架把 inject().hooks.<key> 变成 use<Key> 这个 React hook 属性传进来。
      const useHandoverCard = props.useHandoverCard;
      const snapshot = typeof useHandoverCard === 'function' ? useHandoverCard((value) => value) : undefined;

      // 已配置的 provider/model 目录：卡片第一次展开时拉一次，用于两个下拉框。
      const [catalog, setCatalog] = React.useState({ status: 'idle', groups: [], failures: [], message: '' });
      const loadModelCatalog = props.loadModelCatalog;
      React.useEffect(() => {
        const currentMode =
          snapshot === undefined || snapshot.value === undefined || snapshot.value === null ? undefined : snapshot.value.mode;
        if (open !== true || currentMode !== 'llm' || catalog.status !== 'idle') return;
        setCatalog({ status: 'loading', groups: [], failures: [], message: '' });
        Promise.resolve()
          .then(() => (typeof loadModelCatalog === 'function' ? loadModelCatalog() : undefined))
          .then(
            (result) => {
              if (result === undefined || result.ok !== true) {
                const message =
                  result === undefined
                    ? 'remote.session unavailable'
                    : String((result.error !== null && typeof result.error === 'object' && result.error.message) || result.error);
                setCatalog({ status: 'error', groups: [], failures: [], message: message });
                return;
              }
              const catalogValue = result.value === undefined || result.value === null ? {} : result.value;
              setCatalog({
                status: 'ready',
                groups: Array.isArray(catalogValue.groups) ? catalogValue.groups : [],
                failures: Array.isArray(catalogValue.failures) ? catalogValue.failures : [],
                message: '',
              });
            },
            (reason) => setCatalog({ status: 'error', groups: [], failures: [], message: String(reason) }),
          );
      }, [open, catalog.status, loadModelCatalog, snapshot]);

      if (snapshot === undefined || snapshot.status === 'unavailable') return null;
      const value = snapshot.value === undefined || snapshot.value === null ? {} : snapshot.value;
      const disabled = snapshot.status !== 'ready' || snapshot.writable !== true;

      const providerValue = typeof value.provider === 'string' ? value.provider : '';
      const modelValue = typeof value.model === 'string' ? value.model : '';
      const catalogFailed = catalog.status === 'error';
      const providerOptions = [{ value: '', label: t('opt.followSession') }];
      for (const group of catalog.groups) {
        providerOptions.push({ value: group.id, label: group.name + '（' + group.id + '）' });
      }
      for (const failure of catalog.failures) {
        providerOptions.push({ value: failure.id, label: failure.name + '（' + failure.id + ' · ' + t('opt.unavailable') + '）' });
      }
      if (providerValue !== '' && !providerOptions.some((option) => option.value === providerValue)) {
        providerOptions.push({ value: providerValue, label: providerValue + '（' + t('opt.savedUnavailable') + '）' });
      }
      const modelOptions = [{ value: '', label: t('opt.followSession') }];
      const providerGroup = catalog.groups.find((group) => group.id === providerValue);
      if (providerGroup !== undefined) {
        for (const model of providerGroup.models) {
          modelOptions.push({
            value: model.id,
            label: model.name !== undefined && model.name !== model.id ? model.name + '（' + model.id + '）' : model.id,
          });
        }
      }
      if (modelValue !== '' && !modelOptions.some((option) => option.value === modelValue)) {
        modelOptions.push({ value: modelValue, label: modelValue + '（' + t('opt.savedUnavailable') + '）' });
      }
      const catalogHint =
        catalog.status === 'loading' ? t('card.catalogLoading') : catalogFailed ? t('card.catalogUnavailable') : undefined;

      const settle = (operation, field) => {
        setPendingField(field);
        setError('');
        setSaved(false);
        Promise.resolve()
          .then(operation)
          .then(
            () => {
              setPendingField('');
              setSaved(true);
            },
            (reason) => {
              setPendingField('');
              setError(String(reason !== null && typeof reason === 'object' && 'message' in reason ? reason.message : reason));
            },
          );
      };
      const commit = (field, next) => {
        if (typeof props.setHandoverField !== 'function') return;
        settle(() => props.setHandoverField(field, next), field);
      };
      const resetAll = () => {
        if (typeof props.resetAllHandoverFields !== 'function') return;
        settle(() => props.resetAllHandoverFields(), ALL_FIELDS_KEY);
      };
      const overriddenCount = CARD_FIELDS.filter((spec) => isOverridden(snapshot.user, spec.key)).length;

      const llmMode = value.mode === 'llm';
      // 只有「模型总结」才显示模型/提示词/输出上限；脚本节选时卡片里只留生成方式。
      const rows = CARD_FIELDS.filter((spec) => spec.key === 'mode' || llmMode).map((spec) => {
        const enriched = Object.assign({}, spec);
        if (spec.key === 'mode' && llmMode !== true) enriched.hintText = t('card.mechanicalHint');
        if (spec.key === 'provider') {
          enriched.options = providerOptions;
          enriched.catalogFailed = catalogFailed;
          enriched.hintText = catalogHint;
        }
        if (spec.key === 'model') {
          enriched.options = modelOptions;
          enriched.catalogFailed = catalogFailed;
          enriched.hintText = catalogHint;
          enriched.locked = providerValue === '';
        }
        return React.createElement(CardField, {
          key: spec.key,
          spec: enriched,
          value: value[spec.key],
          overridden: isOverridden(snapshot.user, spec.key),
          disabled: disabled,
          pending: pendingField === spec.key,
          onCommit: (next) => commit(spec.key, next),
        });
      });

      const status = error !== '' ? t('card.failed') + '：' + error : pendingField !== '' ? t('card.saving') : saved ? t('card.saved') : '';

      return React.createElement(
        'li',
        { className: 'dsch-set-card' + (open ? ' dsch-set-open' : '') },
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsch-set-head',
            'aria-expanded': open,
            'aria-label': t(open ? 'card.close' : 'card.open') + ': ' + t('card.title'),
            onClick: () => setOpen(!open),
          },
          React.createElement(
            'span',
            { className: 'dsch-set-headtext' },
            React.createElement('span', { className: 'dsch-set-name' }, t('card.title')),
            React.createElement('span', { className: 'dsch-set-desc' }, t('card.desc')),
          ),
          React.createElement('span', { className: 'dsch-set-chevron', 'aria-hidden': true }, open ? '\u25be' : '\u25b8'),
        ),
        open
          ? React.createElement(
              'div',
              { className: 'dsch-set-body' },
              snapshot.status !== 'ready' ? React.createElement('p', { className: 'dsch-set-note' }, t('card.loading')) : null,
              snapshot.status === 'ready' && snapshot.writable !== true
                ? React.createElement('p', { className: 'dsch-set-note' }, t('card.readOnly'))
                : null,
              rows,
              React.createElement(
                'div',
                { className: 'dsch-set-foot' },
                React.createElement(
                  'span',
                  { className: 'dsch-set-status', 'data-kind': error !== '' ? 'error' : undefined, role: 'status' },
                  status,
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dsch-set-btn',
                    title: t('card.resetAllTitle'),
                    disabled: disabled || overriddenCount === 0 || pendingField !== '',
                    onClick: resetAll,
                  },
                  t('card.resetAll') + (overriddenCount > 0 ? '（' + overriddenCount + '）' : ''),
                ),
              ),
            )
          : null,
      );
    }

    /** 一行：标签（含提示）+ 控件（+ 覆盖标记与重置）。 */
    function CardField(props) {
      const spec = props.spec;
      const label = t('field.' + spec.key);
      const hint = spec.hintText !== undefined ? spec.hintText : spec.hint === undefined ? undefined : t(spec.hint);
      let control;
      if (spec.kind === 'select') {
        control = React.createElement(
          'select',
          {
            className: 'dsch-set-select',
            value: String(props.value === undefined || props.value === null ? '' : props.value),
            disabled: props.disabled,
            onChange: (event) => props.onCommit(event.target.value),
          },
          spec.options.map((option) => React.createElement('option', { key: option.value, value: option.value }, t(option.label))),
        );
      } else if (spec.kind === 'boolean') {
        control = React.createElement('input', {
          className: 'dsch-set-check',
          type: 'checkbox',
          checked: props.value === true,
          disabled: props.disabled,
          onChange: (event) => props.onCommit(event.target.checked),
        });
      } else if (spec.kind === 'provider' || spec.kind === 'model') {
        if (spec.catalogFailed === true) {
          // 目录读不到时退回手动输入，不至于没法配。
          control = React.createElement(TextControl, {
            value: props.value,
            disabled: props.disabled,
            onCommit: props.onCommit,
          });
        } else {
          control = React.createElement(
            'select',
            {
              className: 'dsch-set-select',
              value: String(props.value === undefined || props.value === null ? '' : props.value),
              disabled: props.disabled || spec.locked === true,
              onChange: (event) => props.onCommit(event.target.value),
            },
            (spec.options === undefined ? [] : spec.options).map((option) =>
              React.createElement('option', { key: option.value, value: option.value }, option.label),
            ),
          );
        }
      } else {
        control = React.createElement(TextControl, {
          numeric: spec.kind === 'number',
          multiline: spec.kind === 'textarea',
          value: props.value,
          disabled: props.disabled,
          onCommit: props.onCommit,
        });
      }
      return React.createElement(
        'div',
        { className: 'dsch-set-field' },
        React.createElement(
          'div',
          { className: 'dsch-set-row' },
          React.createElement('label', { className: 'dsch-set-label' }, label),
          React.createElement(
            'span',
            { className: 'dsch-set-badges' },
            props.pending ? React.createElement('span', { key: 'saving', className: 'dsch-set-badge' }, t('card.saving')) : null,
            props.overridden ? React.createElement('span', { key: 'overridden', className: 'dsch-set-badge' }, t('card.overridden')) : null,
          ),
        ),
        control,
        hint === undefined ? null : React.createElement('p', { className: 'dsch-set-hint' }, hint),
      );
    }
    /** 文本 / 数字输入：本地草稿，失焦或回车才提交。 */
    function TextControl(props) {
      const text = props.value === undefined || props.value === null ? '' : String(props.value);
      const [draft, setDraft] = React.useState(text);
      const [invalid, setInvalid] = React.useState(false);
      React.useEffect(() => {
        setDraft(text);
        setInvalid(false);
      }, [text]);
      const commit = () => {
        const raw = draft.trim();
        if (props.numeric === true) {
          const number = Number(raw);
          if (raw === '' || !Number.isFinite(number) || number <= 0) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          if (number !== props.value) props.onCommit(number);
          return;
        }
        setInvalid(false);
        if (raw !== text) props.onCommit(raw);
      };
      const shared = {
        value: draft,
        disabled: props.disabled,
        title: invalid ? t('card.invalidNumber') : undefined,
        style: invalid ? { borderColor: 'var(--dsw-alias-state-error-primary, #e5484d)' } : undefined,
        onChange: (event) => setDraft(event.target.value),
        onBlur: commit,
      };
      if (props.multiline === true) {
        return React.createElement('textarea', Object.assign({ rows: 8, className: 'dsch-set-textarea' }, shared));
      }
      return React.createElement(
        'input',
        Object.assign(
          {
            className: props.numeric === true ? 'dsch-set-input dsch-set-number' : 'dsch-set-input',
            type: props.numeric === true ? 'number' : 'text',
            onKeyDown: (event) => {
              if (event.key === 'Enter') commit();
            },
          },
          shared,
        ),
      );
    }

    exports.name = NAME;
    exports.apply = apply;
    return module.exports;
  },
});
