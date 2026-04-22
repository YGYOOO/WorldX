import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  apiClient,
  JobConflictError,
  type CreateJobEvent,
  type CreateJobPhase,
  type CreateJobSizeK,
  type CreateJobSnapshot,
  type GeneratedWorldSummary,
} from "../services/api-client";
import { CreateWorldBackground } from "./CreateWorldBackground";
import { LanguageToggle } from "../components/LanguageToggle";
import { sortLibraryWorldsForLocale } from "../utils/library-world-sort";

type Mode = "input" | "running" | "done" | "error";

const PROMPT_EXAMPLES = [
  "末日超市：世界末日后，仅存的 6 个幸存者挤在一个封闭的超市里。有公司高管、下岗程序员、大学教授、宅男、退休军人和一个小学生",
  "Doomsday Supermarket: 6 survivors are trapped in a sealed supermarket — a corporate executive, a laid-off programmer, a college professor, a shut-in, a retired soldier, and an elementary school kid.",
  "5个反派被关在了一个无法逃脱的监狱里：容嬷嬷、伏地魔（强大力量被封印）、灭霸（强大力量被封印）、弗利沙（强大力量被封印）、夜神月（死亡笔记丢了）",
  "A cozy mountain village in autumn, with a blacksmith, a tea house owner, a wandering monk and a curious child.",
];

