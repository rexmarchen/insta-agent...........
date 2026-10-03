import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./config.js";
import { db, getSetting, setSetting, type Post } from "./db.js";
import { deleteUpload, extractFrames, kindOf, passthroughVideo, prepareImage, prepareVideo, thumbnail, upload, verifyMediaUrl } from "./media.js";
import { AuthError, publishToInstagram, QuotaError } from "./instagram.js";
import { draft, approve } from "./posts.js";
import { notify, sendDraft } from "./bot.js";
import { formatIdeas, generateIdeas } from "./brain.js";
import { formatLocal } from "./scheduler.js";
import { log } from "./log.js";
import { errMsg } from "./util.js";

export const INBOX = "inbox";
const DONE = "processed";
const FAILED = "failed";
const WORK = "work";

export const ensureDirs = () => Promise.all([INBOX, DONE, FAILED, WORK].map((d) => fs.mkdir(d, { recursive: true })));

export type IngestOpts = { generated?: boolean; brief?: string };

/** Prepares a media file for Instagram, uploads it, and registers it as a new post. Returns the post id. */
export async function ingestFile(src: string, opts: IngestOpts = {}): Promise<number> {
  const kind = kindOf(src);
  if (!kind) throw new Error(`Unsupported file type: ${src}`);
  await ensureDirs();

  let frames: string[];
  let uploaded: Awaited<ReturnType<typeof upload>>;
  if (kind === "REEL") {
    const { out, duration } = opts.generated ? await passthroughVideo(src) : await prepareVideo(src, WORK);
    frames = await extractFrames(out, WORK, duration);
    uploaded = await upload(out, "video");
  } else {
    const { out } = await prepareImage(src, WORK);
    frames = [await thumbnail(out, WORK)];
    uploaded = await upload(out, "image");
  }

  try {
    let keep = src;
    if (!opts.generated) {
      keep = path.join(DONE, `${Date.now()}-${path.basename(src)}`);
      await fs.rename(src, keep);
    }
    const r = db
      .prepare("INSERT INTO posts (kind, src_path, media_url, frames, ai_generated, brief, cloud_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(kind, keep, uploaded.url, JSON.stringify(frames), opts.generated ? 1 : 0, opts.brief ?? null, uploaded.publicId);
    log.info({ post: r.lastInsertRowid, kind, generated: !!opts.generated }, "media ingested");
    return Number(r.lastInsertRowid);
  } catch (e) {
    await deleteUpload(uploaded.publicId, kind === "REEL" ? "video" : "image").catch(() => {}); // don't orphan the upload
    throw e;
  }
}

/** Picks up new photos/videos from ./inbox. One bad file never blocks the rest. */
export async function ingest() {
  await ensureDirs();
  for (const file of await fs.readdir(INBOX)) {
    if (!kindOf(file)) continue;
    const src = path.join(INBOX, file);
    if (Date.now() - (await fs.stat(src)).mtimeMs < 30_000) continue; // still being copied
    try {
      await ingestFile(src);
    } catch (e) {
      log.error({ file, err: errMsg(e) }, "ingest failed");
      await fs.rename(src, path.join(FAILED, `${Date.now()}-${file}`)).catch(() => {});
      await notify(`⚠️ Could not ingest ${file}: ${errMsg(e)}\nThe file was moved to the failed/ folder.`);
    }
  }
}

/** Drafts captions for new media and sends them for approval (or auto-schedules in autopilot). */
export async function draftNew() {
  const rows = db.prepare("SELECT id FROM posts WHERE status = 'new' ORDER BY id LIMIT 3").all() as { id: number }[];
  for (const { id } of rows) {
    try {
      const post = await draft(id);
      if (getSetting("autopilot", env.AUTOPILOT ? "on" : "off") === "on") {
        const at = approve(id);
        await notify(`🤖 Autopilot scheduled #${id} for ${formatLocal(at)}\n\n${post.caption?.split("\n")[0]}`);
      } else {
        await sendDraft(post);
      }
    } catch (e) {
      log.error({ post: id, err: errMsg(e) }, "drafting failed");
      db.prepare("UPDATE posts SET status = 'failed', error = ? WHERE id = ?").run(errMsg(e), id);
      await notify(`⚠️ Drafting #${id} failed: ${errMsg(e)}\nUse /retry ${id} after fixing the cause.`);
    }
  }
}

/** Publishes the next approved post whose slot has arrived. */
export async function publishDue() {
  if (getSetting("paused") === "1") return;
  const approved = db.prepare("SELECT * FROM posts WHERE status = 'approved' ORDER BY scheduled_at").all() as Post[];
  const due = approved.find((p) => new Date(p.scheduled_at!) <= new Date());
  if (!due) return;

  // Claim it atomically so two ticks can never publish the same post.
  const claim = db.prepare("UPDATE posts SET status = 'publishing' WHERE id = ? AND status = 'approved'").run(due.id);
  if (claim.changes !== 1) return;

  try {
    // If the media URL expired (common with temporary file hosting) or is unreachable, re-upload from local disk
    if (due.src_path) {
      const exists = await fs.stat(due.src_path).then(() => true).catch(() => false);
      if (exists) {
        const isAlive = await verifyMediaUrl(due.media_url);
        if (!isAlive) {
          log.warn({ post: due.id, oldUrl: due.media_url }, "media_url expired or unreachable, re-uploading from local file");
          const fresh = await upload(due.src_path, due.kind === "REEL" ? "video" : "image");
          db.prepare("UPDATE posts SET media_url = ?, cloud_id = ? WHERE id = ?").run(fresh.url, fresh.publicId, due.id);
          due.media_url = fresh.url;
          due.cloud_id = fresh.publicId;
        }
      }
    }

    const r = await publishToInstagram(due);
    db.prepare("UPDATE posts SET status = 'published', ig_media_id = ?, permalink = ?, published_at = datetime('now') WHERE id = ?").run(r.id, r.permalink, due.id);
    log.info({ post: due.id, media: r.id }, "published");
    await notify(`🚀 Published #${due.id}\n${r.permalink}`);
  } catch (e) {
    if (e instanceof QuotaError) {
      db.prepare("UPDATE posts SET status = 'approved', scheduled_at = ? WHERE id = ?").run(new Date(Date.now() + 30 * 60_000).toISOString(), due.id);
      log.warn({ post: due.id }, "publishing limit reached, postponed 30 min");
      return;
    }
    db.prepare("UPDATE posts SET status = 'failed', error = ? WHERE id = ?").run(errMsg(e), due.id);
    log.error({ post: due.id, err: errMsg(e) }, "publish failed");
    if (e instanceof AuthError) {
      setSetting("paused", "1");
      await notify(`🔑 Instagram token problem. Publishing is paused.\n${errMsg(e)}\nRefresh IG_ACCESS_TOKEN, restart, then /resume and /retry ${due.id}.`);
    } else {
      await notify(`❌ Publishing #${due.id} failed: ${errMsg(e)}\nUse /retry ${due.id} to re-queue it.`);
    }
  }
}

/** After a crash, a post stuck in 'publishing' may or may not have gone live. Never auto-retry (risk of a double post). */
export async function recoverStuck() {
  const stuck = db.prepare("SELECT id FROM posts WHERE status = 'publishing'").all() as { id: number }[];
  for (const { id } of stuck) {
    db.prepare("UPDATE posts SET status = 'failed', error = ? WHERE id = ?").run("Interrupted while publishing. Check Instagram first.", id);
    await notify(`⚠️ #${id} was mid-publish when the agent stopped. Check your Instagram profile; if it did not post, run /retry ${id}.`);
  }
}

/** Instagram keeps its own copy after publishing, and free Cloudinary storage is small. */
export async function cleanupCloud() {
  const rows = db
    .prepare(
      `SELECT id, kind, cloud_id FROM posts
       WHERE cloud_deleted = 0 AND cloud_id IS NOT NULL AND (
         (status = 'published' AND published_at < datetime('now', '-2 days')) OR
         (status IN ('rejected','failed') AND created_at < datetime('now', '-3 days')))`,
    )
    .all() as { id: number; kind: string; cloud_id: string }[];
  for (const r of rows) {
    try {
      await deleteUpload(r.cloud_id, r.kind === "REEL" ? "video" : "image");
      db.prepare("UPDATE posts SET cloud_deleted = 1 WHERE id = ?").run(r.id);
    } catch (e) {
      log.warn({ post: r.id, err: errMsg(e) }, "cloud cleanup failed");
    }
  }
}

/** Removes intermediate renders older than 7 days. */
export async function cleanupWork() {
  const cutoff = Date.now() - 7 * 24 * 3600_000;
  for (const f of await fs.readdir(WORK).catch(() => [] as string[])) {
    const p = path.join(WORK, f);
    const st = await fs.stat(p).catch(() => null);
    if (st?.isFile() && st.mtimeMs < cutoff) await fs.rm(p, { force: true });
  }
}

export async function weeklyIdeas() {
  await notify(formatIdeas(await generateIdeas()));
}
