import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Router, type Response } from "express";
import { appContext } from "../../services/app-context.js";
import { beginWorldEdit, isSimulationBusy } from "../../services/simulation-activity.js";
import { generateId } from "../../utils/id-generator.js";
import { getDb } from "../../store/db.js";

const router = Router();
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

type TmjLayer = { name?: string; type?: string; data?: number[]; objects?: unknown[] };
type Tmj = { width: number; height: number; tilewidth: number; layers: TmjLayer[]; nextobjectid?: number };

function currentWorldDir(): string {
  const worldDir = appContext.getWorldDir();
  if (!worldDir) throw new Error("No world loaded");
  return worldDir;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function backupFiles(worldDir: string, files: string[]): string {
  const backupDir = path.join(worldDir, "editor-backups", new Date().toISOString().replace(/[:.]/g, "-"));
  for (const relativePath of files) {
    const source = path.join(worldDir, relativePath);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(backupDir, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
  }
  return backupDir;
}

function getTmj(worldDir: string): Tmj {
  return readJson<Tmj>(path.join(worldDir, "map", "06-final.tmj"));
}

function getLayer(tmj: Tmj, name: string): TmjLayer {
  const layer = tmj.layers.find((candidate) => candidate.name === name);
  if (!layer) throw new Error(`TMJ layer not found: ${name}`);
  return layer;
}

function reloadWorld(): void {
  const worldDir = currentWorldDir();
  appContext.switchWorld(worldDir);
  appContext.markWorldEdited();
  appContext.eventBus.emit("editor_reload");
}

function getObjectId(object: unknown): string | null {
  const properties = (object as { properties?: Array<{ name?: string; value?: unknown }> })?.properties;
  const value = properties?.find((property) => property.name === "objectId")?.value;
  return typeof value === "string" ? value : null;
}

async function waitForSimulationIdle(res: Response): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (isSimulationBusy() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!isSimulationBusy()) return true;
  res.status(409).json({ error: "Simulation is still running after 60 seconds. Pause it and try again." });
  return false;
}

async function withWorldEditLock<T>(res: Response, operation: () => Promise<T> | T): Promise<T | undefined> {
  const finishEdit = beginWorldEdit();
  if (!finishEdit) {
    res.status(409).json({ error: "Another editor change is already being applied. Please wait." });
    return undefined;
  }
  try {
    if (!await waitForSimulationIdle(res)) return undefined;
    return await operation();
  } finally {
    finishEdit();
  }
}

router.get("/state", (_req, res) => {
  try {
    const worldDir = currentWorldDir();
    const tmj = getTmj(worldDir);
    const charactersDir = path.join(worldDir, "config", "characters");
    const characters = fs.existsSync(charactersDir)
      ? fs.readdirSync(charactersDir).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(charactersDir, name)))
      : [];
    res.json({
      tmj: {
        width: tmj.width,
        height: tmj.height,
        tileSize: tmj.tilewidth,
        collision: getLayer(tmj, "collision").data ?? [],
        interactiveObjects: getLayer(tmj, "interactive_objects").objects ?? [],
      },
      world: readJson(path.join(worldDir, "config", "world.json")),
      characters,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.put("/objects", async (req, res) => {
  try {
    await withWorldEditLock(res, () => {
      const worldDir = currentWorldDir();
      const objects = req.body?.objects;
      if (!Array.isArray(objects)) {
        res.status(400).json({ error: "objects must be an array" });
        return;
      }
      const ids = new Set<string>();
      for (const object of objects) {
        if (!object || typeof object.id !== "string" || !/^[a-z][a-z0-9_]*$/i.test(object.id) || ids.has(object.id)) {
          res.status(400).json({ error: "Each object needs a unique id using letters, numbers, or underscores" });
          return;
        }
        ids.add(object.id);
        if (![object.x, object.y, object.width, object.height].every((value) => typeof value === "number" && Number.isFinite(value)) || object.width <= 0 || object.height <= 0) {
          res.status(400).json({ error: `Object ${object.id} has an invalid rectangle` });
          return;
        }
      }
      backupFiles(worldDir, ["map/06-final.tmj", "map/06-elements-scaled.json", "config/world.json"]);
      const tmj = getTmj(worldDir);
      const layer = getLayer(tmj, "interactive_objects");
      const previousIds = new Set((layer.objects ?? []).map(getObjectId).filter(Boolean) as string[]);
      let nextObjectId = 1;
      layer.objects = objects.map((object) => ({
        id: nextObjectId++, name: object.name || object.id, type: "", x: object.x, y: object.y,
        width: object.width, height: object.height, rotation: 0, visible: true,
        properties: [{ name: "objectId", type: "string", value: object.id }],
      }));
      tmj.nextobjectid = Math.max(tmj.nextobjectid ?? 1, nextObjectId);
      writeJsonAtomic(path.join(worldDir, "map", "06-final.tmj"), tmj);
      writeJsonAtomic(path.join(worldDir, "map", "06-elements-scaled.json"), objects.map((object) => ({
        ...object, topLeft: { x: object.x, y: object.y }, bottomRight: { x: object.x + object.width, y: object.y + object.height },
      })));
      const world = readJson<any>(path.join(worldDir, "config", "world.json"));
      for (const location of world.locations ?? []) {
        location.objects = (location.objects ?? []).filter((object: any) => !previousIds.has(object.id));
      }
      for (const object of objects) {
        const location = (world.locations ?? []).find((candidate: any) => candidate.id === object.locationId) ?? world.locations?.[0];
        if (!location) continue;
        location.objects = location.objects ?? [];
        location.objects.push({ id: object.id, name: object.name || object.id, locationId: location.id, defaultState: "available", capacity: Math.max(1, Number(object.capacity) || 1), interactions: object.interactions ?? [] });
      }
      writeJsonAtomic(path.join(worldDir, "config", "world.json"), world);
      if (previousIds.size > 0) {
        const placeholders = [...previousIds].map(() => "?").join(", ");
        getDb().prepare(`DELETE FROM world_object_states WHERE object_id IN (${placeholders})`).run(...previousIds);
      }
      reloadWorld();
      res.json({ ok: true, count: objects.length });
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/characters", async (req, res) => {
  try {
    await withWorldEditLock(res, () => {
      const worldDir = currentWorldDir();
      const character = req.body?.character;
      if (!character || typeof character.name !== "string" || !character.name.trim()) {
        res.status(400).json({ error: "Character name is required" });
        return;
      }
      const world = readJson<any>(path.join(worldDir, "config", "world.json"));
      const startPosition = typeof character.startPosition === "string" && character.startPosition ? character.startPosition : world.locations?.[0]?.id || "main_area";
      const profile = {
        id: `char_${generateId()}`, name: character.name.trim(), role: String(character.role || "NPC"), nickname: String(character.nickname || character.name).trim(),
        appearanceHint: String(character.appearanceHint || ""), startPosition, coreMotivation: String(character.coreMotivation || "在这个世界中过好自己的生活"),
        coreValues: [], speakingStyle: String(character.speakingStyle || "自然、贴近角色设定"), fears: [], preferredLocations: [startPosition], preferredActivities: [],
        socialStyle: "introvert_selective", extraversionLevel: 5, intuitionLevel: 5, skills: [], writeDiary: true, fourthWallCandidate: false, tags: [], initialMemories: [],
      };
      backupFiles(worldDir, ["config/characters"]);
      const charactersDir = path.join(worldDir, "config", "characters");
      fs.mkdirSync(charactersDir, { recursive: true });
      writeJsonAtomic(path.join(charactersDir, `${profile.id}.json`), profile);
      reloadWorld();
      res.json({ ok: true, character: profile });
    });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.put("/characters/:id", async (req, res) => {
  try {
    await withWorldEditLock(res, () => {
      const worldDir = currentWorldDir();
      const filePath = path.join(worldDir, "config", "characters", `${req.params.id}.json`);
      if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Character not found" }); return; }
      const character = readJson<any>(filePath);
      const patch = req.body?.character ?? {};
      for (const key of ["name", "role", "nickname", "appearanceHint", "startPosition", "coreMotivation", "speakingStyle"]) {
        if (key in patch) character[key] = patch[key];
      }
      backupFiles(worldDir, [`config/characters/${req.params.id}.json`]);
      writeJsonAtomic(filePath, character);
      reloadWorld();
      res.json({ ok: true, character });
    });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.delete("/characters/:id", async (req, res) => {
  try {
    await withWorldEditLock(res, () => {
      const worldDir = currentWorldDir();
      const id = req.params.id;
      const configPath = path.join(worldDir, "config", "characters", `${id}.json`);
      if (!fs.existsSync(configPath)) { res.status(404).json({ error: "Character not found" }); return; }
      backupFiles(worldDir, [`config/characters/${id}.json`, `characters/${id}`]);
      fs.rmSync(configPath);
      fs.rmSync(path.join(worldDir, "characters", id), { recursive: true, force: true });
      const db = getDb();
      db.transaction(() => {
        db.prepare("DELETE FROM character_states WHERE character_id = ?").run(id);
        db.prepare("DELETE FROM memories WHERE character_id = ?").run(id);
        db.prepare("DELETE FROM diary_entries WHERE character_id = ?").run(id);
      })();
      reloadWorld();
      res.json({ ok: true });
    });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.post("/characters/:id/regenerate-sprite", async (req, res) => {
  try {
    await withWorldEditLock(res, async () => {
      const worldDir = currentWorldDir();
      const id = req.params.id;
      const profilePath = path.join(worldDir, "config", "characters", `${id}.json`);
      if (!fs.existsSync(profilePath)) { res.status(404).json({ error: "Character not found" }); return; }
      const profile = readJson<any>(profilePath);
      const extra = typeof req.body?.extraPrompt === "string" ? req.body.extraPrompt.trim() : "";
      const tempDir = path.join(worldDir, ".sprite-regeneration", `${id}-${Date.now()}`);
      const script = path.join(PROJECT_ROOT, "generators", "character", "src", "index.mjs");
      const description = [profile.appearanceHint || profile.role, extra].filter(Boolean).join("。 ");
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [script, description, "--name", profile.name, "--role", profile.role], { cwd: PROJECT_ROOT, env: { ...process.env, CHAR_OUTPUT_DIR: tempDir }, stdio: "ignore" });
        child.once("error", reject);
        child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Sprite generation exited with code ${code}`)));
      });
      const source = fs.readdirSync(tempDir, { withFileTypes: true }).find((entry) => entry.isDirectory());
      if (!source) throw new Error("Sprite generation did not produce an asset directory");
      const sourceDir = path.join(tempDir, source.name);
      if (!fs.existsSync(path.join(sourceDir, "spritesheet.png")) || !fs.existsSync(path.join(sourceDir, "metadata.json"))) throw new Error("Generated sprite output is incomplete");
      backupFiles(worldDir, [`characters/${id}`]);
      const targetDir = path.join(worldDir, "characters", id);
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(targetDir), { recursive: true });
      fs.renameSync(sourceDir, targetDir);
      const metadata = readJson<any>(path.join(targetDir, "metadata.json"));
      metadata.id = id; metadata.name = profile.name;
      writeJsonAtomic(path.join(targetDir, "metadata.json"), metadata);
      fs.rmSync(tempDir, { recursive: true, force: true });
      appContext.markWorldEdited();
      res.json({ ok: true });
    });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.put("/walkability", async (req, res) => {
  try {
    await withWorldEditLock(res, () => {
    const worldDir = currentWorldDir();
    const grid = req.body?.grid;
    const tmj = getTmj(worldDir);
    const expectedLength = tmj.width * tmj.height;
    if (!Array.isArray(grid) || grid.length !== expectedLength || grid.some((value) => value !== 0 && value !== 1)) {
      res.status(400).json({ error: `grid must contain exactly ${expectedLength} cells with values 0 or 1` });
      return;
    }
    if (!grid.includes(0)) {
      res.status(400).json({ error: "At least one walkable cell is required" });
      return;
    }
    backupFiles(worldDir, ["map/05-walkable-grid.json", "map/06-final.tmj"]);
    getLayer(tmj, "collision").data = grid;
    writeJsonAtomic(path.join(worldDir, "map", "06-final.tmj"), tmj);
    const rows = Array.from({ length: tmj.height }, (_, y) => grid.slice(y * tmj.width, (y + 1) * tmj.width));
    writeJsonAtomic(path.join(worldDir, "map", "05-walkable-grid.json"), { gridWidth: tmj.width, gridHeight: tmj.height, grid: rows });
    reloadWorld();
    res.json({ ok: true });
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