export function CreateWorldPage({
  hasExistingWorlds,
}: {
  hasExistingWorlds: boolean;
}) {
  const { t, i18n } = useTranslation();
  const keepArtifacts = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("dev") === "1";
  }, []);
  const [mode, setMode] = useState<Mode>("input");
  const [prompt, setPrompt] = useState("");
  const [sizeK, setSizeK] = useState<CreateJobSizeK>(2);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<CreateJobSnapshot | null>(null);
  const [events, setEvents] = useState<CreateJobEvent[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [conflictJobId, setConflictJobId] = useState<string | null>(null);
  const [cancelingJob, setCancelingJob] = useState(false);
  const [libraryWorlds, setLibraryWorlds] = useState<GeneratedWorldSummary[]>([]);
  const [loadingSampleWorld, setLoadingSampleWorld] = useState<string | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const sortedLibraryWorlds = useMemo(
    () =>
      sortLibraryWorldsForLocale(
        libraryWorlds,
        i18n.resolvedLanguage || i18n.language || "en",
      ),
    [libraryWorlds, i18n.resolvedLanguage, i18n.language],
  );

  useEffect(() => {
    if (hasExistingWorlds) return;
    let cancelled = false;
    apiClient.getGeneratedWorlds()
      .then((res) => {
        if (cancelled) return;
        setLibraryWorlds(res.libraryWorlds ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [hasExistingWorlds]);

  const onLoadSampleWorld = useCallback(async (worldId: string) => {
    setLoadingSampleWorld(worldId);
    try {
      await apiClient.switchWorld(worldId);
      window.location.assign("/");
    } catch (err) {
      console.warn("[CreateWorldPage] Failed to load sample world:", err);
      setLoadingSampleWorld(null);
    }
  }, []);

  // On mount: if a job is already running, attach to it (covers refresh during generation).
  useEffect(() => {
    let cancelled = false;
    apiClient.getCurrentJob()
      .then((res) => {
        if (cancelled || !res.jobId || !res.snapshot) return;
        if (res.snapshot.status === "running") {
          setJobId(res.jobId);
          setSnapshot(res.snapshot);
          setPrompt(res.snapshot.prompt);
          setSizeK(res.snapshot.sizeK);
          setMode("running");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to job events when we have a jobId.
  useEffect(() => {
    if (!jobId) return;
    const unsubscribe = apiClient.subscribeJobEvents(jobId, (event) => {
      setEvents((prev) => {
        const next = prev.length >= 600 ? prev.slice(prev.length - 500) : prev;
        return [...next, event];
      });
      setSnapshot((prev) => applyEventToSnapshot(prev, event, jobId));
      if (event.kind === "job_done") {
        setCancelingJob(false);
        setMode("done");
      } else if (event.kind === "job_error") {
        setCancelingJob(false);
        setMode("error");
      }
    });
    return unsubscribe;
  }, [jobId]);

  // Auto-scroll log box.
  useEffect(() => {
    if (!logsOpen) return;
    const node = logBoxRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [events, logsOpen]);

  // On success, switch the world server-side and reload to land in the main UI.
  useEffect(() => {
    if (mode !== "done") return;
    if (!snapshot?.worldId) return;
    let cancelled = false;
    (async () => {
      try {
        await apiClient.switchWorld(snapshot.worldId!);
        if (cancelled) return;
        // Tiny delay to let the success animation register.
        setTimeout(() => {
          window.location.assign("/");
        }, 1200);
      } catch (err) {
        if (cancelled) return;
        console.warn("[CreateWorldPage] Failed to switch to new world:", err);
        setSubmitError(
          t("create.switchFailed", { error: err instanceof Error ? err.message : String(err) }),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, snapshot?.worldId]);

  const onSubmit = useCallback(async () => {
    if (!prompt.trim()) {
      setSubmitError(t("create.emptyError"));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setEvents([]);
    setSnapshot(null);
    try {
      const { jobId: id } = await apiClient.createWorld({
        prompt: prompt.trim(),
        sizeK,
        keepArtifacts,
      });
      setJobId(id);
      setCancelingJob(false);
      setMode("running");
    } catch (err) {
      if (err instanceof JobConflictError) {
        setConflictJobId(err.activeJobId);
        setSubmitError(t("create.conflictError"));
      } else {
        setSubmitError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }, [prompt, sizeK, keepArtifacts]);

  const onAttachToConflict = useCallback(() => {
    if (!conflictJobId) return;
    setEvents([]);
    setSnapshot(null);
    setSubmitError(null);
    setJobId(conflictJobId);
    setMode("running");
  }, [conflictJobId]);

  const onRetry = useCallback(() => {
    setMode("input");
    setEvents([]);
    setSnapshot(null);
    setJobId(null);
    setSubmitError(null);
    setConflictJobId(null);
    setCancelingJob(false);
  }, []);

  const onCancelJob = useCallback(async () => {
    if (!jobId || cancelingJob) return;
    setCancelingJob(true);
    try {
      await apiClient.cancelCreateWorld(jobId);
    } catch (err) {
      setCancelingJob(false);
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }, [jobId, cancelingJob]);

  const intensity = mode === "running" ? "active" : "calm";

  return (
    <div style={pageStyle}>
      <CreateWorldBackground intensity={intensity} />
      <div style={contentWrapStyle}>
        <header style={headerStyle}>
          <div style={brandStyle}>
            <span style={brandMarkStyle}>✦</span>
            <span style={brandNameStyle}>{t("create.brand")}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <LanguageToggle />
            {hasExistingWorlds && mode === "input" && (
              <button onClick={() => window.location.assign("/")} style={ghostBtnStyle}>
                {t("create.backToWorld")}
              </button>
            )}
          </div>
        </header>

        {mode === "input" && (
          <InputView
            prompt={prompt}
            setPrompt={setPrompt}
            sizeK={sizeK}
            setSizeK={setSizeK}
            submitting={submitting}
            submitError={submitError}
            conflictJobId={conflictJobId}
            onSubmit={onSubmit}
            onAttachToConflict={onAttachToConflict}
            libraryWorlds={sortedLibraryWorlds}
            loadingSampleWorld={loadingSampleWorld}
            onLoadSampleWorld={onLoadSampleWorld}
          />
        )}

        {(mode === "running" || mode === "done" || mode === "error") && (
          <RunView
            mode={mode}
            snapshot={snapshot}
            events={events}
            logsOpen={logsOpen}
            setLogsOpen={setLogsOpen}
            logBoxRef={logBoxRef}
            sizeK={snapshot?.sizeK ?? sizeK}
            onRetry={onRetry}
            onCancelJob={onCancelJob}
            cancelingJob={cancelingJob}
          />
        )}
      </div>
    </div>
  );
}

function InputView({
  prompt,
  setPrompt,
  sizeK,
  setSizeK,
  submitting,
  submitError,
  conflictJobId,
  onSubmit,
  onAttachToConflict,
  libraryWorlds,
  loadingSampleWorld,
  onLoadSampleWorld,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  sizeK: CreateJobSizeK;
  setSizeK: (value: CreateJobSizeK) => void;
  submitting: boolean;
  submitError: string | null;
  conflictJobId: string | null;
  onSubmit: () => void;
  onAttachToConflict: () => void;
  libraryWorlds: GeneratedWorldSummary[];
  loadingSampleWorld: string | null;
  onLoadSampleWorld: (worldId: string) => void;
}) {
  const { t } = useTranslation();

  const SIZE_OPTIONS: Array<{
    value: CreateJobSizeK;
    label: string;
    estimate: string;
  }> = [
    { value: 1, label: "1K", estimate: "~30–110k tokens" },
    { value: 2, label: "2K", estimate: "~40–130k tokens" },
    { value: 4, label: "4K", estimate: "~50–160k tokens" },
  ];

  return (
    <div style={cardStyle}>
      <h1 style={taglineStyle}>{t("create.tagline")}</h1>
      <p style={subTaglineStyle}>{t("create.subtitle")}</p>

      <label style={labelStyle}>{t("create.promptLabel")}</label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t("create.promptPlaceholder")}
        style={textareaStyle}
        rows={5}
        spellCheck={false}
      />
      <div style={examplesRowStyle}>
        <span style={examplesLabelStyle}>{t("create.tryLabel")}</span>
        {PROMPT_EXAMPLES.map((example, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setPrompt(example)}
            style={exampleChipStyle}
            title={t("create.chipTitle")}
          >
            {truncate(example, 32)}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 24, marginBottom: 8 }}>
        <label style={{ ...labelStyle, marginTop: 0 }}>{t("create.fidelityLabel")}</label>
        <span style={{ fontSize: 11, color: "#7c87ad" }}>{t("create.estTime")}</span>
      </div>
      <div style={sizeGridStyle}>
        {SIZE_OPTIONS.map((opt) => {
          const active = opt.value === sizeK;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSizeK(opt.value)}
              style={sizeOptionStyle(active)}
            >
              <span style={sizeOptionTitleStyle(active)}>{opt.label}</span>
              <span style={sizeOptionEstimateStyle}>{opt.estimate}</span>
            </button>
          );
        })}
      </div>

      {submitError && (
        <div style={errorBoxStyle}>
          <div>{submitError}</div>
          {conflictJobId && (
            <button type="button" onClick={onAttachToConflict} style={attachBtnStyle}>
              {t("create.attachBtn")}
            </button>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 28 }}>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || !prompt.trim()}
          style={primaryBtnStyle(submitting || !prompt.trim())}
        >
          {submitting ? t("create.starting") : t("create.createBtn")}
        </button>
      </div>

      {libraryWorlds.length > 0 && (
        <div style={sampleWorldsSectionStyle}>
          <div style={sampleWorldsDividerStyle}>
            <span style={sampleWorldsDividerLineStyle} />
            <span style={sampleWorldsDividerTextStyle}>{t("create.sampleWorldsOr")}</span>
            <span style={sampleWorldsDividerLineStyle} />
          </div>
          <p style={sampleWorldsSubtitleStyle}>{t("create.sampleWorldsHint")}</p>
          <div style={sampleWorldsGridStyle}>
            {libraryWorlds.map((world) => {
              const isLoading = loadingSampleWorld === world.id;
              return (
                <button
                  key={world.id}
                  type="button"
                  onClick={() => onLoadSampleWorld(world.id)}
                  disabled={loadingSampleWorld !== null}
                  style={sampleWorldCardStyle(isLoading, loadingSampleWorld !== null)}
                >
                  <span style={sampleWorldNameStyle}>{world.worldName}</span>
                  {isLoading && <span style={sampleWorldLoadingStyle}>{t("create.sampleWorldLoading")}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function RunView({
  mode,
  snapshot,
  events,
  logsOpen,
  setLogsOpen,
  logBoxRef,
  sizeK,
  onRetry,
  onCancelJob,
  cancelingJob,
}: {
  mode: Mode;
  snapshot: CreateJobSnapshot | null;
  events: CreateJobEvent[];
  logsOpen: boolean;
  setLogsOpen: (value: boolean) => void;
  logBoxRef: React.RefObject<HTMLDivElement | null>;
  sizeK: CreateJobSizeK;
  onRetry: () => void;
  onCancelJob: () => void;
  cancelingJob: boolean;
}) {
  const { t } = useTranslation();

  const PHASES = [
    { phase: 1 as CreateJobPhase, title: t("create.phase1Title"), hint: t("create.phase1Hint") },
    { phase: 2 as CreateJobPhase, title: t("create.phase2Title"), hint: t("create.phase2Hint") },
    { phase: 3 as CreateJobPhase, title: t("create.phase3Title"), hint: t("create.phase3Hint") },
    { phase: 4 as CreateJobPhase, title: t("create.phase4Title"), hint: t("create.phase4Hint") },
  ];

  const currentPhase = snapshot?.phase ?? 1;
  const currentLabel =
    mode === "done"
      ? t("create.runTitleReady")
      : mode === "error"
      ? t("create.runTitleFailed")
      : t("create.runTitleBuilding");

  const recentMilestones = useMemo(
    () =>
      events
        .filter((e) => e.kind === "phase" || e.kind === "step" || e.kind === "info")
        .slice(-6)
        .reverse(),
    [events],
  );

  const logLines = useMemo(
    () =>
      events.filter((e): e is Extract<CreateJobEvent, { kind: "log" }> => e.kind === "log"),
    [events],
  );

  return (
    <div style={cardStyle}>
      <div style={runHeaderStyle}>
        <div>
          <div style={runEyebrowStyle(mode === "running")}>
            {mode === "done"
              ? t("create.eyebrowComplete")
              : mode === "error"
              ? t("create.eyebrowStopped")
              : t("create.eyebrowGenerating")}
          </div>
          <div style={runTitleStyle}>{currentLabel}</div>
          {snapshot?.prompt && (
            <div style={runPromptStyle}>“{truncate(snapshot.prompt, 160)}”</div>
          )}
        </div>
        {mode === "running" && (
          <div style={sparkSpinnerStyle} aria-hidden>
            ✦
          </div>
        )}
        {mode === "done" && <div style={badgeDoneStyle}>✓</div>}
        {mode === "error" && <div style={badgeErrStyle}>!</div>}
      </div>

      <ol style={stepperStyle}>
        {PHASES.map((p) => {
          const isParallel = p.phase === 2 || p.phase === 3;
          const inParallel = currentPhase === 2 || currentPhase === 3;

          let status: "done" | "active" | "pending" | "error";
          if (mode === "done") {
            status = "done";
          } else if (mode === "error" && (currentPhase === p.phase || (isParallel && inParallel))) {
            status = "error";
          } else if (currentPhase > (isParallel ? 3 : p.phase)) {
            status = "done";
          } else if (isParallel && inParallel) {
            status = "active";
          } else if (currentPhase === p.phase) {
            status = "active";
          } else {
            status = "pending";
          }

          return (
            <li key={p.phase} style={stepperItemStyle}>
              <div style={stepperBulletStyle(status)}>
                {status === "done" ? "✓" : status === "error" ? "!" : p.phase}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={stepperTitleStyle(status)}>{p.title}</div>
                <div style={stepperHintStyle}>{p.hint}</div>
              </div>
            </li>
          );
        })}
      </ol>

      {recentMilestones.length > 0 && (
        <div style={milestonesStyle}>
          {recentMilestones.map((event, idx) => (
            <div
              key={`${event.at}-${idx}`}
              style={milestoneRowStyle(idx === 0)}
            >
              <span style={milestoneTimeStyle}>{formatTime(event.at)}</span>
              <span style={milestoneLabelStyle}>{describeEvent(event, t)}</span>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setLogsOpen(!logsOpen)}
        style={logsToggleStyle}
      >
        {logsOpen ? t("create.hideLogs") : t("create.showLogs")}{" "}
        <span style={{ opacity: 0.6, fontSize: 11 }}>({logLines.length})</span>
      </button>
      {logsOpen && (
        <div ref={logBoxRef} style={logsBoxStyle}>
          {logLines.length === 0 ? (
            <div style={{ opacity: 0.5 }}>{t("create.noLogs")}</div>
          ) : (
            logLines.map((event, idx) => (
              <div
                key={idx}
                style={{
                  color: event.stream === "stderr" ? "#ffb0b0" : "#cfe9ff",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                }}
              >
                {event.line}
              </div>
            ))
          )}
        </div>
      )}

      {mode === "running" && (
        <div style={runFooterControlsStyle}>
          <button
            type="button"
            onClick={onCancelJob}
            disabled={cancelingJob}
            style={stopBtnStyle(cancelingJob)}
          >
            {cancelingJob ? t("create.stopping") : t("create.stop")}
          </button>
        </div>
      )}

      {mode === "running" && (
        <div style={tipStyle}>
          {t("create.tipRunning")}
        </div>
      )}

      {mode === "done" && (
        <div style={{ ...tipStyle, color: "#a3f7bf" }}>
          {t("create.tipSwitching")}
        </div>
      )}

      {mode === "error" && snapshot?.error && (
        <div style={errorBoxStyle}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{snapshot.error}</div>
          {logLines.length > 0 && (
            <pre style={errorTailStyle}>
              {logLines.slice(-20).map((l) => l.line).join("\n")}
            </pre>
          )}
          <button type="button" onClick={onRetry} style={attachBtnStyle}>
            {t("create.retryBtn")}
          </button>
        </div>
      )}
    </div>
  );
}

function applyEventToSnapshot(
  prev: CreateJobSnapshot | null,
  event: CreateJobEvent,
  jobId: string,
): CreateJobSnapshot {
  const base: CreateJobSnapshot =
    prev ?? {
      jobId,
      status: "running",
      prompt: "",
      sizeK: 2,
      phase: null,
      step: null,
      startedAt: Date.now(),
      finishedAt: null,
      worldId: null,
      worldName: null,
      error: null,
    };
  switch (event.kind) {
    case "job_started":
      return {
        ...base,
        prompt: event.prompt,
        sizeK: event.sizeK,
        startedAt: event.at,
        status: "running",
      };
    case "phase":
      return { ...base, phase: event.phase, step: null };
    case "step":
      return { ...base, phase: event.phase, step: event.label };
    case "world_id":
      return { ...base, worldId: event.worldId };
    case "job_done":
      return {
        ...base,
        status: "done",
        finishedAt: event.at,
        worldId: event.worldId || base.worldId,
        worldName: event.worldName ?? base.worldName,
      };
    case "job_error":
      return { ...base, status: "error", finishedAt: event.at, error: event.message };
    default:
      return base;
  }
}

function describeEvent(event: CreateJobEvent, t: (key: string, opts?: Record<string, unknown>) => string): string {
  switch (event.kind) {
    case "phase":
    case "step":
      return t("create.phaseLabel", { phase: event.phase, label: event.label });
    case "info":
      return event.label;
    default:
      return "";
  }
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max - 1)}…`;
}

// ─── Styles ────────────────────────────────────────────────────────────────

const pageStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "transparent",
  color: "#e8ecff",
  fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  overflow: "auto",
  pointerEvents: "auto",
};

const contentWrapStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  minHeight: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "32px 24px 48px",
  gap: 24,
};

const headerStyle: CSSProperties = {
  width: "100%",
  maxWidth: 880,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const brandStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const brandMarkStyle: CSSProperties = {
  fontSize: 22,
  color: "#a3c2ff",
  textShadow: "0 0 14px rgba(116,185,255,0.6)",
};

const brandNameStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: "0.04em",
};

const ghostBtnStyle: CSSProperties = {
  background: "transparent",
  color: "#a3b3da",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 999,
  padding: "8px 14px",
  fontSize: 12,
  cursor: "pointer",
};

const cardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 720,
  background: "rgba(14, 18, 40, 0.78)",
  border: "1px solid rgba(255,255,255,0.08)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  borderRadius: 22,
  padding: "32px 32px 28px",
  boxShadow: "0 30px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(116,185,255,0.06) inset",
};

const taglineStyle: CSSProperties = {
  fontSize: 28,
  margin: 0,
  fontWeight: 700,
  letterSpacing: "0.01em",
  background: "linear-gradient(120deg, #ffffff 0%, #c5d6ff 60%, #f6c0ff 100%)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
};

const subTaglineStyle: CSSProperties = {
  marginTop: 10,
  marginBottom: 28,
  fontSize: 14,
  color: "#a8b3d4",
  lineHeight: 1.6,
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#9aa5cb",
  marginBottom: 8,
};

const textareaStyle: CSSProperties = {
  width: "100%",
  background: "rgba(8, 10, 24, 0.72)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 14,
  color: "#f3f6ff",
  padding: "14px 16px",
  fontSize: 15,
  lineHeight: 1.55,
  resize: "vertical",
  fontFamily: "inherit",
  outline: "none",
  transition: "border-color 0.2s, box-shadow 0.2s",
  boxShadow: "0 0 0 0 rgba(116,185,255,0)",
};

const examplesRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  marginTop: 10,
};

const examplesLabelStyle: CSSProperties = {
  fontSize: 11,
  color: "#7c87ad",
};

const exampleChipStyle: CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#cfd6ee",
  borderRadius: 999,
  padding: "5px 11px",
  fontSize: 11,
  cursor: "pointer",
  transition: "all 0.15s",
};

const sizeGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 12,
};

function sizeOptionStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    background: active
      ? "linear-gradient(135deg, rgba(116,185,255,0.22), rgba(180,134,255,0.18))"
      : "rgba(255,255,255,0.05)",
    border: `1px solid ${active ? "rgba(168,193,255,0.55)" : "rgba(255,255,255,0.1)"}`,
    color: "#e8ecff",
    borderRadius: 14,
    padding: "14px 16px",
    cursor: "pointer",
    textAlign: "left",
    transition: "all 0.2s",
    boxShadow: active ? "0 8px 24px rgba(116,185,255,0.18)" : "none",
  };
}

function sizeOptionTitleStyle(active: boolean): CSSProperties {
  return {
    fontSize: 18,
    fontWeight: 700,
    color: active ? "#ffffff" : "#dde4ff",
  };
}

const sizeOptionDetailStyle: CSSProperties = {
  fontSize: 12,
  color: "#a8b3d4",
};

const sizeOptionEstimateStyle: CSSProperties = {
  fontSize: 11,
  color: "#7c87ad",
};

function primaryBtnStyle(disabled: boolean): CSSProperties {
  return {
    background: disabled
      ? "rgba(255,255,255,0.08)"
      : "linear-gradient(120deg, #74b9ff 0%, #a55bff 100%)",
    color: disabled ? "#a8b3d4" : "#fff",
    border: "none",
    borderRadius: 999,
    padding: "12px 28px",
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "0.02em",
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: disabled ? "none" : "0 12px 30px rgba(116,185,255,0.35)",
    transition: "transform 0.15s",
  };
}

const errorBoxStyle: CSSProperties = {
  marginTop: 18,
  padding: "12px 14px",
  background: "rgba(231,76,60,0.12)",
  border: "1px solid rgba(231,76,60,0.35)",
  borderRadius: 12,
  color: "#ffd2cf",
  fontSize: 13,
  lineHeight: 1.55,
};

const attachBtnStyle: CSSProperties = {
  marginTop: 8,
  background: "transparent",
  border: "1px solid rgba(255,210,207,0.45)",
  color: "#ffd2cf",
  borderRadius: 999,
  padding: "6px 14px",
  fontSize: 12,
  cursor: "pointer",
};

const errorTailStyle: CSSProperties = {
  marginTop: 8,
  padding: "10px 12px",
  background: "rgba(0,0,0,0.35)",
  borderRadius: 8,
  fontSize: 11,
  color: "#ffb0b0",
  maxHeight: 180,
  overflow: "auto",
  whiteSpace: "pre-wrap",
};

// Run view styles

const runHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  marginBottom: 22,
};

function runEyebrowStyle(running: boolean): CSSProperties {
  return {
    fontSize: 11,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    marginBottom: 6,
    fontWeight: 700,
    ...(running
      ? {
          background: "linear-gradient(90deg, #8390b8 0%, #dff3ff 50%, #8390b8 100%)",
          backgroundSize: "200% auto",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          animation: "shimmer-text 3s linear infinite",
        }
      : {
          color: "#8390b8",
        }),
  };
}

const runTitleStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: "#f6f9ff",
};

const runPromptStyle: CSSProperties = {
  marginTop: 8,
  color: "#a8b3d4",
  fontSize: 13,
  fontStyle: "italic",
  maxWidth: 540,
};

const stepperStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: 10,
};

const stepperItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 12px",
  background: "rgba(255,255,255,0.03)",
  borderRadius: 10,
};

function stepperBulletStyle(
  status: "done" | "active" | "pending" | "error",
): CSSProperties {
  const colors: Record<typeof status, { bg: string; color: string; border: string }> = {
    done: { bg: "rgba(76,209,148,0.18)", color: "#a3f7bf", border: "rgba(76,209,148,0.6)" },
    active: { bg: "rgba(116,185,255,0.22)", color: "#dff3ff", border: "rgba(116,185,255,0.7)" },
    pending: { bg: "rgba(255,255,255,0.06)", color: "#7c87ad", border: "rgba(255,255,255,0.12)" },
    error: { bg: "rgba(231,76,60,0.2)", color: "#ffd2cf", border: "rgba(231,76,60,0.6)" },
  };
  const c = colors[status];
  return {
    flex: "0 0 28px",
    width: 28,
    height: 28,
    borderRadius: 999,
    background: c.bg,
    color: c.color,
    border: `1px solid ${c.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 700,
    animation: status === "active" ? "spark-pulse 2s infinite" : "none",
  };
}

function stepperTitleStyle(
  status: "done" | "active" | "pending" | "error",
): CSSProperties {
  return {
    fontSize: 14,
    fontWeight: 600,
    color:
      status === "pending"
        ? "#7c87ad"
        : status === "error"
        ? "#ffd2cf"
        : "#e8ecff",
  };
}

const stepperHintStyle: CSSProperties = {
  fontSize: 12,
  color: "#7c87ad",
  marginTop: 2,
};

const milestonesStyle: CSSProperties = {
  marginTop: 16,
  padding: "10px 12px",
  background: "rgba(0,0,0,0.25)",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.06)",
  fontSize: 12,
  display: "grid",
  gap: 4,
};

function milestoneRowStyle(latest: boolean): CSSProperties {
  return {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    minWidth: 0,
    color: latest ? "#dff3ff" : "#a8b3d4",
    opacity: latest ? 1 : 0.78,
    animation: "slide-up-fade 0.4s ease-out forwards",
  };
}

const milestoneTimeStyle: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  color: "#7c87ad",
  flex: "0 0 64px",
};

const milestoneLabelStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  lineHeight: 1.45,
};

const logsToggleStyle: CSSProperties = {
  marginTop: 16,
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#a8b3d4",
  borderRadius: 999,
  padding: "6px 14px",
  fontSize: 12,
  cursor: "pointer",
};

const logsBoxStyle: CSSProperties = {
  marginTop: 10,
  padding: "12px 14px",
  background: "rgba(0,0,0,0.42)",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.08)",
  maxHeight: 240,
  overflow: "auto",
  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
  fontSize: 11,
  lineHeight: 1.5,
  color: "#cfe9ff",
  wordBreak: "break-all",
  overflowWrap: "anywhere",
  animation: "logs-reveal 0.3s ease-out forwards",
};

const tipStyle: CSSProperties = {
  marginTop: 18,
  fontSize: 12,
  color: "#7c87ad",
  textAlign: "center",
};

const sparkSpinnerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 24,
  color: "#b486ff",
  textShadow: "0 0 12px rgba(180,134,255,0.6)",
  animation: "spin-slow 4s linear infinite",
};

const runFooterControlsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  marginTop: 14,
};

function stopBtnStyle(disabled: boolean): CSSProperties {
  return {
    background: "transparent",
    color: disabled ? "#7782aa" : "#99a7d8",
    border: `1px solid ${disabled ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.14)"}`,
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 11,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.7 : 0.9,
  };
}

const badgeDoneStyle: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 999,
  background: "rgba(76,209,148,0.22)",
  color: "#a3f7bf",
  border: "1px solid rgba(76,209,148,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 18,
  fontWeight: 700,
  animation: "scale-bounce 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards",
};

const badgeErrStyle: CSSProperties = {
  ...badgeDoneStyle,
  background: "rgba(231,76,60,0.2)",
  color: "#ffd2cf",
  border: "1px solid rgba(231,76,60,0.6)",
  animation: "none",
};

// --- Sample Worlds section styles ---

const sampleWorldsSectionStyle: CSSProperties = {
  marginTop: 32,
};

const sampleWorldsDividerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  marginBottom: 14,
};

const sampleWorldsDividerLineStyle: CSSProperties = {
  flex: 1,
  height: 1,
  background: "rgba(255,255,255,0.1)",
};

const sampleWorldsDividerTextStyle: CSSProperties = {
  fontSize: 12,
  color: "#7c87ad",
  whiteSpace: "nowrap",
  letterSpacing: "0.04em",
};

const sampleWorldsSubtitleStyle: CSSProperties = {
  margin: "0 0 14px 0",
  fontSize: 12,
  color: "#7c87ad",
  lineHeight: 1.5,
};

const sampleWorldsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: 10,
};

function sampleWorldCardStyle(isLoading: boolean, anyLoading: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    padding: "14px 16px",
    background: isLoading
      ? "linear-gradient(135deg, rgba(116,185,255,0.22), rgba(180,134,255,0.18))"
      : "rgba(255,255,255,0.04)",
    border: `1px solid ${isLoading ? "rgba(168,193,255,0.55)" : "rgba(255,255,255,0.1)"}`,
    borderRadius: 14,
    cursor: anyLoading ? (isLoading ? "wait" : "not-allowed") : "pointer",
    opacity: anyLoading && !isLoading ? 0.5 : 1,
    transition: "all 0.2s",
    textAlign: "left",
  };
}

const sampleWorldNameStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#e8ecff",
};

const sampleWorldLoadingStyle: CSSProperties = {
  fontSize: 11,
  color: "#a3c2ff",
  marginTop: 2,
};

// Inject keyframes once via a global <style>.
if (typeof document !== "undefined" && !document.getElementById("worldspark-create-keyframes")) {
  const styleEl = document.createElement("style");
  styleEl.id = "worldspark-create-keyframes";
  styleEl.textContent = `
    @keyframes spark-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(116,185,255,0.4); transform: scale(1); }
      70% { box-shadow: 0 0 0 10px rgba(116,185,255,0); transform: scale(1.05); }
      100% { box-shadow: 0 0 0 0 rgba(116,185,255,0); transform: scale(1); }
    }
    @keyframes shimmer-text {
      0% { background-position: -200% center; }
      100% { background-position: 200% center; }
    }
    @keyframes spin-slow {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes slide-up-fade {
      0% { opacity: 0; transform: translateY(10px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes scale-bounce {
      0% { transform: scale(0); }
      50% { transform: scale(1.2); }
      100% { transform: scale(1); }
    }
    @keyframes logs-reveal {
      0% { opacity: 0; transform: translateY(-8px); }
      100% { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(styleEl);
}
