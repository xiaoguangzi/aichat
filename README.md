# aichat

本地运行的 AI 聊天工具：自定义 LLM 提供商（OpenAI / Anthropic 协议）、流式输出、MCP 工具、SKILL.md 技能、图片/文件上传。单用户，数据存本地 SQLite。

## 快速开始

要求：Node.js ≥ 24，pnpm（`corepack enable` 或 `npm i -g pnpm`）。

```bash
pnpm install
npm run dev          # 开发：server :3000 + web :5173（打开 http://127.0.0.1:5173）
```

生产模式（单端口）：

```bash
npm run build
npm start            # http://127.0.0.1:3000
```

首次使用：打开 **Settings → Providers & Models** 添加一个 provider（选预设、填 API key），添加一个模型并点 ★ 设为默认，然后回到聊天页发消息。

## 功能

- **后台回复与断线恢复**：生成任务由本地后端执行，打开设置、切换会话、刷新或关闭网页都不会取消生成。重新打开会话时恢复已保存消息、当前回复、工具结果和待审批状态，再继续接收后续内容；临时断线自动重新订阅，不会重复发送提问。点击停止才会主动取消模型请求，已生成内容仍会保存；删除正在生成的会话也会先停止任务。设置页的「Back to chat」返回原会话。本地后端需要保持运行，后端退出或重启后不续跑未完成任务。
- **Provider**：任意 base URL + key。`anthropic` 类型走 Messages API（`/v1/messages`），`openai` 类型走 Chat Completions（`/v1/chat/completions`）。可从 `/models` 拉取模型列表，可测试连接。OpenAI 兼容端有 `stream_options` / `max_completion_tokens` / temperature 兼容开关和 reasoning 方言选择；Anthropic 兼容端可配置 `thinking.display`、effort 参数位置、无签名 thinking 回放和提示缓存。
- **模型 = 能力声明**：Settings 里的每个模型只描述端点“能做什么”——输入模态（图片 / PDF）、是否支持工具、是否会思考、thinking 用哪种写法开（`{type:"adaptive"}` 官方 / `{type:"enabled"}` 网关）、接受哪些档位。这里**不设 effort**：想让模型思考多久是每次对话的选择，不是模型的属性。（`budget_tokens` 已不再发送：当前模型要么弃用要么直接 400，深度一律由 effort 控制。）
- **模型服务**：设置 → 模型服务，左侧选择供应商，右侧管理连接和模型（窄屏使用供应商下拉框）。添加供应商时可选 OpenAI、Anthropic、DeepSeek、OpenRouter、Ollama 模板或自定义；填写名称、协议、API 基础地址和密钥，兼容参数与自定义请求头在「高级设置」中。编辑时密钥留空保留原值，勾选清除才会删除。
- **添加模型**：在供应商下点击「添加模型」，从 API 获取后搜索、批量勾选，或切换「手动添加」填写模型 ID、显示名称和能力。已添加的模型不会重复导入；部分失败可重试剩余模型。能力按供应商说明确认，输出限制和推理档位在模型编辑的高级设置中。列表支持搜索、默认模型设置，并可指定模型测试连接。
- **Reasoning（统一档位，与厂商/协议无关）**：档位 `off | minimal | low | medium | high | xhigh | max` 在**聊天页输入框**里选（🧠 图标），下拉只列出当前模型声明支持的档位。选择立即作用于当前会话，同时成为**新会话的默认**（记住上次选择，初始为 `high`）。每次请求都会发一个明确的档位——不提供「让端点自己决定」：不发 thinking 字段时，Z.AI 这类网关直接报 `[1210] This model always engages in thinking and cannot be disabled`，而肯接受的端点则会尽量少思考。会话里存的档位如果模型不支持，服务端自动落到最接近的（同距优先取更省的那侧）。各 adapter 负责把档位翻译成端点实际参数：
  - Anthropic 协议：模型的 adaptive 开关决定 thinking 怎么开——开 = `thinking:{type:"adaptive"}`（官方 API），关 = `thinking:{type:"enabled"}`（GLM 等网关）；两种写法都会带上 effort，位置由 provider 的 effort 参数决定（官方 `output_config.effort`，网关 `reasoning_effort`），`minimal` 默认映射为 `low`。选 `off` 时 adaptive 模型发 `{type:"disabled"}`，其他端点省略该参数。
  - OpenAI 协议：provider 选 reasoning 方言——`openai`（顶层 `reasoning_effort`）、`openrouter`（嵌套 `reasoning:{effort}`）、`zai`（`thinking:{type}` 对象 + `reasoning_effort`）、`qwen`（`enable_thinking`）、`deepseek`（`thinking:{type:enabled}`，off 不发）。
  - 模型编辑框里的档位表就是 `reasoningMap`：勾上 = 支持（可在右边填端点字面量，如 `max` 实际发 `"high"`），取消勾选 = 该档位不支持（存 `null`，不出现在输入框的选择器里）。取消勾选 `off` = 该端点无法关闭 thinking。
  - 新建模型的默认：Anthropic 协议勾上 thinking（adaptive），OpenAI 协议默认不勾；档位默认全开——不做任何模型名匹配，端点不认的档位由你取消勾选。

  例：智谱 GLM-5.3 系列走 Anthropic 协议时，模型勾上 thinking、关掉 adaptive、取消 `off` 档位，provider 的 effort 参数选 `reasoning_effort`（实测 effort 生效：同一道题 thinking 长度 1188 字 → low 3550 字 → max 6410 字）；走 OpenAI 协议时 provider 方言选 `zai`。
