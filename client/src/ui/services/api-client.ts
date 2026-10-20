import type {
  CharacterInfo,
  CharacterDetail,
  DiaryEntry,
  MemoryEntry,
  SimulationEvent,
  WorldTimeInfo,
  LocationInfo,
  GameTime,
  MainAreaPointInfo,
  SceneConfigInfo,
  SceneRuntimeInfo,
  TimelineMeta,
  TimelineWithWorld,
  TimelineFrame,
} from "../../types/api";

const API_BASE = "/api";

async function requestJSON<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body.error ? `: ${body.error}` : "";
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(`API ${res.status}${detail}`);
  }
  return res.json();
}

function fetchJSON<T>(path: string): Promise<T> {
  return requestJSON(path);
}

function postJSON<T>(path: string, body?: unknown): Promise<T> {
  return requestJSON(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function deleteJSON<T>(path: string): Promise<T> {
  return requestJSON(path, { method: "DELETE" });
}

function patchJSON<T>(path: string, body?: unknown): Promise<T> {
  return requestJSON(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function putJSON<T>(path: string, body?: unknown): Promise<T> {
  return requestJSON(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export interface WorldInfo {
  worldName: string;
  worldDescription: string;
  originalPrompt?: string;
  currentWorldId?: string | null;
  currentTimelineId?: string | null;
  sceneConfig: SceneConfigInfo;
  sceneRuntime: SceneRuntimeInfo;
  mainAreaPoints?: MainAreaPointInfo[];
  timelineTickCount?: number;
}

export type WorldSource = "user" | "library";

export interface GeneratedWorldSummary {
  id: string;
  worldName: string;
  source: WorldSource;
  isCurrent: boolean;
  timelineCount?: number;
}

export interface GeneratedWorldListResponse {
  currentWorldId: string | null;
  currentTimelineId: string | null;
  worlds: GeneratedWorldSummary[];
  libraryWorlds: GeneratedWorldSummary[];
}

export type CreateJobSizeK = 1 | 2 | 4;

export type CreateJobPhase = 1 | 2 | 3 | 4;

export type CreateJobEvent =
  | { kind: "job_started"; at: number; jobId: string; prompt: string; sizeK: CreateJobSizeK }
  | { kind: "phase"; at: number; phase: CreateJobPhase; label: string }
  | { kind: "step"; at: number; phase: CreateJobPhase; step: string; label: string }
  | { kind: "info"; at: number; label: string }
  | { kind: "world_id"; at: number; worldId: string }
  | { kind: "log"; at: number; stream: "stdout" | "stderr"; line: string }
  | { kind: "job_done"; at: number; worldId: string; worldName?: string }
  | { kind: "job_error"; at: number; message: string; tail: string[] };

export interface CreateJobSnapshot {
  jobId: string;
  status: "running" | "done" | "error";
  prompt: string;
  sizeK: CreateJobSizeK;
  phase: CreateJobPhase | null;
  step: string | null;
  startedAt: number;
  finishedAt: number | null;
  worldId: string | null;
  worldName: string | null;
  error: string | null;
}

export class JobConflictError extends Error {
  activeJobId: string;
  constructor(message: string, activeJobId: string) {
    super(message);
    this.name = "JobConflictError";
    this.activeJobId = activeJobId;
  }
}

export interface EditorCharacter {
  id: string;
  name: string;
  role?: string;
  nickname?: string;
  appearanceHint?: string;
  startPosition?: string;
  coreMotivation?: string;
  speakingStyle?: string;
  [key: string]: unknown;
}

export interface EditorObject {
  id?: number;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: Array<{ name: string; value: unknown }>;
}

export interface EditorState {
  tmj: { width: number; height: number; tileSize: number; collision: number[]; interactiveObjects: EditorObject[] };
  world: { locations?: Array<{ id: string; name: string; objects?: unknown[] }> };
  characters: EditorCharacter[];
}

export const apiClient = {
  getEditorState(): Promise<EditorState> {
    return fetchJSON("/editor/state");
  },

  saveWalkability(grid: number[]): Promise<{ ok: boolean }> {
    return putJSON("/editor/walkability", { grid });
  },

  saveEditorObjects(objects: Array<Record<string, unknown>>): Promise<{ ok: boolean; count: number }> {
    return putJSON("/editor/objects", { objects });
  },

  createEditorCharacter(character: Record<string, unknown>): Promise<{ ok: boolean; character: EditorCharacter }> {
    return postJSON("/editor/characters", { character });
  },

  updateEditorCharacter(id: string, character: Record<string, unknown>): Promise<{ ok: boolean; character: EditorCharacter }> {
    return putJSON(`/editor/characters/${encodeURIComponent(id)}`, { character });
  },

  deleteEditorCharacter(id: string): Promise<{ ok: boolean }> {
    return deleteJSON(`/editor/characters/${encodeURIComponent(id)}`);
  },

  regenerateEditorCharacterSprite(id: string, extraPrompt?: string): Promise<{ ok: boolean }> {
    return postJSON(`/editor/characters/${encodeURIComponent(id)}/regenerate-sprite`, { extraPrompt });
  },

  getWorldTime(): Promise<WorldTimeInfo> {
    return fetchJSON("/world/time");
  },

  getWorldInfo(): Promise<WorldInfo> {
    return fetchJSON("/world/info");
  },

  getGeneratedWorlds(): Promise<GeneratedWorldListResponse> {
    return fetchJSON("/world/worlds");
  },

  getLocations(): Promise<LocationInfo[]> {
    return fetchJSON("/world/locations");
  },

  getCharacters(): Promise<CharacterInfo[]> {
    return fetchJSON("/characters");
  },

  getCharacterDetail(id: string): Promise<CharacterDetail> {
    return fetchJSON(`/characters/${id}`);
  },


  getDiary(id: string, day?: number): Promise<DiaryEntry[]> {
    const q = day != null ? `?day=${day}` : "";
    return fetchJSON(`/characters/${id}/diary${q}`);
  },

  getMemories(id: string): Promise<MemoryEntry[]> {
    return fetchJSON(`/characters/${id}/memories`);
  },

  getEvents(params: {
    fromDay?: number;
    toDay?: number;
    type?: string;
    actorId?: string;
    limit?: number;
    offset?: number;
  }): Promise<SimulationEvent[]> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null) q.set(k, String(v));
    }
    return fetchJSON(`/events?${q}`);
  },

  getEventsByRange(from: GameTime, to: GameTime): Promise<SimulationEvent[]> {
    const q = new URLSearchParams({
      fromDay: String(from.day),
      fromTick: String(from.tick),
      toDay: String(to.day),
      toTick: String(to.tick),
    });
    return fetchJSON(`/events/range?${q}`);
  },

  getHighlights(minScore = 6, limit = 20): Promise<SimulationEvent[]> {
    return fetchJSON(`/events/highlights?minScore=${minScore}&limit=${limit}`);
  },

  simulateTick(context: {
    worldId: string;
    timelineId: string;
  }): Promise<{
    ok: boolean;
    gameTime: WorldTimeInfo;
    eventCount: number;
    events: SimulationEvent[];
    activeSimulationTicks?: number;
    canSwitchContext?: boolean;
  }> {
    return postJSON("/simulation/tick", context);
  },

  simulateDay(): Promise<{ ok: boolean; gameTime: WorldTimeInfo; eventCount: number }> {
    return postJSON("/simulation/day");
  },

  switchWorld(worldId: string): Promise<{
    ok: boolean;
    currentWorldId: string;
    worldName: string;
  }> {
    return postJSON("/world/select", { worldId });
  },

  resetWorld(): Promise<{ ok: boolean; gameTime: WorldTimeInfo }> {
    return postJSON("/simulation/reset");
  },

  setDevTickDurationMinutes(tickDurationMinutes: 15 | 30 | 60): Promise<{
    ok: boolean;
    gameTime: WorldTimeInfo;
    sceneConfig: SceneConfigInfo;
    sceneRuntime: SceneRuntimeInfo;
  }> {
    return postJSON("/world/dev/tick-duration", { tickDurationMinutes });
  },

  godBroadcast(params: {
    content: string;
    scope?: string;
    tone?: string;
    tags?: string[];
    writeMemory?: boolean;
  }): Promise<{ ok: boolean; event: SimulationEvent; memoryWrittenTo: number }> {
    return postJSON("/god/broadcast", params);
  },

  godWhisper(params: {
    characterId: string;
    content: string;
    importance?: number;
    type?: "observation" | "dream" | "reflection" | "experience";
    tags?: string[];
    emotionalValence?: number;
    emotionalIntensity?: number;
  }): Promise<{ ok: boolean; memory: MemoryEntry }> {
    return postJSON("/god/whisper", params);
  },

  sandboxChatStart(params: {
    characterId: string;
    userIdentity?: string;
  }): Promise<{
    ok: boolean;
    sessionId: string;
    character: { id: string; name: string; role: string };
  }> {
    return postJSON("/sandbox/chat/start", params);
  },

  sandboxChatSend(params: {
    sessionId: string;
    message: string;
  }): Promise<{
    ok: boolean;
    reply: string;
    character: { id: string; name: string };
  }> {
    return postJSON("/sandbox/chat/message", params);
  },

  sandboxChatGet(sessionId: string): Promise<{
    ok: boolean;
    sessionId: string;
    characterId: string;
    userIdentity: string;
    history: Array<{ role: "user" | "character"; content: string }>;
  }> {
    return fetchJSON(`/sandbox/chat/${sessionId}`);
  },

  sandboxChatClose(sessionId: string): Promise<{ ok: boolean }> {
    return postJSON("/sandbox/chat/close", { sessionId });
  },

  patchCharacterProfile(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<{ ok: boolean; profile: Record<string, unknown> }> {
    return patchJSON(`/characters/${id}/profile`, patch);
  },

  patchCharacterRuntimeState(
    id: string,
    patch: { mainAreaPointId?: string | null },
  ): Promise<{ ok: boolean; state: Record<string, unknown> }> {
    return patchJSON(`/characters/${id}/runtime-state`, patch);
  },

  async createWorld(params: {
    prompt: string;
    sizeK: CreateJobSizeK;
    keepArtifacts?: boolean;
  }): Promise<{ ok: boolean; jobId: string }> {
    const res = await fetch(`${API_BASE}/worlds/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (res.status === 409) {
      const body = await res.json().catch(() => ({} as Record<string, unknown>));
      throw new JobConflictError(
        typeof body.error === "string" ? body.error : "Generation already running",
        typeof body.activeJobId === "string" ? body.activeJobId : "",
      );
    }
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body.error ? `: ${body.error}` : "";
      } catch {
        // Ignore.
      }
      throw new Error(`API ${res.status}${detail}`);
    }
    return res.json();
  },

  getCurrentJob(): Promise<{ jobId: string | null; snapshot?: CreateJobSnapshot }> {
    return fetchJSON("/worlds/jobs/current");
  },

  getJobStatus(jobId: string): Promise<CreateJobSnapshot> {
    return fetchJSON(`/worlds/jobs/${encodeURIComponent(jobId)}`);
  },

  cancelCreateWorld(jobId: string): Promise<{ ok: boolean }> {
    return postJSON(`/worlds/jobs/${encodeURIComponent(jobId)}/cancel`);
  },

  subscribeJobEvents(
    jobId: string,
    onEvent: (event: CreateJobEvent) => void,
    onError?: (event: Event) => void,
  ): () => void {
    const url = `${API_BASE}/worlds/jobs/${encodeURIComponent(jobId)}/events`;
    const source = new EventSource(url);
    source.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as CreateJobEvent;
        onEvent(parsed);
      } catch (err) {
        console.warn("[api-client] Failed to parse job event:", err);
      }
    };
    if (onError) {
      source.onerror = onError;
    }
    return () => {
      source.close();
    };
  },

  deleteWorld(worldId: string): Promise<{ ok: boolean; deletedWorldId: string }> {
    return deleteJSON(`/world/worlds/${encodeURIComponent(worldId)}`);
  },

  // --- Timeline APIs ---

  getTimelines(): Promise<{ timelines: TimelineMeta[]; currentTimelineId: string | null }> {
    return fetchJSON("/timelines");
  },

  getCurrentTimeline(): Promise<{ timeline: TimelineMeta }> {
    return fetchJSON("/timelines/current");
  },

  createNewTimeline(): Promise<{ ok: boolean; timelineId: string }> {
    return postJSON("/timelines");
  },

  loadTimeline(timelineId: string): Promise<{ ok: boolean }> {
    return postJSON(`/timelines/${encodeURIComponent(timelineId)}/load`);
  },

  deleteTimeline(timelineId: string): Promise<{ ok: boolean }> {
    return deleteJSON(`/timelines/${encodeURIComponent(timelineId)}`);
  },

  getTimelineEvents(timelineId: string): Promise<{ frames: TimelineFrame[] }> {
    return fetchJSON(`/timelines/${encodeURIComponent(timelineId)}/events`);
  },

  getAllTimelinesGrouped(): Promise<{
    groups: TimelineWithWorld[];
    currentTimelineId: string | null;
  }> {
    return fetchJSON("/timelines/all");
  },

  deleteTimelineFromWorld(
    worldId: string,
    timelineId: string,
  ): Promise<{ ok: boolean }> {
    return deleteJSON(
      `/timelines/world/${encodeURIComponent(worldId)}/${encodeURIComponent(timelineId)}`,
    );
  },
};
