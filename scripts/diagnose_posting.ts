
import { db, getSetting } from "../src/db.js";
import { checkToken } from "../src/instagram.js";
import { DateTime } from "luxon";
import { env } from "../src/config.js";
import fs from "node:fs";

async function main() {
  console.log("=== 1. TIME & SETTINGS ===");
  const now = DateTime.now().setZone(env.TIMEZONE);
  console.log("Current time (IST):", now.toISO());
  console.log("Autopilot setting:", getSetting("autopilot"));
  console.log("Paused setting:", getSetting("paused"));
  console.log("Max generations:", getSetting("max_generations_per_day"));

  console.log("\n=== 2. INSTAGRAM ACCOUNT & QUOTA ===");
  try {
    const user = await checkToken();
    console.log("Instagram Account:", user);
  } catch (e: any) {
    console.error("Instagram Error:", e.message);
  }

  console.log("\n=== 3. ALL POSTS IN DATABASE ===");
  const posts = db.prepare("SELECT id, kind, status, scheduled_at, published_at, media_url, src_path, error FROM posts ORDER BY id DESC LIMIT 15").all() as any[];
  for (const p of posts) {
    const srcExists = p.src_path ? fs.existsSync(p.src_path) : false;
    console.log(`[Post #${p.id}] Kind: ${p.kind} | Status: ${p.status} | Scheduled: ${p.scheduled_at} | Published: ${p.published_at} | FileExists: ${srcExists} | Error: ${p.error || "none"}`);
  }

  console.log("\n=== 4. DUE POSTS CHECK ===");
  const approved = db.prepare("SELECT * FROM posts WHERE status = 'approved' ORDER BY scheduled_at").all() as any[];
  console.log("Approved count:", approved.length);
  for (const a of approved) {
    const schedDate = new Date(a.scheduled_at);
    const isDue = schedDate <= new Date();
    console.log(`Post #${a.id} (${a.kind}): scheduled_at=${a.scheduled_at} (${DateTime.fromISO(a.scheduled_at).setZone(env.TIMEZONE).toFormat("yyyy-MM-dd HH:mm")}) -> isDue? ${isDue}`);
  }
}

main().catch(console.error);