- **流式**：上游 SSE → 服务端统一事件 → 浏览器 SSE，随时可停止。支持 thinking 展示（Anthropic thinking 块含流内 signature 回放；OpenAI 兼容端探测 `reasoning_content` / `reasoning` / `reasoning_text`）。
- **Artifacts**：AI 生成的 HTML、React、SVG、Mermaid、Markdown 和代码作品显示为聊天卡片，点击在右侧打开，顶栏 Artifacts 菜单可重新打开。支持预览/源码、编辑保存新版本、版本切换、复制/下载、全屏与手机宽度预览；底部可发送修改要求（会携带当前版本完整源码，计入模型输入）。生成未结束的代码仅展示源码，完整后运行。详见下节。
- **MCP**：Settings → MCP Servers 添加 stdio / Streamable HTTP / SSE 服务器，或粘贴 Claude Desktop 风格的 `mcpServers` JSON 导入。工具以 `mcp__<server>__<tool>` 暴露给模型，会话设置里可按会话开关。
- **聊天界面**：云海日出背景，搭配暖杏白 / 铜金色主题，侧栏采用雾白 / 鼠尾草绿配色，支持深色模式与窄屏侧栏；首页快捷卡片将提示追加到输入框，编辑后发送。输入框的「联网搜索」直接同步 Exa MCP 的全局 `enabled` 设置并连接 / 断开，重启后保留；多个 Exa 配置会一起切换，其他 MCP 不受影响。按服务器名中的独立 `exa` 段、`exa.ai` 域名或 `exa-mcp-server` 启动包识别；未配置时链接至 MCP 设置，连接异常时单独提示。原有会话 MCP 白名单仍生效，思考档位逻辑保持不变。
- **Skills**：把目录放进 `skills/`（每个含 `SKILL.md`，frontmatter 有 `name` / `description`）。system prompt 只注入索引，模型按需 `skill__load`；用户可用 `/name` 直接触发。`scripts/` 下脚本通过 `skill__run_script` 执行，默认需要在 UI 里点击允许。
- **多模态**：图片（自动缩放到 1568px 内）、PDF（Anthropic 原生 document；OpenAI 端抽文本）、Office 文件（.docx/.xlsx/.pptx 服务端抽成文本，Word 保留标题与表格结构）、文本类文件直接内联。上传按钮按模型声明的输入模态过滤；Office 与文本文件对任何模型都可上传。
- **分组**：侧边栏可建任意命名的分组（📁 按钮）。归类有两种方式：**点击**——会话行 hover 出现的文件夹图标、右键会话、或聊天页顶栏的分组按钮，都会弹出「Move to group」菜单（选分组 / 移出分组 / 新建分组并放进去）；**拖拽**——把会话拖进分组、拖到「Ungrouped」区域即移出；分组可折叠（状态存服务端）、重命名（双击组名或点铅笔）、拖动组头排序。删除分组只删分组本身，里面的会话保留为未分组。每个组头有独立的**组内搜索**（🔍），和顶部搜索一样匹配标题与消息正文，但只在该组内找；搜索期间折叠的分组会自动展开显示命中结果。移动会话不改 `updated_at`，整理时列表顺序不会乱跳。
- **标题模型**：设置 → 通用 → 标题生成模型，可指定其他供应商下已添加的模型；需要自定义模型时先到模型服务添加，再回来选择。未指定时跟随当前聊天模型。只发送首轮问题和回答的前 600 字符，不携带工具，使用模型支持的最低思考档位，输出上限 512 tokens，15 秒超时。模型不可用、被删除或生成失败时以首条消息生成本地标题；已指定的模型失效不会悄悄切回更贵的聊天模型。
- 其他：搜索、导出 Markdown、重新生成、编辑重发、token 用量显示。

