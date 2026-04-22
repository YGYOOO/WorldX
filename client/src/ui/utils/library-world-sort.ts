import type { GeneratedWorldSummary } from "../services/api-client";

/** 汴京夜肆 — Chinese-first sample */
const BIANJING_LIBRARY_ID = "world_2026-04-19T08-31-24";
/** Post-Victory Pixel Hamlet — English-first sample */
const POST_VICTORY_LIBRARY_ID = "world_2026-04-19T17-12-41";

/**
 * Order bundled library worlds for the current UI language.
 * Unknown ids keep a stable fallback (server-style id desc).
 */
export function sortLibraryWorldsForLocale(
  worlds: GeneratedWorldSummary[],
  language: string,
): GeneratedWorldSummary[] {
  const isZh = language.toLowerCase().startsWith("zh");
  const priority = isZh
    ? [BIANJING_LIBRARY_ID, POST_VICTORY_LIBRARY_ID]
    : [POST_VICTORY_LIBRARY_ID, BIANJING_LIBRARY_ID];

  const rank = (id: string): number => {
    const i = priority.indexOf(id);
    return i === -1 ? 1000 : i;
  };

  return [...worlds].sort((a, b) => {
    const ra = rank(a.id);
    const rb = rank(b.id);
    if (ra !== rb) return ra - rb;
    return b.id.localeCompare(a.id);
  });
}
