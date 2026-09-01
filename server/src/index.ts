import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { appContext } from "./services/app-context.js";
import { setupWebSocket } from "./api/websocket.js";

import worldRoutes from "./api/routes/world.js";
import worldsCreateRoutes from "./api/routes/worlds-create.js";
import characterRoutes from "./api/routes/characters.js";
import eventsRoutes from "./api/routes/events.js";
import { createPublicContentRouter } from "./api/routes/content.js";
import simulationRoutes from "./api/routes/simulation.js";
import godRoutes from "./api/routes/god.js";
import sandboxChatRoutes from "./api/routes/sandbox-chat.js";
import timelineRoutes from "./api/routes/timeline.js";
import editorRoutes from "./api/routes/editor.js";
import { resolveInitialWorldDir } from "./utils/world-directories.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function createWorldAssetHandler(assetDirName: "map" | "characters"): express.RequestHandler {
  return (req, res, next) => {
    const worldDir = appContext.getWorldDir();
    if (!worldDir) {
      res.status(404).end();
      return;
    }

    const relativePath = decodeURIComponent(req.path).replace(/^\/+/, "");
    if (!relativePath) {
      res.status(404).end();
      return;
    }

    res.sendFile(relativePath, {
      root: path.join(worldDir, assetDirName),
      dotfiles: "deny",
    }, (error) => {
      if (!error) return;
      const assetError = error as NodeJS.ErrnoException & { status?: number };
      if (res.headersSent) {
        next(assetError);
        return;
      }
      if (assetError.status === 404) {
        res.status(404).end();
        return;
      }
      next(assetError);
    });
  };
}

async function main() {
  const app = express();
  app.use(cors());
  // A 256x256 walkability grid exceeds Express's default 100kb JSON limit.
  app.use(express.json({ limit: "2mb" }));

  const worldDir = resolveInitialWorldDir();
  if (worldDir) {
    console.log(`[WorldX] World dir: ${worldDir}`);
  } else {
    console.log("[WorldX] No generated world found — server starting in empty mode. Navigate to /create to generate your first world.");
  }

  await appContext.initialize(worldDir);
  console.log("[WorldX] All systems initialized");

  app.get("/api/health", (_req, res) => {
    if (!appContext.hasWorld) {
      res.json({ status: "ok", project: "world-x", worldName: null, sceneConfig: null });
      return;
    }
    const wm = appContext.worldManager;
    res.json({
      status: "ok",
      project: "world-x",
      worldName: wm.getWorldName(),
      sceneConfig: wm.getSceneConfig(),
    });
  });

  // World creation & management routes work even without an active world.
  app.use("/api/worlds", worldsCreateRoutes);

  // Guard: all other API routes require an active world to be loaded.
  const requireWorld: express.RequestHandler = (_req, res, next) => {
    if (!appContext.hasWorld) {
      res.status(503).json({ error: "No world loaded. Create one first." });
      return;
    }
    next();
  };

  app.use("/api/world", worldRoutes);
  app.use("/api/characters", requireWorld, characterRoutes);
  app.use("/api/events", requireWorld, eventsRoutes);
  app.use("/api/content", requireWorld, createPublicContentRouter());
  app.use("/api/simulation", requireWorld, simulationRoutes);
  app.use("/api/god", requireWorld, godRoutes);
  app.use("/api/sandbox/chat", requireWorld, sandboxChatRoutes);
  app.use("/api/timelines", timelineRoutes);
  app.use("/api/editor", requireWorld, editorRoutes);

  app.use("/assets/map", createWorldAssetHandler("map"));
  app.use("/assets/characters", createWorldAssetHandler("characters"));

  const clientDistPath = path.resolve("../client/dist");
  const clientIndexPath = path.join(clientDistPath, "index.html");
  if (fs.existsSync(clientDistPath) && fs.existsSync(clientIndexPath)) {
    app.use("/", express.static(clientDistPath));
    app.get("*", (_req, res) => {
      res.sendFile(clientIndexPath);
    });
  }

  const server = createServer(app);
  setupWebSocket(server, appContext);

  const PORT = process.env.PORT || 3100;
  server.listen(PORT, () => {
    console.log(`[WorldX] Server running on http://localhost:${PORT}`);
    console.log(`[WorldX] WebSocket available on ws://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[WorldX] Fatal error during startup:", err);
  process.exit(1);
});
