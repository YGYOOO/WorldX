<p align="center">
  <img src="docs/logo.png" alt="WorldX logo: pixel-art infinity symbol transitioning from nature to digital grid" width="200" />
</p>

<p align="center">
  <!-- <h1 align="center">WorldX</h1> -->
  <p align="center"><strong>One sentence, One living world.</strong></p>
</p>

<p align="center">
  English | <a href="./README.md">中文</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/Phaser-3-cdf0e8?logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTEyIDJMMiAyMmgyMEwxMiAyeiIgZmlsbD0iIzMzMyIvPjwvc3ZnPg==" alt="Phaser 3">
  <img src="https://img.shields.io/badge/Status-Alpha-orange" alt="Alpha">
  <img src="https://img.shields.io/badge/PRs-Welcome-brightgreen.svg" alt="PRs Welcome">
</p>

<p align="center">
  <code>AI Agents</code> · <code>LLM</code> · <code>Procedural Generation</code> · <code>Simulation</code> · <code>Emergent Narrative</code>
</p>

---

**WorldX** turns a single text prompt into a fully autonomous AI world. The system designs the world, generates original maps and character art, then runs a living simulation where AI agents make decisions, form relationships, have conversations, and create emergent narratives — all without human intervention.

> "A cozy autumn mountain village with a blacksmith, a tavern owner, a wandering monk, and a curious child"

That's all it takes. WorldX handles the rest.

## Highlights

- **One-sentence world creation** — describe any scenario and watch it materialize
- **AI-generated maps & characters** — original art created to match your description, not templates
- **Autonomous agent simulation** — characters make decisions, form relationships, hold conversations
- **Memory & personality** — agents remember past events and act according to distinct personalities
- **Multi-day evolution** — worlds evolve across day/night cycles with scene transitions
- **God mode** — broadcast events, edit character profiles/memories, run sandbox chats with characters, and observe emergent developments
- **Timeline system** — branch, replay, and compare different simulation runs
- **Bilingual UI** — Chinese / English interface with one-click switching

<table>
<tr>
<td align="center" valign="top" width="50%"><img src="docs/screenshot1_en.png" alt="WorldX: one-sentence world creation interface" width="400"/></td>
<td align="center" valign="top" width="50%"><img src="docs/screenshot2_en.png" alt="WorldX: pixel world simulation with character dialogue sidebar" width="400"/></td>
</tr>
</table>
<br>   

> 🚧 The project is currently in Alpha — core features work, ongoing improvements ahead

## Quick Start

### Prerequisites

- **Node.js 18+**
- **API keys** — see [Model Configuration](#model-configuration) below

### Option A: Preview Mode (fastest)

Just want to see WorldX in action? Two pre-built worlds are included. You only need a **Simulation** model key.

```bash
git clone https://github.com/YGYOOO/WorldX.git
cd WorldX
cp .env.example .env
# Edit .env — fill in SIMULATION_* fields only
npm install
npm run dev
```

Open `http://localhost:3200` — pick a pre-built world and hit Play.

### Option B: Full Creation

Generate your own worlds from scratch. Requires all 4 model keys.

```bash
# Edit .env — fill in all 4 model sections
npm run dev
```

Open `http://localhost:3200/create`, type a sentence, and watch your world come to life.

Or use the CLI:

```bash
npm run create -- "A cyberpunk noodle shop where hackers and androids share rumors"
```

## Model Configuration

WorldX uses **4 model roles**, each configurable independently. All use the OpenAI-compatible `chat/completions` protocol — any compatible platform works.

| Role | Env Prefix | What It Does | Recommended |
|------|-----------|-------------|-------------|
| **Orchestrator** | `ORCHESTRATOR_` | Designs world structure, characters, rules | Strong reasoning model (e.g. `gemini-3.1-pro-preview`) |
| **Image Gen** | `IMAGE_GEN_` | Generates map art and character sprites | Image-capable model (e.g. `gemini-3.1-flash-image-preview`) |
| **Vision** | `VISION_` | Reviews map quality, locates regions/elements | Strong multimodal model (e.g. `gemini-3.1-pro-preview`) |
| **Simulation** | `SIMULATION_` | Drives runtime character behavior | Any model — cheaper is fine (e.g. `gemini-2.5-flash`) |

Each role needs 3 env vars:

```env
{ROLE}_BASE_URL=https://openrouter.ai/api/v1    # API base URL
{ROLE}_API_KEY=sk-or-v1-xxxx                     # API key
{ROLE}_MODEL=google/gemini-3.1-pro-preview       # Model identifier
```

### Platform Examples

<details>
<summary><strong>OpenRouter</strong> (recommended — one key for all models)</summary>

Get a key at [openrouter.ai](https://openrouter.ai):

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
<summary><strong>Google AI Studio</strong> (free tier available)</summary>

Get a key at [aistudio.google.com](https://aistudio.google.com/apikey):

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
<summary><strong>Mix & match</strong> (different platforms per role)</summary>

You can use a different platform for each role. For example, Google AI Studio for generation (free tier) and a cheaper provider for simulation:

```env
# World design — Google AI Studio
ORCHESTRATOR_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
ORCHESTRATOR_API_KEY=AIzaSy...
ORCHESTRATOR_MODEL=gemini-3.1-pro-preview

# Art generation — Google AI Studio
IMAGE_GEN_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
IMAGE_GEN_API_KEY=AIzaSy...
IMAGE_GEN_MODEL=gemini-3.1-flash-image-preview

# Vision review — Google AI Studio
VISION_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
VISION_API_KEY=AIzaSy...
VISION_MODEL=gemini-3.1-pro-preview

# Simulation — DeepSeek (cost-effective for high-volume runtime calls)
SIMULATION_BASE_URL=https://api.deepseek.com/v1
SIMULATION_API_KEY=sk-...
SIMULATION_MODEL=deepseek-chat
```

</details>

## Architecture
<img src="docs/chart1_en.png"/>
<img src="docs/chart2_en.png"/>

## Project Structure

```
WorldX/
├── orchestrator/         # LLM-driven world design & config generation
│   ├── src/
│   │   ├── index.mjs           # Pipeline entry: sentence → world
│   │   ├── world-designer.mjs  # LLM world design
│   │   └── config-generator.mjs
│   └── prompts/
│       └── design-world.md     # World design prompt template
├── generators/           # Art generation pipelines
│   ├── map/              # Map generation (multi-step with review loop)
│   └── character/        # Spritesheet generation (with chromakey)
├── server/               # Simulation engine (Express + SQLite + LLM)
│   └── src/
│       ├── core/         # WorldManager, CharacterManager
│       ├── simulation/   # SimulationEngine, DecisionMaker, DialogueGenerator
│       ├── llm/          # LLMClient, PromptBuilder
│       └── store/        # SQLite persistence (per-timeline)
├── client/               # Game client (Phaser 3 + React 19)
│   └── src/
│       ├── scenes/       # BootScene, WorldScene
│       ├── ui/           # React overlay panels
│       └── systems/      # Camera, Pathfinding, Playback
├── shared/               # Shared utilities (structured output parsing)
├── library/worlds/       # Pre-built example worlds
├── output/worlds/        # Your generated worlds
└── .env.example          # Configuration template
```

## Development

```bash
npm run dev          # Start both client and server in dev mode
npm run create       # Generate a new world via CLI
```

- Client: `http://localhost:3200`
- Server: `http://localhost:3100`


## Thanks
-  [LinuxDO](https://linux.do/)

## License

MIT
