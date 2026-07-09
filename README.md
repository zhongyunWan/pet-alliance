# PetAlliance 养宠联盟

https://github.com/user-attachments/assets/571e9bbb-1f51-418a-849f-be27d7494c77

PetAlliance 是一个面向宠物主的多智能体宠物护理咨询系统。它把“猫咪不舒服，我该怎么办？”这类焦虑问题，转成带宠物档案、多专家协作、优先级判断和经验沉淀的护理建议。

## 解决的痛点

- **信息碎片化：** 搜索结果、论坛经验和通用 AI 回答经常互相冲突，宠物主很难判断应该先处理医疗风险、饮食调整还是日常护理。
- **缺少宠物上下文：** 年龄、体重、品种、用药状态会影响判断，但普通问答不会持续维护宠物档案。
- **建议不可执行：** 很多回答没有观察窗口、风险边界和下一步动作，宠物主仍然不知道该怎么做。
- **经验无法沉淀：** 一次有效处理经验不能被系统记住，后续相似问题仍然从零开始。

PetAlliance 的目标不是替代兽医，而是帮助宠物主在不确定时更快整理信息、识别风险，并形成可执行的护理方案。

## 产品流程

1. 创建宠物档案，记录姓名、品种、年龄、体重等基础信息。
2. 提交真实养宠问题，例如呕吐、食欲下降、皮肤异常或出差寄养。
3. 医疗、健康、饮食、寄养 Agent 并行分析，再由编排器处理冲突和优先级。
4. 生成结构化建议，包含护理动作、观察重点和风险提醒。
5. 用户反馈建议有效后，系统抽取经验并沉淀到基因库，供后续相似问题复用。

## 核心能力

- **宠物档案：** 让每次咨询都带着具体宠物上下文，而不是泛泛回答。
- **多 Agent 协作：** 不同专业视角并行提出方案，降低单一答案遗漏重点的风险。
- **真实 LLM 咨询链路：** 前端提交问题后调用后端 `/api/consult`，生成结构化建议。
- **反馈闭环：** 用户标记有效后，系统抽取可复用经验。
- **GEP 经验继承：** 后续相似咨询可继承匹配经验，让系统越用越懂宠物。

## 技术架构

- **前端：** React 18、Vite、Tailwind CSS
- **后端：** TypeScript、Express、better-sqlite3
- **LLM：** OpenAI SDK，支持 OpenAI 兼容端点
- **协议：** GEP 基因进化协议、A2A 文件/HTTP 传输

## 快速开始

### 安装

```bash
git clone https://github.com/zhongyunWan/pet-alliance.git
cd pet-alliance
npm install
```

### 配置

创建 `.env` 文件：

```env
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
PORT=3001
```

### 启动

```bash
# 终端 1：后端
npm run dev

# 终端 2：前端
cd web && npx vite --host 0.0.0.0 --port 5174
```

打开 `http://localhost:5174`，前端会将 `/api` 请求代理到 `localhost:3001`。

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/consult` | 发起多 Agent 咨询 |
| `POST` | `/api/feedback` | 提交反馈并沉淀经验 |
| `GET` | `/api/messages/stream` | SSE 智能体事件流 |
| `GET` / `POST` | `/api/pets` | 获取或创建宠物档案 |
| `GET` | `/api/genes` | 查看经验基因库 |
| `GET` | `/api/health` | 健康检查 |

## 素材与许可

演示视频音乐来自 [Pixabay - Product Launch Advertisement Commercial Music by HitsLab](https://pixabay.com/music/future-bass-product-launch-advertisement-commercial-music-301409/)，按 [Pixabay Content License](https://pixabay.com/service/license-summary/) 使用。该曲页面标注 `Content ID Registered`，如发布到 YouTube 等平台需留意平台识别。

## License

MIT
