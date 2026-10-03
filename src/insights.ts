import { db } from "./db.js";
import { AuthError, fetchInsights } from "./instagram.js";
import { log } from "./log.js";

/** Weighted engagement per reach. Saves and shares count most because they drive distribution. */
export const score = (m: { reach: number; saved: number; shares: number; likes: number; comments: number }) =>
  (m.saved * 3 + m.shares * 4 + m.comments * 2 + m.likes) / Math.max(m.reach, 1);

export async function refreshMetrics() {
  const rows = db
    .prepare(
      `SELECT id, ig_media_id FROM posts
       WHERE status = 'published' AND ig_media_id IS NOT NULL AND ig_media_id != 'dry-run'
         AND published_at < datetime('now', '-12 hours') AND published_at > datetime('now', '-14 days')`,
    )
    .all() as { id: number; ig_media_id: string }[];

  for (const r of rows) {
    try {
      const m = await fetchInsights(r.ig_media_id);
      db.prepare(
        `INSERT OR REPLACE INTO metrics (post_id, fetched_at, reach, saved, shares, likes, comments, score)
         VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?)`,
      ).run(r.id, m.reach, m.saved, m.shares, m.likes, m.comments, score(m));
    } catch (e) {
      if (e instanceof AuthError) throw e;
      log.warn({ post: r.id, err: (e as Error).message }, "metrics failed");
    }
  }
}

export type Ranked = { caption: string; pillar: string | null; kind: string; score: number; reach: number; saved: number; shares: number };

const ranked = (order: "DESC" | "ASC", limit: number) =>
  db
    .prepare(
      `SELECT p.caption, p.pillar, p.kind, m.score, m.reach, m.saved, m.shares
       FROM posts p JOIN metrics m ON m.post_id = p.id
       WHERE p.caption IS NOT NULL ORDER BY m.score ${order} LIMIT ?`,
    )
    .all(limit) as Ranked[];

export const winners = (n = 5) => ranked("DESC", n);
export const losers = (n = 3) => ranked("ASC", n);
