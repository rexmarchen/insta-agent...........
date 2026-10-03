import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { env } from "./config.js";

if (env.DB_PATH !== ":memory:") fs.mkdirSync(path.dirname(env.DB_PATH), { recursive: true });

const rawDb = new DatabaseSync(env.DB_PATH);
try {
  rawDb.exec("PRAGMA journal_mode = WAL");
  rawDb.exec("PRAGMA busy_timeout = 5000");
} catch {
  // :memory: or in-memory pragmas
}

// Wrapper for better-sqlite3 compatibility
export const db = {
  exec(sql: string) {
    return rawDb.exec(sql);
  },
  prepare(sql: string) {
    const stmt = rawDb.prepare(sql);
    return {
      all(...args: any[]) {
        return (stmt.all as any)(...args) as any[];
      },
      get(...args: any[]) {
        return (stmt.get as any)(...args) as any;
      },
      run(...args: any[]) {
        const res = (stmt.run as any)(...args);
        return {
          changes: Number(res.changes ?? 0),
          lastInsertRowid: Number(res.lastInsertRowid ?? 0),
        };
      },
    };
  },
  transaction<T>(fn: () => T): () => T {
    return () => {
      rawDb.exec("BEGIN");
      try {
        const res = fn();
        rawDb.exec("COMMIT");
        return res;
      } catch (e) {
        try {
          rawDb.exec("ROLLBACK");
        } catch {}
        throw e;
      }
    };
  },
  pragma(sql: string, opts?: { simple?: boolean }) {
    if (sql.startsWith("user_version")) {
      const res = rawDb.prepare("PRAGMA user_version").get() as any;
      const val = res ? Number(Object.values(res)[0] ?? 0) : 0;
      return opts?.simple ? val : res;
    }
    return rawDb.exec(`PRAGMA ${sql}`);
  },
  close() {
    return rawDb.close();
  },
};

