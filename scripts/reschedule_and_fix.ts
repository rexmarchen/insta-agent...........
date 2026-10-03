/**
 * reschedule_and_fix.ts
 * 
 * - Post #25 TODAY at 7:00 PM IST
 * - From tomorrow: IMAGE posts at 5:00 PM IST, REEL posts at 7:00 PM IST
 * - One IMAGE + One REEL per day (max 2 posts/day)
 * - Autopilot fully ON, no manual approval
 */

import { db, setSetting } from "../src/db.js";
import { DateTime } from "luxon";

const TZ = "Asia/Kolkata";
const now = DateTime.now().setZone(TZ);

console.log("=== REXION Schedule Fixer ===");
console.log(`Current IST: ${now.toFormat("dd LLL yyyy HH:mm")}\n`);

// ── 1. Ensure autopilot is fully ON (no user approval needed)
setSetting("autopilot", "on");
setSetting("paused", "0");
console.log("✅ Autopilot: ON — posts will go live automatically without approval");

// ── 2. Pull all approved posts sorted by current scheduled_at
const approved = db
  .prepare("SELECT id, kind, status, scheduled_at FROM posts WHERE status = 'approved' ORDER BY scheduled_at")
  .all() as { id: number; kind: string; status: string; scheduled_at: string }[];

console.log(`\nFound ${approved.length} approved posts: ${approved.map(p => `#${p.id}(${p.kind})`).join(", ")}`);

// ── 3. Reschedule #25 to TODAY 7:00 PM IST
const todayReel = now.startOf("day").set({ hour: 19, minute: 0, second: 0, millisecond: 0 });
const todayReelUTC = todayReel.toUTC().toISO()!;

// Move any post currently holding today's 7PM slot to a later date
const postAt7pmToday = approved.find(p => p.id !== 25 && p.scheduled_at === todayReelUTC);
if (postAt7pmToday) {
  console.log(`ℹ️  Post #${postAt7pmToday.id} was holding today's 7PM slot — will reschedule it`);
}

// Reschedule #25 to today 7PM
db.prepare("UPDATE posts SET scheduled_at = ? WHERE id = 25").run(todayReelUTC);
console.log(`✅ Post #25 (REEL) → TODAY ${todayReel.toFormat("dd LLL, h:mm a")} IST`);

// ── 4. Build the correct future schedule starting from TOMORROW
// Pattern: each day gets IMAGE@5PM + REEL@7PM
// Sort other approved posts by id (keep creation order, re-slot them correctly)
const otherPosts = approved.filter(p => p.id !== 25);

// Group into images and reels
const imagePosts = otherPosts.filter(p => p.kind === "IMAGE");
const reelPosts = otherPosts.filter(p => p.kind === "REEL");

console.log(`\n📅 Rescheduling ${imagePosts.length} images + ${reelPosts.length} reels from tomorrow onwards...`);

// Assign days starting from tomorrow
let dayOffset = 1; // start from tomorrow
let imageIdx = 0;
let reelIdx = 0;

// Each day: one image slot at 17:00 + one reel slot at 19:00
// Keep going until all posts are assigned
while (imageIdx < imagePosts.length || reelIdx < reelPosts.length) {
  const date = now.startOf("day").plus({ days: dayOffset });

  // Image post at 5 PM IST
  if (imageIdx < imagePosts.length) {
    const slot = date.set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
    const iso = slot.toUTC().toISO()!;
    db.prepare("UPDATE posts SET scheduled_at = ? WHERE id = ?").run(iso, imagePosts[imageIdx].id);
    console.log(`  📸 #${imagePosts[imageIdx].id} IMAGE → ${slot.toFormat("dd LLL, h:mm a")} IST (5PM)`);
    imageIdx++;
  }

  // Reel at 7 PM IST
  if (reelIdx < reelPosts.length) {
    const slot = date.set({ hour: 19, minute: 0, second: 0, millisecond: 0 });
    const iso = slot.toUTC().toISO()!;
    db.prepare("UPDATE posts SET scheduled_at = ? WHERE id = ?").run(iso, reelPosts[reelIdx].id);
    console.log(`  🎬 #${reelPosts[reelIdx].id} REEL  → ${slot.toFormat("dd LLL, h:mm a")} IST (7PM)`);
    reelIdx++;
  }

  dayOffset++;
  if (dayOffset > 30) break; // safety
}

// ── 5. Print final schedule
console.log("\n\n=== FINAL PUBLISH SCHEDULE ===");
const finalPosts = db
  .prepare("SELECT id, kind, status, scheduled_at FROM posts WHERE status = 'approved' ORDER BY scheduled_at")
  .all() as { id: number; kind: string; scheduled_at: string }[];

for (const p of finalPosts) {
  const dt = DateTime.fromISO(p.scheduled_at).setZone(TZ);
  const emoji = p.kind === "REEL" ? "🎬" : "📸";
  console.log(`  ${emoji} #${p.id} ${p.kind.padEnd(5)} → ${dt.toFormat("EEE dd LLL, h:mm a")} IST`);
}

console.log(`\n✅ Done. Agent is LIVE — all posts will auto-publish without asking you.`);
console.log(`📌 Next post: #25 REEL today at 7:00 PM IST`);
