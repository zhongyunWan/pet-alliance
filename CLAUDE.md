# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库工作时提供指导。

## 构建与运行命令

```bash
npm run dev          # 后端开发服务器，热重载（tsx watch，端口 3001）
npm run build        # 编译 TS 后端 + 构建 Vite 前端
npm start            # 运行生产构建（dist/index.js）
npm test             # 使用 Vitest 运行测试
```

前端开发服务器（单独终端）：
```bash
cd web && npx vite --host 0.0.0.0 --port 5174
```

前端将 `/api` 请求代理到 `localhost:3001`。

## 架构

**多智能体宠物护理咨询系统**，采用 5 阶段编排管线：

1. **解析（Parse）** — LLM 从自然语言中提取结构化上下文（紧急程度、症状、相关领域）
2. **基因继承（Gene Inheritance）** — 获取匹配的基因配方，注入智能体提示词
3. **并行提案（Parallel Proposals）** — 仅相关领域的智能体并发生成方案（`Promise.allSettled`）
4. **冲突解决（Conflict Resolution）** — LLM 检测冲突 + 协商（最多 5 轮），优先级：医疗 > 健康 > 饮食 > 寄养
5. **去重（Deduplication）** — Jaccard 相似度过滤，返回前 2 条建议

### 核心组件

- **`src/agents/base.ts`** — 抽象基类 `BaseAgent`，所有领域智能体继承自此（LLM 工具、基因继承、消息总线）
- **`src/orchestrator/petOrchestrator.ts`** — 5 阶段咨询编排管线
- **`src/orchestrator/constraintBus.ts`** — EventEmitter 发布/订阅智能体间消息
- **`src/gep/`** — 基因进化协议：客户端、A2A 桥接（文件 + HTTP 传输）、资产构建器、配方持久化
- **`src/evolution/geneExtractor.ts`** — LLM 驱动的基因提取（从用户反馈）
- **`src/memory/petProfile.ts`** — SQLite 宠物档案存储（better-sqlite3，WAL 模式）
- **`src/utils/llm.ts`** — OpenAI 兼容 LLM 客户端（通过 `.env` 配置）
- **`web/src/App.tsx`** — 单文件 React SPA（中文界面「养宠联盟」）

### API 接口（定义在 `src/index.ts`）

- `POST /api/consult` — 发起多智能体咨询
- `POST /api/feedback` — 提交反馈（触发基因进化）
- `GET /api/messages/stream` — SSE 实时智能体事件流
- `CRUD /api/pets` — 宠物档案管理
- `/api/genes/*` — 基因配方的增删查

## 技术栈

- **后端：** TypeScript (ES2022, ESM)、Express、better-sqlite3
- **前端：** React 18 + Vite、Tailwind CSS (CDN)
- **LLM：** OpenAI SDK，自定义 base URL（通过 `.env` 配置）
- **协议：** GEP（基因进化协议）跨智能体知识共享、A2A 文件/HTTP 传输

## 环境变量

`.env` 需包含：`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`A2A_HUB_URL`、`GEP_NODE_ID`、`EVOMAP_NODE_SECRET`、`PORT`。
