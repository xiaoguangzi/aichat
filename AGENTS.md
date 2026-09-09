# AGENTS.md

本地单用户 AI 聊天工具，支持 OpenAI / Anthropic 协议，数据存本地 SQLite。功能与配置见 README。

## 常用命令

```bash
pnpm install          # Node ≥ 24，使用 pnpm 管理依赖和运行脚本
pnpm dev              # server :3000 + web :5173，/api 代理到 server
pnpm build            # 构建各包
pnpm start            # 生产模式，单端口 :3000
pnpm test             # 运行测试
pnpm typecheck        # TypeScript 类型检查
```

单包操作用 `pnpm -C apps/server <script>`。修改后运行相关测试；协议适配、工具循环和技能的测试位于 `apps/server/test/`。

## 结构与边界

- `apps/server` — Hono + node:sqlite 后端。
  - `src/llm/` — 协议适配层：`adapter.ts` 处理请求与流式输出，`convert.ts` 转换消息格式。协议参数放在此层，不在 routes 中拼装。
  - `src/agent/` — 工具循环、system prompt、工具路由与脚本审批。
  - `src/mcp/`、`src/skills/` — MCP 服务器管理与 SKILL.md 技能注册。
  - `src/routes/` — 路由；`src/db/repos/` — 数据访问。数据库 schema 变更须在 `src/db/migrations/` 新增编号 SQL，保留既有迁移及构建时的迁移复制步骤。
- `apps/web` — React 前端。页面在 `src/pages/`，组件在 `src/components/`，API 封装在 `src/api/`。
- `packages/shared` — 共享类型与 Zod schema；请求校验统一定义在 `src/api.ts`。其他包直接引用其 TS 源码，无需单独构建 shared。
- `skills/` — 运行时技能；`data/` — SQLite 与上传文件，不入库。

## 约定与易错点

- ESM + `verbatimModuleSyntax`：相对导入必须带 `.js` 扩展名（源码里写 `.js` 指向 `.ts` 文件），跨包用 `@aichat/shared`。
- 模型配置声明能力及端点支持的档位（`caps`、`adaptive`、`reasoningMap`）；effort 属于会话（`conversationSettings.reasoning`），不设模型级默认值。
- 档位统一由 `packages/shared/src/reasoning.ts` 的 `resolveReasoningLevel()` 解析：支持思考的模型默认 `high`，不支持的档位回退到最近可用档位；不支持思考或无可用档位时返回 `off`。实际发送或省略哪些参数由 adapter 和 provider `compat` 决定，不做模型名匹配，不发送 `budget_tokens`。修改前阅读 README「Reasoning」一节及 `providerCompatSchema`。
- provider 的 API key 属于 `ProviderSecret`，不要把它混入会回传给前端的普通 provider 对象。
- 会话设置定义在 `conversationSettingsSchema`；更新时，允许传 `null` 的字段用它清除设置，`undefined` 表示不修改。
- 环境变量见 `.env.example`。
