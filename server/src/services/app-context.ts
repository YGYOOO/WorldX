import { EventEmitter } from "node:events";
import { WorldManager } from "../core/world-manager.js";
import { CharacterManager } from "../core/character-manager.js";
import { LLMClient } from "../llm/llm-client.js";
import { PromptBuilder } from "../llm/prompt-builder.js";
import { SimulationEngine } from "../simulation/simulation-engine.js";
import { DecisionMaker } from "../simulation/decision-maker.js";
import { DialogueGenerator } from "../simulation/dialogue-generator.js";
import { initDatabase, closeDb } from "../store/db.js";
import { reloadConfigs } from "../utils/config-loader.js";
import { TimelineManager } from "./timeline-manager.js";
import type { SceneConfig } from "../types/index.js";
import type { InitFrameCharacter } from "./timeline-manager.js";

export class AppContext {
  worldManager!: WorldManager;
  characterManager!: CharacterManager;
  llmClient!: LLMClient;
  promptBuilder!: PromptBuilder;
  decisionMaker!: DecisionMaker;
  dialogueGenerator!: DialogueGenerator;
  simulationEngine!: SimulationEngine;
  timelineManager = new TimelineManager();

  eventBus = new EventEmitter();

  private worldDirPath?: string;
  private sceneConfigOverride: Partial<SceneConfig> | null = null;
  private _initialized = false;
  private tickEventsHandlerRegistered = false;
  private worldRevision = 0;

  async initialize(worldDirPath?: string): Promise<void> {
    this.worldDirPath = worldDirPath;

    if (worldDirPath) {
      const timelineId = this.timelineManager.initialize(worldDirPath);
      const dbPath = this.timelineManager.getTimelineDbPath(worldDirPath, timelineId);
      initDatabase(dbPath);
      this.rebuildRuntime();
      this.beginRecording();
    } else {
      initDatabase();
      this.buildMinimalRuntime();
    }

    this.registerTickEventsHandler();
    this._initialized = true;
  }

  get hasWorld(): boolean {
    return !!this.worldDirPath;
  }

  getWorldDir(): string | undefined {
    return this.worldDirPath;
  }

  getWorldRevision(): number {
    return this.worldRevision;
  }

  markWorldEdited(): void {
    this.worldRevision += 1;
  }

  switchWorld(worldDirPath: string): void {
    this.timelineManager.stopRecording();
    closeDb();

    this.worldDirPath = worldDirPath;
    reloadConfigs();

    const timelineId = this.timelineManager.initialize(worldDirPath);
    const dbPath = this.timelineManager.getTimelineDbPath(worldDirPath, timelineId);
    initDatabase(dbPath);

    this.rebuildRuntime();
    this.beginRecording();
    this.eventBus.emit("simulation_status", { status: "idle" });
  }

  switchTimeline(timelineId: string): void {
    if (!this.worldDirPath) return;

    this.timelineManager.stopRecording();
    closeDb();

    this.timelineManager.initialize(this.worldDirPath, timelineId);
    const dbPath = this.timelineManager.getTimelineDbPath(this.worldDirPath, timelineId);
    initDatabase(dbPath);

    reloadConfigs();
    this.rebuildRuntime();
    this.beginRecording();
    this.eventBus.emit("simulation_status", { status: "idle" });
  }

  createNewTimeline(): void {
    if (!this.worldDirPath) return;

    this.timelineManager.stopRecording();
    closeDb();

    const newId = this.timelineManager.createTimeline(this.worldDirPath);
    const dbPath = this.timelineManager.getTimelineDbPath(this.worldDirPath, newId);
    initDatabase(dbPath);

    reloadConfigs();
    this.rebuildRuntime();
    this.beginRecording();
    this.eventBus.emit("simulation_status", { status: "idle" });
  }

  resetWorldState(): void {
    this.createNewTimeline();
  }

  setDevTickDurationMinutes(minutes: number): void {
    this.sceneConfigOverride = {
      ...(this.sceneConfigOverride ?? {}),
      tickDurationMinutes: minutes,
    };
    this.createNewTimeline();
  }

  private beginRecording(): void {
    const characters = this.getInitFrameCharacters();
    this.timelineManager.startRecording(characters);
  }

  private getInitFrameCharacters(): InitFrameCharacter[] {
    if (!this.characterManager) return [];
    return this.characterManager.getAllProfiles().map((profile) => {
      const state = this.characterManager.getState(profile.id);
      return {
        id: profile.id,
        name: profile.name,
        location: state?.location ?? "",
        mainAreaPointId: state?.mainAreaPointId ?? null,
      };
    });
  }

  private registerTickEventsHandler(): void {
    if (this.tickEventsHandlerRegistered) return;
    this.tickEventsHandlerRegistered = true;

    this.eventBus.on("tick_events", ({ gameTime, events }) => {
      this.timelineManager.appendTickEvents(gameTime, events);
    });
  }

  private buildMinimalRuntime(): void {
    if (!this.llmClient) {
      this.llmClient = new LLMClient();
    }
    if (!this.promptBuilder) {
      this.promptBuilder = new PromptBuilder();
      this.promptBuilder.initialize();
    }
  }

  private rebuildRuntime(): void {
    this.worldManager = new WorldManager();
    this.worldManager.initialize(this.worldDirPath);
    if (this.sceneConfigOverride) {
      this.worldManager.applySceneConfigOverride(this.sceneConfigOverride);
    }

    this.characterManager = new CharacterManager(this.worldManager);
    this.characterManager.initialize();

    if (!this.llmClient) {
      this.llmClient = new LLMClient();
    }

    this.characterManager.memoryManager.setLLMClient(this.llmClient);

    if (!this.promptBuilder) {
      this.promptBuilder = new PromptBuilder();
      this.promptBuilder.initialize();
    }
    this.promptBuilder.setContentLanguage(this.worldManager.getContentLanguage());

    this.decisionMaker = new DecisionMaker(
      this.llmClient,
      this.promptBuilder,
      this.characterManager,
      this.worldManager,
    );

    this.dialogueGenerator = new DialogueGenerator(
      this.llmClient,
      this.promptBuilder,
      this.characterManager,
      this.worldManager,
    );

    this.simulationEngine = new SimulationEngine(
      this.worldManager,
      this.characterManager,
      this.llmClient,
      this.promptBuilder,
    );
  }
}

export const appContext = new AppContext();