/** Append-only list. Each entry runs once, in order, tracked by PRAGMA user_version. */
const MIGRATIONS: string[] = [
  `CREATE TABLE posts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL,
     src_path TEXT NOT NULL UNIQUE,
     media_url TEXT NOT NULL,
     frames TEXT,
     status TEXT NOT NULL DEFAULT 'new',
     caption TEXT, alt_text TEXT, pillar TEXT, hook TEXT, on_screen_text TEXT, keywords TEXT,
     scheduled_at TEXT, published_at TEXT, ig_media_id TEXT, permalink TEXT, error TEXT,
     tg_msg_id INTEGER,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE metrics (
     post_id INTEGER PRIMARY KEY,
     fetched_at TEXT, reach INTEGER, saved INTEGER, shares INTEGER, likes INTEGER, comments INTEGER, score REAL
   );
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`,
  `ALTER TABLE posts ADD COLUMN ai_generated INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE posts ADD COLUMN brief TEXT;
   ALTER TABLE posts ADD COLUMN cloud_id TEXT;
   ALTER TABLE posts ADD COLUMN cloud_deleted INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX idx_posts_status ON posts(status);
   CREATE TABLE generations (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     day TEXT NOT NULL, format TEXT NOT NULL, provider TEXT, ok INTEGER NOT NULL, detail TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
  `CREATE TABLE IF NOT EXISTS chat_history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
  `CREATE TABLE IF NOT EXISTS memories (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     category TEXT NOT NULL DEFAULT 'general',
     fact TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
  `CREATE TABLE IF NOT EXISTS projects (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT UNIQUE NOT NULL,
     headline TEXT NOT NULL,
     target_audience TEXT,
     problem_solved TEXT,
     key_features TEXT,
     whats_new TEXT,
     cta_link TEXT,
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
];

const current = (db.pragma("user_version", { simple: true }) as number) || 0;
for (let v = current; v < MIGRATIONS.length; v++) {
  db.transaction(() => {
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  })();
}

export type Post = {
  id: number;
  kind: "REEL" | "IMAGE";
  src_path: string;
  media_url: string;
  frames: string | null;
  status: string;
  caption: string | null;
  alt_text: string | null;
  pillar: string | null;
  hook: string | null;
  on_screen_text: string | null;
  keywords: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  ig_media_id: string | null;
  permalink: string | null;
  error: string | null;
  tg_msg_id: number | null;
  ai_generated: number;
  brief: string | null;
  cloud_id: string | null;
  cloud_deleted: number;
};

export const getPost = (id: number) => db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as Post | undefined;

export const getSetting = (key: string, fallback = "") =>
  (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? fallback;

export const setSetting = (key: string, value: string) =>
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);

export const addMemory = (fact: string, category = "general") => {
  return db.prepare("INSERT INTO memories (category, fact) VALUES (?, ?)").run(category, fact.trim());
};

export const getMemories = (limit = 30): { id: number; category: string; fact: string }[] => {
  return db.prepare("SELECT id, category, fact FROM memories ORDER BY id DESC LIMIT ?").all(limit) as any[];
};

export const deleteMemory = (id: number) => {
  return db.prepare("DELETE FROM memories WHERE id = ?").run(id);
};

export const saveChatMessage = (role: "user" | "assistant", content: string) => {
  db.prepare("INSERT INTO chat_history (role, content) VALUES (?, ?)").run(role, content.slice(0, 4000));
};

export const getRecentChatHistory = (limit = 10): { role: string; content: string }[] => {
  const rows = db.prepare("SELECT role, content FROM chat_history ORDER BY id DESC LIMIT ?").all(limit) as { role: string; content: string }[];
  return rows.reverse();
};

export function ensureDefaultMemories() {
  const count = (db.prepare("SELECT COUNT(*) c FROM memories").get() as any)?.c ?? 0;
  if (count === 0) {
    addMemory("Owner: Anshu. Instagram: @anshu._io. Business/Brand: REXEDITZZ (video editing, motion graphics, and tech studio).", "identity");
    addMemory("Rovia: Anshu's high-intelligence AI Instagram Executive, creative partner, and autonomous director.", "identity");
    addMemory("Target Audience: Real estate agents, high-ticket brokers, and content creators looking for scroll-stopping video edits, reels, and higher lead conversions.", "audience");
    addMemory("Brand Voice: Confident, sleek, modern, authoritative, zero cringe hype, max 2 emojis, strong hook in first line.", "voice");
    addMemory("Visual Aesthetic: Dark, moody, cinematic, cool-toned blue-black lighting with subtle monitor glow, sharp geometric lines, crimson (#DC143C) and gold (#D4AF37) accents.", "visual");
    addMemory("Autonomous Schedule: Everyday at 7:00 PM IST on Autopilot.", "schedule");
  }
}

export type Project = {
  id: number;
  name: string;
  headline: string;
  target_audience: string | null;
  problem_solved: string | null;
  key_features: string | null;
  whats_new: string | null;
  cta_link: string | null;
  updated_at: string;
};

export const upsertProject = (p: {
  name: string;
  headline: string;
  target_audience?: string;
  problem_solved?: string;
  key_features?: string;
  whats_new?: string;
  cta_link?: string;
}) => {
  return db
    .prepare(
      `INSERT INTO projects (name, headline, target_audience, problem_solved, key_features, whats_new, cta_link, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(name) DO UPDATE SET
         headline = excluded.headline,
         target_audience = coalesce(excluded.target_audience, target_audience),
         problem_solved = coalesce(excluded.problem_solved, problem_solved),
         key_features = coalesce(excluded.key_features, key_features),
         whats_new = coalesce(excluded.whats_new, whats_new),
         cta_link = coalesce(excluded.cta_link, cta_link),
         updated_at = datetime('now')`,
    )
    .run(
      p.name.trim(),
      p.headline.trim(),
      p.target_audience ?? null,
      p.problem_solved ?? null,
      p.key_features ?? null,
      p.whats_new ?? null,
      p.cta_link ?? null,
    );
};

export const getProject = (name: string): Project | undefined => {
  return db.prepare("SELECT * FROM projects WHERE lower(name) = lower(?)").get(name.trim()) as Project | undefined;
};

export const listProjects = (): Project[] => {
  return db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as Project[];
};

export const updateProjectWhatsNew = (name: string, whats_new: string) => {
  return db.prepare("UPDATE projects SET whats_new = ?, updated_at = datetime('now') WHERE lower(name) = lower(?)").run(whats_new.trim(), name.trim());
};

export function ensureDefaultProjects() {
  upsertProject({
    name: "rexionAI",
    headline: "AI Future Predictor & Autonomous Website Builder",
    target_audience: "Entrepreneurs, agency owners, creators, and developers",
    problem_solved: "Eliminates weeks of tedious manual web building and uncertain forecasting by instantly generating websites and predicting market trends",
    key_features: "AI Future Prediction Engine, Instant Autonomous Website Builder, Real-time Connection Pipelines",
    whats_new: "New connections hub, lightning-fast website generation, predictive intelligence algorithms",
    cta_link: "DM 'REXION' for exclusive beta access",
  });
  upsertProject({
    name: "rexion",
    headline: "AI Future Predictor & Autonomous Website Builder",
    target_audience: "Entrepreneurs, agency owners, creators, and developers",
    problem_solved: "Eliminates weeks of tedious manual web building and uncertain forecasting by instantly generating websites and predicting market trends",
    key_features: "AI Future Prediction Engine, Instant Autonomous Website Builder, Real-time Connection Pipelines",
    whats_new: "New connections hub, lightning-fast website generation, predictive intelligence algorithms",
    cta_link: "DM 'REXION' for exclusive beta access",
  });
}

// Seed on startup
try {
  ensureDefaultMemories();
  ensureDefaultProjects();
  if (!getSetting("max_generations_per_day")) {
    setSetting("max_generations_per_day", "10");
  } else {
    setSetting("max_generations_per_day", "10");
  }
} catch {}

