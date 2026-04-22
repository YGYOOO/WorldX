<p align="center">
  <img src="docs/logo.png" alt="WorldX logo:d" width="200" />
</p>
<p align="center">
  <!-- <h1 align="center">WorldX</h1> -->
  <p align="center"><strong>一句话，生成一个鲜活的 AI 世界。</strong></p>
</p>

<p align="center">
  <a href="./README_EN.md">English</a> | 中文
</p>

---

说出你的要求，**WorldX** 会为你构筑一个完整的虚拟世界。
AI 角色们会在这个世界里自主生活：他们做决策、与场景交互、建立关系、开展对话、记忆并思考，涌现出没人提前写好剧本的故事。
你也可以作为"上帝"随时介入 —— 注入事件、编辑角色记忆或人格，看整个世界因此走向何方。

> "北宋汴京的夜市街，有算命的、当铺掌柜、小偷、捕快，还有一个穿越来的现代人"

只需要这一句话，剩下的交给 WorldX。
<table>
<tr>
<td align="center" valign="top" width="50%"><img src="docs/screenshot1.png" alt="WorldX: one-sentence world creation interface" width="400"/></td>
<td align="center" valign="top" width="50%"><img src="docs/screenshot2.png" alt="WorldX: pixel world simulation with character dialogue sidebar" width="400"/></td>
</tr>
</table>

## 特性

- **一句话创造世界** —— 描述任何场景，看着它变为现实
- **AI 生成地图与角色** —— 任何风格，完全按照你的要求生成，不是模板拼接
- **自主 Agent 驱动** —— 生成的世界中，角色自主决策、建立关系、展开对话
- **记忆与人格** —— 角色记住过去的经历，并据此形成独特的行为模式
- **多日演化** —— 支持跨越昼夜循环持续演进
- **上帝模式** —— 广播事件、编辑角色人设/记忆、与角色开展架空对话，观察世界中涌现出哪些有趣的发展
- **时间线系统** —— 同一个世界也可孕育多个不同时间线
- **中英双语** —— 双语支持

<br>   

> 🚧 项目当前处于 Alpha 阶段，核心可用，持续优化中

## 快速开始

### 前置条件

