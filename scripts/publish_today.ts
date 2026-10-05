import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import { publishToInstagram, checkToken } from "../src/instagram.js";
import { upload, verifyMediaUrl } from "../src/media.js";
import { notify } from "../src/bot.js";
import type { Post } from "../src/db.js";
import { DateTime } from "luxon";

const TZ = "Asia/Kolkata";

async function publishSinglePost(db: DatabaseSync, postId: number): Promise<{ id: string; permalink: string }> {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId) as Post | undefined;
  if (!post) {
    throw new Error(`Post #${postId} not found in DB`);
  }

  console.log(`\n========================================`);
  console.log(`Starting publish flow for Post #${post.id} (${post.kind})...`);
  console.log(`Caption: ${post.caption?.slice(0, 100)}...`);

  // Ensure local file exists
  if (!post.src_path) {
    throw new Error(`Post #${postId} has no src_path`);
  }
  const fileExists = await fs.stat(post.src_path).then(() => true).catch(() => false);
  if (!fileExists) {
    throw new Error(`Local file not found for Post #${postId}: ${post.src_path}`);
  }

  // Upload to public host to get fresh, verified URL
  console.log(`Uploading ${post.src_path} (${post.kind === "REEL" ? "video" : "image"})...`);
  const uploaded = await upload(post.src_path, post.kind === "REEL" ? "video" : "image");
  console.log(`Fresh public URL generated: ${uploaded.url}`);

  const isAlive = await verifyMediaUrl(uploaded.url);
  if (!isAlive) {
    throw new Error(`Uploaded URL could not be verified by Facebook crawler: ${uploaded.url}`);
  }
  console.log(`Verified URL is reachable: ${uploaded.url}`);

  // Update DB state to publishing
  db.prepare("UPDATE posts SET media_url = ?, cloud_id = ?, status = 'publishing', error = NULL WHERE id = ?").run(
    uploaded.url,
    uploaded.publicId,
    post.id
  );

  const updatedPost: Post = {
    ...post,
    media_url: uploaded.url,
    cloud_id: uploaded.publicId,
    status: "publishing",
  };

  // Publish to Instagram
  console.log(`Publishing Post #${post.id} to Instagram Graph API...`);
  const result = await publishToInstagram(updatedPost);
  console.log(`SUCCESS! Published Post #${post.id}:`, result);

  // Update DB state to published
  db.prepare(
    "UPDATE posts SET status = 'published', ig_media_id = ?, permalink = ?, published_at = datetime('now') WHERE id = ?"
  ).run(result.id, result.permalink, post.id);

  // Send Telegram notification
  try {
    await notify(`🚀 Published #${post.id} (${post.kind})\n${result.permalink}\n\n${post.caption?.split("\n")[0]}`);
    console.log(`Telegram notification sent for Post #${post.id}`);
  } catch (err: any) {
    console.warn(`Telegram notification error (non-fatal):`, err.message);
  }

  return result;
}

async function main() {
  const db = new DatabaseSync("data/agent.db");
  const now = DateTime.now().setZone(TZ);
  console.log(`=== PUBLISHING TODAY'S CONTENT ===`);
  console.log(`Current IST: ${now.toFormat("yyyy-MM-dd HH:mm:ss")}`);

  // 1. Verify Instagram API connection
  const username = await checkToken();
  console.log(`Instagram API connected successfully: @${username}`);

  // 2. Fetch today's posts (Image #29 and Reel #15)
  const todayDateStr = "2026-10-05";
  const todayPosts = db
    .prepare(
      "SELECT id, kind, status, scheduled_at FROM posts WHERE scheduled_at LIKE ? AND status IN ('approved', 'publishing') ORDER BY kind DESC"
    )
    .all(`${todayDateStr}%`) as { id: number; kind: string; status: string; scheduled_at: string }[];

  console.log(`Found ${todayPosts.length} posts scheduled for today (${todayDateStr}):`);
  for (const p of todayPosts) {
    console.log(`  - #${p.id} [${p.kind}] status=${p.status} scheduled_at=${p.scheduled_at}`);
  }

  if (todayPosts.length === 0) {
    console.log("No pending approved posts found for today!");
    return;
  }

  const results: Record<number, { id: string; permalink: string }> = {};

  // 3. Publish today's posts
  for (const p of todayPosts) {
    try {
      const res = await publishSinglePost(db, p.id);
      results[p.id] = res;
    } catch (err: any) {
      console.error(`Failed to publish Post #${p.id}:`, err);
      db.prepare("UPDATE posts SET status = 'failed', error = ? WHERE id = ?").run(err.message, p.id);
      await notify(`❌ Publishing #${p.id} failed: ${err.message}`).catch(() => {});
    }
  }

  // 4. Reschedule missed posts from yesterday (2026-10-04) to Oct 9 so the queue is clean
  const missedYesterday = db
    .prepare("SELECT id, kind FROM posts WHERE scheduled_at LIKE '2026-10-04%' AND status = 'approved'")
    .all() as { id: number; kind: string }[];

  if (missedYesterday.length > 0) {
    console.log(`\nRescheduling ${missedYesterday.length} missed posts from yesterday to Oct 9...`);
    for (const m of missedYesterday) {
      const newSlotHour = m.kind === "IMAGE" ? 17 : 19;
      const newDt = DateTime.fromISO("2026-10-09T00:00:00", { zone: TZ }).set({ hour: newSlotHour, minute: 0, second: 0 });
      const newUtcIso = newDt.toUTC().toISO()!;
      db.prepare("UPDATE posts SET scheduled_at = ? WHERE id = ?").run(newUtcIso, m.id);
      console.log(`  Rescheduled #${m.id} (${m.kind}) -> ${newDt.toFormat("EEE dd LLL, h:mm a")} IST`);
    }
  }

  // 5. Final summary
  console.log(`\n========================================`);
  console.log(`=== TODAY'S PUBLISHING COMPLETE ===`);
  for (const [id, res] of Object.entries(results)) {
    console.log(`Post #${id}: ${res.permalink} (Instagram ID: ${res.id})`);
  }
}

main().catch(console.error);
