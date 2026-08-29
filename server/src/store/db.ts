import type { DatabaseSync as DatabaseSyncType, StatementSync } from "node:sqlite";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

/**
 * 数据库兼容层：
 * 使用 Node.js 内置的 node:sqlite 模块（真 SQLite，随 Node 二进制自带），
 * 替代 better-sqlite3 —— 安装依赖时无需编译任何原生模块、无需下载二进制。
 *
 * 对外提供与 better-sqlite3 一致的 prepare / exec / pragma / transaction / close
 * 语义，其余业务代码（store/* 等）无需任何改动。
 *
 * 环境要求：Node.js >= 22.13（22.x 线上 node:sqlite 直到 22.13.0 才脱离
 * --experimental-sqlite 标志；23.x 线需 >= 23.4.0）。推荐 24 LTS。
 *
 * 注意 node:sqlite 只能惰性加载：静态 import 会在模块解析阶段就失败，
 * 让下方的版本检查永远来不及执行，用户只能看到 ERR_UNKNOWN_BUILTIN_MODULE。
 */

/** node:sqlite 脱离实验标志的最低版本，按 Node 主版本线区分。 */
const MIN_NODE_BY_MAJOR: Record<number, [major: number, minor: number, patch: number]> = {
  22: [22, 13, 0],
  23: [23, 4, 0],
};

function assertSqliteSupported(): void {
  const [major = 0, minor = 0, patch = 0] = process.versions.node.split(".").map(Number);
  if (major >= 24) return;

  const required = MIN_NODE_BY_MAJOR[major];
  const supported =
    required !== undefined &&
    (minor > required[1] || (minor === required[1] && patch >= required[2]));

  if (!supported) {
    throw new Error(
      `[WorldX] 当前 Node.js 版本为 ${process.versions.node}，但内置 node:sqlite 需要 ` +
        `Node.js 22.13+（或 24 LTS，推荐）。22.5 ~ 22.12 期间该模块仍在 ` +
        `--experimental-sqlite 标志之后，无法使用。请升级 Node.js 后重试。`,
    );
  }
}

type SqliteModule = typeof import("node:sqlite");

let sqliteModule: SqliteModule | null = null;

/** 惰性加载 node:sqlite，确保版本检查先于模块解析发生。 */
function loadSqlite(): SqliteModule {
  if (!sqliteModule) {
    assertSqliteSupported();
    sqliteModule = createRequire(import.meta.url)("node:sqlite") as SqliteModule;
  }
  return sqliteModule;
}

export interface WorldXRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface WorldXStatement {
  run(...params: unknown[]): WorldXRunResult;
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}

export interface WorldXDatabase {
  prepare(sql: string): WorldXStatement;
  exec(sql: string): void;
  /** 返回 PRAGMA 结果行，与 better-sqlite3 一致：调用方要靠它判断 PRAGMA 是否真的生效。 */
  pragma(source: string): any[];
  transaction<TResult>(fn: (...args: any[]) => TResult): (...args: any[]) => TResult;
  close(): void;
}

/** node:sqlite 支持的绑定参数类型（undefined 会被统一转为 null）。 */
type SqliteValue = null | number | bigint | string | Uint8Array;

/**
 * 归一化绑定参数：
 * - undefined -> null（与业务层的 `?? null` 约定一致）
 * - boolean -> 1 / 0（node:sqlite 不接受布尔值，而库表用 INTEGER 存布尔语义列）
 * - 其余不可绑定类型直接抛错，并指出参数序号，避免 node:sqlite 抛出不含位置信息的
 *   "Provided value cannot be bound to SQLite parameter N"。
 */
function normalizeParams(params: unknown[]): SqliteValue[] {
  return params.map((p, i) => {
    if (p === undefined || p === null) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (
      typeof p === "number" ||
      typeof p === "bigint" ||
      typeof p === "string" ||
      p instanceof Uint8Array
    ) {
      return p as SqliteValue;
    }
    throw new TypeError(
      `[WorldX] 第 ${i + 1} 个绑定参数的类型 ${
        Object.prototype.toString.call(p)
      } 无法写入 SQLite，请先自行序列化（对象/数组请用 JSON.stringify）。`,
    );
  });
}