## Artifacts

直接对模型说「做一个交互式番茄钟」或「生成一个可预览的 HTML 页面」。OpenAI 和 Anthropic 共用同一份生成规范：

````text
```html artifact id="timer" title="番茄钟"
<!doctype html><html>…完整 HTML/CSS/JS…</html>
```
````

- 支持 `html`、`jsx` / `tsx` / `react`、`svg`、`mermaid`、`markdown` / `md`；其他语言带 `artifact` 标记时作为代码作品。修订时复用 `id`、输出完整源码；没有 ID 的旧 HTML、SVG、JSX/TSX、Mermaid 代码块也可预览，但不会自动合并为同一个作品的版本。普通短代码和未标记的 Markdown 代码块照常显示。
- React 需 `export default` 一个组件，内置 `react`、`react-dom/client`、`lucide-react` 和 `recharts`；支持 TypeScript/JSX。使用原生 CSS 或内联样式，不提供 Tailwind、任意 npm 包、后端服务或 Claude 的 AI 应用 API。不支持的依赖和编译错误会在预览中显示。
- HTML/SVG/React/Mermaid 在 `sandbox="allow-scripts"` 的独立 iframe 中执行，不授予同源权限。CSP 限制 fetch、外部脚本/图片、子框架及表单提交；图片可使用内联 data URL。React 和 Mermaid 运行时本地打包、按需加载，不依赖 CDN。Markdown 使用现有的安全 Markdown/KaTeX 渲染器。
- AI 版本保留在原有消息中；手动编辑单独保存在 SQLite 的 `artifact_edits` 表（`007_artifact_edits.sql`），刷新后仍可选择。保存编辑不修改旧聊天正文，也不自动调用模型；在作品面板发送修改要求时，模型才会收到当前编辑内容。删除会话或编辑重发/重新生成导致原消息删除时，对应手动版本一并清理。
- 下载导出当前源码：HTML/SVG 可独立打开，React 下载 JSX/TSX 源文件，需要对应的 React 环境；Mermaid 下载 `.mmd`。此功能不包含公开发布、云端分享或跨会话作品库。
- 桌面端可拖动消息与作品之间的分隔条调整宽度，本浏览器记住比例；双击恢复默认，聚焦分隔条后可用左右方向键微调。两侧保留最小可用宽度，窄屏继续使用覆盖式面板。
- `pnpm dev` / `pnpm build` 自动构建本地预览运行时；部署仍使用项目原有的单端口生产模式。

## 工具结果与上下文

OpenAI Chat Completions 和 Anthropic Messages 共用结果处理流程。小结果原样返回；超过 1,200 字符的文本原文存入本地 SQLite，便于后续压缩后读回；超过预览预算时，向模型返回可追溯的摘录，不会因为截断而丢掉原始工具文本。