- **Node.js 18+**
- **API Key** —— 详见下方 [模型配置](#模型配置)

### 方式 A：快速运行

想先看看效果？项目内置了两个预生成的世界，配置 **世界驱动** 模型的大模型即可运行。

```bash
git clone https://github.com/YGYOOO/WorldX.git
cd WorldX
cp .env.example .env
# 编辑 .env —— 只填 SIMULATION_* 三行即可
npm install
npm run dev
```

打开 `http://localhost:3200`，选择一个内置世界，点击播放。

### 方式 B：完整创建

从零生成你自己的世界，配齐全部大模型。

```bash
# 编辑 .env —— 填写全部 4 组模型配置
npm run dev
```

打开 `http://localhost:3200/create`，输入一句话，看着你的世界诞生。

也可以用命令行：

```bash
npm run create -- "赛博朋克风格的深夜拉面馆，黑客和仿生人在这里交换情报"
```

## 模型配置

WorldX 使用 **4 个模型角色**，各自独立配置。全部采用 OpenAI 兼容的 `chat/completions` 协议 —— 任何兼容平台均可使用。


| 角色       | 环境变量前缀          | 用途             | 推荐模型                                      |
| -------- | --------------- | -------------- | ----------------------------------------- |
| **编排引擎** | `ORCHESTRATOR_` | 设计世界结构、角色、规则   | 较强推理模型（如 `gemini-3.1-pro-preview`）        |
| **绘图模型** | `IMAGE_GEN_`    | 生成地图美术和角色立绘    | 文生图模型（如 `gemini-3.1-flash-image-preview`） |
| **绘图审查** | `VISION_`       | 审查地图质量、定位区域/元素 | 多模态模型（如 `gemini-3.1-pro-preview`）         |
| **世界驱动** | `SIMULATION_`   | 驱动运行时角色行为      | 任意模型，便宜的就行（如 `gemini-2.5-flash`）          |


每个角色需要 3 个环境变量：

```env
{ROLE}_BASE_URL=https://openrouter.ai/api/v1    # API 地址
{ROLE}_API_KEY=sk-or-v1-xxxx                     # API Key
{ROLE}_MODEL=google/gemini-3.1-pro-preview       # 模型标识
```

### 平台配置示例

<details>
<summary><strong>OpenRouter</strong>（一个 Key 搞定全部模型）</summary>

在 [openrouter.ai](https://openrouter.ai) 获取 Key：

```env
ORCHESTRATOR_BASE_URL=https://openrouter.ai/api/v1
ORCHESTRATOR_API_KEY=sk-or-v1-xxxx
ORCHESTRATOR_MODEL=google/gemini-3.1-pro-preview

IMAGE_GEN_BASE_URL=https://openrouter.ai/api/v1
IMAGE_GEN_API_KEY=sk-or-v1-xxxx
IMAGE_GEN_MODEL=google/gemini-3.1-flash-image-preview

VISION_BASE_URL=https://openrouter.ai/api/v1
VISION_API_KEY=sk-or-v1-xxxx
VISION_MODEL=google/gemini-3.1-pro-preview

SIMULATION_BASE_URL=https://openrouter.ai/api/v1
SIMULATION_API_KEY=sk-or-v1-xxxx
SIMULATION_MODEL=google/gemini-2.5-flash-preview
```

</details>

<details>
<summary><strong>Google AI Studio</strong>（有免费额度）</summary>

在 [aistudio.google.com](https://aistudio.google.com/apikey) 获取 Key：

```env
ORCHESTRATOR_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
ORCHESTRATOR_API_KEY=AIzaSy...
ORCHESTRATOR_MODEL=gemini-3.1-pro-preview

IMAGE_GEN_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
IMAGE_GEN_API_KEY=AIzaSy...
IMAGE_GEN_MODEL=gemini-3.1-flash-image-preview

VISION_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
VISION_API_KEY=AIzaSy...
VISION_MODEL=gemini-3.1-pro-preview

SIMULATION_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
SIMULATION_API_KEY=AIzaSy...
SIMULATION_MODEL=gemini-2.5-flash-preview
```

</details>

<details>
<summary><strong>混合搭配</strong>（不同角色使用不同平台）</summary>

你可以为每个角色使用不同的平台。例如用 Google AI Studio 免费额度来生成，用更便宜的供应商来驱动模拟：

```env
# 世界设计 — Google AI Studio
ORCHESTRATOR_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
ORCHESTRATOR_API_KEY=AIzaSy...
ORCHESTRATOR_MODEL=gemini-3.1-pro-preview

# 美术生成 — Google AI Studio
IMAGE_GEN_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
IMAGE_GEN_API_KEY=AIzaSy...
IMAGE_GEN_MODEL=gemini-3.1-flash-image-preview

# 视觉审查 — Google AI Studio
VISION_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
VISION_API_KEY=AIzaSy...
VISION_MODEL=gemini-3.1-pro-preview

# 模拟运行 — DeepSeek（高频调用更划算）
SIMULATION_BASE_URL=https://api.deepseek.com/v1
SIMULATION_API_KEY=sk-...
SIMULATION_MODEL=deepseek-chat
```

</details>

## 架构  
<img src="docs/chart1.png"/>

## 项目结构
```
WorldX/
├── orchestrator/         # LLM 驱动的世界设计与配置生成
│   ├── src/
│   │   ├── index.mjs           # 管线入口：一句话 → 世界
│   │   ├── world-designer.mjs  # LLM 世界设计
│   │   └── config-generator.mjs
│   └── prompts/
│       └── design-world.md     # 世界设计 prompt 模板
├── generators/           # 美术生成管线
│   ├── map/              # 地图生成（多步骤 + 审查循环）
│   └── character/        # 角色立绘生成（含抠图）
├── server/               # 模拟引擎（Express + SQLite + LLM）
│   └── src/
│       ├── core/         # WorldManager, CharacterManager
│       ├── simulation/   # SimulationEngine, DecisionMaker, DialogueGenerator
│       ├── llm/          # LLMClient, PromptBuilder
│       └── store/        # SQLite 持久化（每时间线独立）
├── client/               # 游戏客户端（Phaser 3 + React 19）
│   └── src/
│       ├── scenes/       # BootScene, WorldScene
│       ├── ui/           # React 覆盖层面板
│       └── systems/      # 相机、寻路、回放
├── shared/               # 共享工具（结构化输出解析）
├── library/worlds/       # 内置示例世界
├── output/worlds/        # 你生成的世界
└── .env.example          # 配置模板
```

## 开发

```bash
npm run dev          # 同时启动客户端和服务器（开发模式）
npm run create       # 通过命令行直接生成新世界
```

- 客户端：`http://localhost:3200`
- 服务器：`http://localhost:3100`

## License

MIT