class SqliteDatabase implements WorldXDatabase {
  private readonly inner: DatabaseSyncType;
  /** 当前事务嵌套深度，0 表示不在事务中。用于把嵌套事务降级为 SAVEPOINT。 */
  private txDepth = 0;

  constructor(dbPath: string) {
    const { DatabaseSync } = loadSqlite();
    // enableForeignKeyConstraints 显式置为 false：node:sqlite 默认开启，而
    // better-sqlite3 默认关闭。这里保持迁移前的行为，避免旧快照（其
    // content_candidates.event_id 可能指向已裁剪的事件）在写入时被外键拒绝。
    this.inner = new DatabaseSync(dbPath, { enableForeignKeyConstraints: false });
    // better-sqlite3 默认 5 秒 busy timeout，node:sqlite 默认 0。不设置的话，
    // WAL 下任何第二个连接（tsx watch 重启、快照/分支拷贝）都会立刻 SQLITE_BUSY。
    // 构造函数的 timeout 选项要 Node >= 24，PRAGMA 才是可移植写法。
    this.pragma("busy_timeout = 5000");
  }

  prepare(sql: string): WorldXStatement {
    const stmt: StatementSync = this.inner.prepare(sql);
    return {
      run: (...params: unknown[]) =>
        stmt.run(...normalizeParams(params)) as WorldXRunResult,
      get: (...params: unknown[]) => stmt.get(...normalizeParams(params)),
      all: (...params: unknown[]) => stmt.all(...normalizeParams(params)),
    };
  }

  exec(sql: string): void {
    this.inner.exec(sql);
  }

  pragma(source: string): any[] {
    // 用 prepare().all() 而非 exec()：PRAGMA 的返回行往往是唯一的成功信号，
    // 例如 journal_mode 静默回退、wal_checkpoint 返回 busy=1。
    return this.inner.prepare(`PRAGMA ${source}`).all();
  }

  transaction<TResult>(fn: (...args: any[]) => TResult): (...args: any[]) => TResult {
    return (...args: any[]): TResult => {
      // 与 better-sqlite3 一致：嵌套调用降级为 SAVEPOINT，而不是让 SQLite 抛
      // "cannot start a transaction within a transaction"。
      const nested = this.txDepth > 0;
      const savepoint = `worldx_sp_${this.txDepth}`;

      this.inner.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN");
      this.txDepth += 1;

      let result: TResult;
      try {
        result = fn(...args);
        // better-sqlite3 会拒绝返回 promise 的事务函数：否则 COMMIT 会在异步工作
        // 真正执行前就跑完，写入落在事务之外且毫无原子性。
        if (result instanceof Promise) {
          throw new TypeError(
            "[WorldX] 事务函数不能返回 Promise：COMMIT 会在异步写入完成前执行，" +
              "导致写入脱离事务。请改用同步函数。",
          );
        }
      } catch (err) {
        this.txDepth -= 1;
        try {
          this.inner.exec(nested ? `ROLLBACK TO ${savepoint}` : "ROLLBACK");
          if (nested) this.inner.exec(`RELEASE ${savepoint}`);
        } catch {
          // 回滚失败时仍抛出原始错误
        }
        throw err;
      }

      this.txDepth -= 1;
      this.inner.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
      return result;
    };
  }

  close(): void {
    this.txDepth = 0;
    this.inner.close();
  }
}

let db: WorldXDatabase | null = null;
let currentDbPath: string | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  game_day INTEGER NOT NULL,
  game_tick INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor_id TEXT,
  target_id TEXT,
  location TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  inner_monologue TEXT,
  dram_score REAL,
  tags TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(game_day, game_tick);
CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  game_day INTEGER NOT NULL,
  game_tick INTEGER NOT NULL,
  importance INTEGER NOT NULL DEFAULT 5,
  emotional_valence REAL DEFAULT 0,
  emotional_intensity REAL DEFAULT 0,
  related_characters TEXT DEFAULT '[]',
  related_location TEXT DEFAULT '',
  related_objects TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  decay_factor REAL DEFAULT 1.0,
  access_count INTEGER DEFAULT 0,
  is_long_term INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mem_char ON memories(character_id);
CREATE INDEX IF NOT EXISTS idx_mem_importance ON memories(character_id, importance DESC);
CREATE INDEX IF NOT EXISTS idx_mem_time ON memories(character_id, game_day DESC, game_tick DESC);

CREATE TABLE IF NOT EXISTS character_states (
  character_id TEXT PRIMARY KEY,
  location TEXT NOT NULL,
  main_area_point_id TEXT,
  current_action TEXT,
  current_action_target TEXT,
  action_start_tick INTEGER DEFAULT 0,
  action_end_tick INTEGER DEFAULT 0,
  emotion_valence REAL DEFAULT 0,
  emotion_arousal REAL DEFAULT 3,
  curiosity REAL DEFAULT 100,
  daily_plan TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS world_object_states (
  object_id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  state TEXT DEFAULT 'normal',
  state_description TEXT DEFAULT '',
  current_users TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS world_global_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  game_day INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  game_day INTEGER NOT NULL,
  game_tick INTEGER NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS llm_call_logs (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  character_id TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  success INTEGER DEFAULT 1,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_candidates (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  type TEXT NOT NULL,
  dram_score REAL DEFAULT 0,
  content TEXT NOT NULL,
  character_id TEXT,
  context TEXT,
  tags TEXT DEFAULT '[]',
  reviewed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

export function initDatabase(dbPath?: string): WorldXDatabase {
  // 版本不满足时在这里就给出可读的报错，而不是等 node:sqlite 解析失败。
  assertSqliteSupported();

  const resolvedPath =
    dbPath ?? process.env.DB_PATH ?? path.resolve("data/mist-town.db");

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 避免重复 init 泄漏上一个连接及其 WAL 文件。
  closeDb();

  // 先在局部变量上完成 schema 与迁移，全部成功后再发布到模块级 db，
  // 否则中途失败会让 getDb() 拿到一个半初始化的连接，后续查询报 no such table。
  const database = new SqliteDatabase(resolvedPath);
  try {
    const [journalMode] = database.pragma("journal_mode = WAL") as
      | [{ journal_mode?: string }]
      | [];
    const mode = journalMode?.journal_mode?.toLowerCase();
    if (mode !== "wal") {
      console.warn(
        `[WorldX] journal_mode 未能切换到 WAL（当前为 ${mode ?? "unknown"}）。` +
          `数据库仍可使用，但并发读写与快照一致性会变差，常见原因是数据目录位于网络文件系统或只读。`,
      );
    }

    database.exec(SCHEMA_SQL);
    runMigrations(database);
  } catch (err) {
    try {
      database.close();
    } catch {
      // 初始化失败时忽略关闭错误，抛出原始错误更有价值
    }
    throw err;
  }

  db = database;
  currentDbPath = resolvedPath;

  return db;
}

function runMigrations(database: WorldXDatabase): void {
  const hasColumn = database
    .prepare(`PRAGMA table_info(memories)`)
    .all()
    .some((col: any) => col.name === "embedding");
  if (!hasColumn) {
    database.exec(`ALTER TABLE memories ADD COLUMN embedding TEXT DEFAULT NULL`);
  }

  const hasMainAreaPointId = database
    .prepare(`PRAGMA table_info(character_states)`)
    .all()
    .some((col: any) => col.name === "main_area_point_id");
  if (!hasMainAreaPointId) {
    database.exec(`ALTER TABLE character_states ADD COLUMN main_area_point_id TEXT DEFAULT NULL`);
  }
}

export function getDb(): WorldXDatabase {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

export function getDbPath(): string {
  if (!currentDbPath) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return currentDbPath;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
