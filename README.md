# aichat

一个在本地运行的 AI 聊天应用。连接 OpenAI、Anthropic 及兼容接口，在同一个界面中使用不同模型，并通过 MCP 工具、Skills 和可预览的 Artifacts 扩展对话。

基于 React + TypeScript + Hono，使用 SQLite 保存会话和配置，适合个人在自己的电脑上使用。

## 功能一览

- **多模型聊天** — 自定义服务地址和 API Key，获取或手动添加模型，切换模型与思考强度。
- **流式回复** — 展示生成过程与思考内容，支持停止、重新生成、编辑重发和引用回复。
- **后台生成** — 切换会话或关闭网页后，后端继续生成；重新打开可恢复进度。后端需保持运行。
- **Artifacts 工作区** — 预览 HTML、React、SVG、Mermaid 和 Markdown，编辑源码、切换版本、下载作品。
- **MCP 工具** — 接入 stdio、Streamable HTTP 或 SSE 服务，支持导入配置和按会话选择工具服务器。
- **Skills** — 加载 `SKILL.md` 技能，通过斜杠命令调用；技能脚本默认需要用户批准后执行。
- **文件对话** — 支持图片、PDF、Word、Excel、PowerPoint 和文本文件，具体处理方式取决于文件类型及模型能力。
- **会话管理** — 分组、拖拽整理、全文搜索、Markdown 导出，以及可单独配置的标题生成模型。
- **阅读与用量** — Markdown、公式、代码高亮、深色模式、窄屏布局，以及服务端返回的 Token 和缓存用量。

## 快速开始

准备 Node.js **24 或更高版本**、pnpm，以及一个可用的模型 API 或本地兼容服务。

```bash
git clone https://github.com/xiaoguangzi/aichat.git
cd aichat
pnpm install
pnpm build
pnpm start
```

在浏览器打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。

首次使用：

1. 在 **设置 → 模型服务** 中添加供应商，填写 API 基础地址和所需密钥。
2. 从 API 获取模型列表，或手动填写模型 ID，并按端点能力配置图片、工具和思考支持。
3. 设置默认模型，返回聊天页开始对话。

内置 OpenAI、Anthropic、DeepSeek、OpenRouter 和 Ollama 配置模板，也可以自定义连接。模板用于填写连接信息，实际可用能力以所连接的端点为准。

## 使用扩展能力

### Artifacts

试着发送「做一个交互式番茄钟」或「用 React 画一个可调整参数的图表」。生成的作品可以在对话旁预览，也可以编辑源码或继续让模型修改。

React 预览内置 React、Lucide 图标和 Recharts。预览在受限的 iframe 中运行，不支持任意 npm 依赖或外部网络请求。下载的 React 作品是源码，需要在相应的 React 环境中运行。

### MCP

在 **设置 → MCP** 中添加服务器，或导入含 `mcpServers` 的 JSON 配置。使用 stdio 服务时，需要在本机安装对应的运行环境。

配置 Exa MCP 后，可通过输入框的联网搜索开关启用或停用它；搜索需要相应服务的配置和权限。

### Skills

在项目根目录的 `skills/` 下创建技能目录：

```text
skills/
└── my-skill/
    ├── SKILL.md
    └── scripts/       # 可选
```

`SKILL.md` 的最小示例：

```markdown
---
name: my-skill
description: 将给定内容整理为简洁的阅读笔记
---

提取主要观点、关键依据和待确认的问题，使用中文输出。
```

在聊天输入框中使用 `/my-skill` 调用。模型也可以按需加载技能。

### Reasoning

在模型设置中声明端点支持的思考档位，在聊天输入框中选择当前会话的思考强度。支持思考的模型默认使用 `high`；不支持的档位会回退到最近可用档位，不支持思考的模型使用 `off`。

兼容服务对参数的要求可能不同，可在供应商高级设置中调整推理参数格式，在模型设置中调整档位映射。应用通过 OpenAI Chat Completions 或 Anthropic Messages 协议发送请求，不按模型名称猜测能力，也不发送 `budget_tokens`。

## 配置与数据

默认无需创建配置文件。服务端读取进程环境变量，常用选项见 [.env.example](.env.example)：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 服务端监听地址 |
| `PORT` | `3000` | 服务端端口 |
| `DATA_DIR` | 项目根目录下的 `data/` | 数据库和上传文件目录 |
| `SKILLS_DIR` | 项目根目录下的 `skills/` | 技能目录 |
| `LOG_HTTP` | `normal` | 请求日志，可选 `normal`、`all`、`off` |

例如，在 macOS / Linux 中修改生产模式端口：

```bash
PORT=3001 pnpm start
```

`.env.example` 是配置参考，启动命令不会自动加载 `.env`。自定义数据或技能目录时，建议使用绝对路径。

会话、服务配置和密钥保存在本地 SQLite 数据库中，上传文件保存在本地数据目录。备份时先停止服务，再复制整个数据目录；该目录和环境配置已加入 Git 忽略规则。

**本地存储不等于离线推理。** 使用远程模型或工具服务时，对话和相关文件内容会发送到所配置的服务。本应用面向本地单用户使用，未提供登录鉴权；需要远程访问时，应自行配置访问控制。

## 本地开发

```bash
pnpm install
pnpm dev
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。开发模式启动前端和后端，前端将 `/api` 请求代理到本机 `3000` 端口。

```bash
pnpm test        # 运行测试
pnpm typecheck   # TypeScript 类型检查
pnpm build       # 构建前后端及预览运行时
```

项目结构：

```text
apps/web/         React + Vite 前端
apps/server/      Hono 后端、协议适配、工具调用与数据访问
packages/shared/  共享类型与请求校验
skills/           本地技能，首次运行时自动创建
data/             本地运行数据，首次运行时自动创建
```
