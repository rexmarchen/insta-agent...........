import { db, getPost } from "./db.js";
import { draftCaption } from "./brain.js";
import { nextSlot } from "./scheduler.js";
import { brand } from "./brand.js";
import { captionProblems } from "./caption.js";

export async function draft(id: number, feedback?: string) {
  const post = getPost(id);
  if (!post) throw new Error(`Post ${id} not found`);
  const d = await draftCaption(post, feedback);
  db.prepare(
    `UPDATE posts SET status = 'drafted', caption = ?, alt_text = ?, pillar = ?, hook = ?, on_screen_text = ?, keywords = ?, error = NULL WHERE id = ?`,
  ).run(d.caption, d.alt_text, d.pillar, d.hook, d.on_screen_text, d.keywords, id);
  return getPost(id)!;
}

/** Idempotent: a double-tap on Approve cannot schedule the same post twice. */
export function approve(id: number): string {
  const post = getPost(id);
  if (!post) throw new Error(`Post ${id} not found`);
  if (post.status !== "drafted") throw new Error(`#${id} is already ${post.status}`);
  const problems = captionProblems(post.caption ?? "", brand.banned_phrases);
  if (problems.length) throw new Error(`Caption not allowed: ${problems.join("; ")}`);
  const at = nextSlot(post.kind as "IMAGE" | "REEL");
  const r = db.prepare("UPDATE posts SET status = 'approved', scheduled_at = ? WHERE id = ? AND status = 'drafted'").run(at, id);
  if (r.changes !== 1) throw new Error(`#${id} was changed by someone else, try again`);
  return at;
}

export function reject(id: number) {
  const r = db.prepare("UPDATE posts SET status = 'rejected' WHERE id = ? AND status IN ('drafted','approved')").run(id);
  if (r.changes !== 1) throw new Error(`#${id} cannot be rejected in its current state`);
}

/** Re-queues a failed post into the next slot. */
export function retryPost(id: number): string {
  const post = getPost(id);
  if (!post) throw new Error(`Post ${id} not found`);
  if (post.status !== "failed") throw new Error(`#${id} is ${post.status}, only failed posts can be retried`);
  if (post.cloud_deleted) throw new Error(`#${id}: the uploaded media has expired. Drop the file in the inbox again.`);
  if (!post.caption) throw new Error(`#${id} has no caption yet. Drop the file in the inbox again.`);
  const at = nextSlot(post.kind as "IMAGE" | "REEL");
  db.prepare("UPDATE posts SET status = 'approved', scheduled_at = ?, error = NULL WHERE id = ?").run(at, id);
  return at;
}