- 单次文本预览上限为 8,000 字符。同一轮并行调用共享 16,000 字符的目标预算，小结果优先原样保留，其他结果公平分配；为了保留可用摘录，每个大结果至少分到 1,200 字符，因此特别多的并行调用可超过总量目标。这些是字符预算，不是精确 token 预算，图片不计入其中。
- 支持识别 Exa 的 `Title/URL/Published/Highlights` 文本列表，以及带 `results` 数组或顶层数组的 JSON 搜索结果。预览按原排名保留最多 8 个来源的标题、链接、日期和摘录，并明确标注省略；其他大文本保留开头、结尾和原文位置。预览不调用另一个模型，不生成可能失真的摘要。
- 模型可使用内置 `context__read_result`，通过 `result_id` 按 `offset/limit` 分页，或用 `query` 做不区分大小写的字面搜索。返回原文位置和 `next_offset`；搜索最多返回 5 处匹配。单页默认 4,000 字符，受单次和并行预算限制。`offset` 为从 0 开始的 UTF-16 位置；分页不会切断 emoji 等代理对。
- 原文仅可在所属会话读取，重启后仍可访问，删除会话时随之清理。编辑、重生成历史不会提前清理原文，以免后续消息中的引用失效。原文仅保留工具实际交给应用的文本，工具自身的输出上限仍然有效。
- 预览在工具执行后生成一次，和工具调用 ID、错误状态一起持久化。预算内的跨轮追问和同一轮工具调用都回放相同内容；已存储的历史消息不会被自动重写，也不做自动会话摘要。工具定义按名称和 schema 对象键稳定排序，但实际启用工具或定义内容发生变化仍会改变请求。
- 工具结果中的图片保留：Anthropic 原生嵌入 `tool_result`；OpenAI 的 `tool` 消息只支持文本，因此在所有并行结果之后附加带调用 ID 标签的用户图片消息。Anthropic 工具结果中的文档也会保留。
- **按预算批量清理旧上下文**：普通追问保留近期工具结果及 Anthropic thinking，避免每轮改写缓存前缀。工具文本与 Anthropic thinking/signature 的累计开销超过 48,000 字符后，在下一条真实用户消息的边界，从最旧的完整轮次开始清理至 16,000 字符目标：去除旧 thinking，折叠超过 1,200 字符的工具结果，保留本地原文读取引用，移除旧工具附件。OpenAI 不回传的 thinking 不计入其预算。媒体按每块 8,000 字符估算权重；这是开销预算，不是精确 token 数或模型上下文窗口检测。
- 清理决策按原始历史中的用户边界重放，重启和追加消息不会让已经清理的结果重新膨胀。当前工具循环始终原样回放；用户消息、assistant 正文及工具调用配对保留。较短结果和占位符可能使 16,000 字符目标无法完全达到；较长的当前循环仍可能超出预算。已有历史中未保存原文的旧结果只能保留开头提示。
- system prompt 引导模型优先复用会话内仍有效的证据，缺失片段优先从本地原文定向检索，避免无必要的重复搜索、抓取和整篇分页；不会通过硬拦截阻止确有需要的再次调用。

默认值在 `apps/server/src/config.ts`；原文表通过 `005_tool_results.sql` 自动迁移。批量清理控制旧工具与思考内容的长期重读费用，但触发清理时仍会改变缓存前缀；不保证上游命中或固定节省比例。正文和当前轮完整重放，超长对话仍可能触及上下文窗口。

## 缓存与用量排查

- Anthropic 提示缓存默认自动：对已确认的 `api.anthropic.com` 和 `zenmux.ai` 发送显式 5 分钟断点（system/工具前缀及最近两条用户消息，最多 3 个），不自动升级为 1 小时缓存。未知兼容网关保留原有请求格式；可在供应商高级设置中强制开启/关闭标记。OpenAI 兼容请求保持自动前缀缓存方式。依据：[Anthropic 缓存文档](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)、[ZenMux 缓存文档](https://zenmux.ai/docs/zh/guide/advanced/prompt-cache.html)。兼容网关最终是否命中由其实现决定。
- 新请求统一统计总输入。OpenAI 使用 `prompt_tokens`；Anthropic 使用 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`，读取流末尾更新和最终 usage。缓存统计缺失显示“缓存未报告”，部分请求有数据时显示 `≥`，不再把缺失当零。旧消息保留原来记录，不回填猜测的数据；网关若漏报缓存字段，Anthropic 输入只能作为已知下限。
- `006_request_diagnostics.sql` 创建本地诊断表，最多保留最近 500 次聊天/标题请求。记录系统、工具、消息及参数的 SHA-256 指纹、原始 usage、请求 ID、状态和耗时；不另存消息正文、工具 schema、密钥或请求头，不额外调用模型。诊断随会话删除。
- `pnpm -C apps/server cache-report [会话ID]` 只读查看最近 100 条记录，比较消息前缀、system/tools/参数变化，并区分统计缺失和明确零命中。标题请求单列。历史请求没有指纹时无法追溯验证上游路由或缓存有效期。

## 目录

```
apps/server   Hono + node:sqlite 后端（src/llm 协议适配、src/agent 工具循环、src/mcp、src/skills）
apps/web      Vite + React 前端
packages/shared  共享类型与 zod schema
skills/       技能目录（放置 SKILL.md 技能）
data/         运行时数据：aichat.db、uploads/
```

环境变量见 `.env.example`（`PORT`、`DATA_DIR`、`SKILLS_DIR`、`LOG_HTTP`）。
HTTP 日志默认只打印写请求、错误和慢请求（≥1s）；`LOG_HTTP=all` 打印全部，`LOG_HTTP=off` 关闭。

## 测试

```bash
npm test          # vitest（协议转换、tool call 累积、skills、agent loop）
npm run typecheck
```
