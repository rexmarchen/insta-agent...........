import { db } from "../src/db.js";

const now = new Date();
console.log("Current time (UTC):", now.toISOString());
console.log("Current time (IST):", now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }));

const approved = db.prepare("SELECT id, kind, status, scheduled_at, media_url FROM posts WHERE status IN ('approved') ORDER BY scheduled_at").all() as any[];
console.log("\nApproved posts:");
for (const p of approved) {
  const scheduledAt = new Date(p.scheduled_at);
  const isDue = scheduledAt <= now;
  console.log(`  #${p.id} ${p.kind} scheduled=${p.scheduled_at} isDue=${isDue} url=${p.media_url?.slice(0, 50)}`);
}
