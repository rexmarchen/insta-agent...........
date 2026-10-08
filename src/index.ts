import cron, { type ScheduledTask } from "node-cron";
import { env, DRY_RUN } from "./config.js";
import { log } from "./log.js";
import { db, getSetting, setSetting } from "./db.js";
import { bot, notify } from "./bot.js";
import "./commands.js";
import { cleanupCloud, cleanupWork, draftNew, ensureDirs, ingest, publishDue, recoverStuck, weeklyIdeas } from "./pipeline.js";
import { refreshMetrics } from "./insights.js";
import { AuthError, checkToken, refreshLongLivedToken } from "./instagram.js";
import { createContent } from "./gen/creator.js";
import { startHealthServer } from "./health.js";
import { errMsg } from "./util.js";
import { nextSlot } from "./scheduler.js";
import { DateTime } from "luxon";

const running = new Set<string>();
const guard = (name: string, fn: () => Promise<unknown>) => async () => {
  if (running.has(name)) return; // never overlap the same job
  running.add(name);
  try {
    return await fn();
  } catch (e) {
    log.error({ job: name, err: errMsg(e) }, "job failed");
    if (e instanceof AuthError) {
      setSetting("paused", "1");
      await notify(`🔑 Instagram token problem (${name}). Publishing paused.\n${errMsg(e)}`);
    }
  } finally {
    running.delete(name);
  }
};

const intake = guard("intake", async () => {
  await ingest();
  await draftNew();
});

const tokenMaintenance = async () => {
  const account = await checkToken();
  log.info({ account }, "instagram token verified ok");

  // Check if we should auto-refresh the 60-day token (every 25 days)
  const lastRefreshed = getSetting("ig_token_refreshed_at");
  const daysSince = lastRefreshed ? (Date.now() - new Date(lastRefreshed).getTime()) / (1000 * 86400) : 999;
  if (daysSince > 25) {
    try {
      const res = await refreshLongLivedToken();
      log.info({ expiresIn: res.expires_in }, "token auto-refreshed for another 60 days");
    } catch (e) {
      log.warn({ err: errMsg(e) }, "token auto-refresh check encountered error");
    }
  }
};

/**
 * Smart dual-slot content creator.
 * Keeps the next 5 days filled with:
 *   - IMAGE post at 5:00 PM IST
 *   - REEL  post at 7:00 PM IST
 * Generates whichever slot is missing — IMAGE priority first.
 * Runs every 30 minutes so the queue is always topped up automatically.
 */
async function smartCreate() {
  if (!env.ENABLE_GENERATION) return;

  const tz = env.TIMEZONE;
  const now = DateTime.now().setZone(tz);
  const lookAheadDays = 5; // keep 5 days of content ready

  const approvedSlots = db
    .prepare("SELECT scheduled_at, kind FROM posts WHERE status IN ('approved','publishing','published') AND scheduled_at IS NOT NULL")
    .all() as { scheduled_at: string; kind: string }[];

  const filledImageDays = new Set<string>();
  const filledReelDays = new Set<string>();
  for (const r of approvedSlots) {
    const dt = DateTime.fromISO(r.scheduled_at).setZone(tz);
    const dayKey = dt.toISODate()!;
    if (r.kind === "IMAGE") filledImageDays.add(dayKey);
    else filledReelDays.add(dayKey);
  }

  // Check today (if slots are still in the future) and tomorrow onwards
  const currentHour = now.hour;
  const imageSlotHour = Number((env.POST_IMAGE_SLOT || "17:00").split(":")[0]);
  const reelSlotHour = Number((env.POST_REEL_SLOT || "19:00").split(":")[0]);
  const startDay = currentHour < Math.max(imageSlotHour, reelSlotHour) ? 0 : 1;

  for (let d = startDay; d <= lookAheadDays; d++) {
    const date = now.startOf("day").plus({ days: d });
    const dayKey = date.toISODate()!;

    // Missing IMAGE slot? (only if today and before 5PM, or future day)
    if (!filledImageDays.has(dayKey) && (d > 0 || currentHour < imageSlotHour)) {
      log.info({ day: dayKey }, "image slot missing — generating photo post for Rexion");
      const result = await createContent({
        topic: "Aesthetic editorial photo post for REXION AI Career Platform — warm sunlit workspace, open laptop showing the REXION job dashboard, ceramic coffee mug, notebook, premium editorial warm cream aesthetic",
        ignoreQueue: true,
        bypassLimit: false,
      });
      log.info({ result }, "auto image generation done");
      await draftNew();
      return; // one generation per run cycle
    }

    // Missing REEL slot? (only if today and before 7PM, or future day)
    if (!filledReelDays.has(dayKey) && (d > 0 || currentHour < reelSlotHour)) {
      log.info({ day: dayKey }, "reel slot missing — generating reel for Rexion");
      const result = await createContent({ ignoreQueue: true, bypassLimit: false });
      log.info({ result }, "auto reel generation done");
      await draftNew();
      return;
    }
  }

  log.info({ lookahead: lookAheadDays }, "all slots filled for next days — no generation needed");
}

export { smartCreate };

const tasks: ScheduledTask[] = [
  cron.schedule("*/2 * * * *", intake),
  cron.schedule("* * * * *", guard("publish", publishDue)),
  cron.schedule("0 */3 * * *", guard("metrics", refreshMetrics)),
  // Smart dual-slot generation every 30 min: fills IMAGE@5PM then REEL@7PM for next 5 days
  cron.schedule("*/30 * * * *", guard("create", smartCreate)),
  cron.schedule("30 3 * * *", guard("token-check", tokenMaintenance)),
  cron.schedule("45 3 * * *", guard("cleanup", async () => { await cleanupCloud(); await cleanupWork(); })),
  cron.schedule("0 8 * * 1", guard("ideas", weeklyIdeas), { timezone: env.TIMEZONE }),
];

const health = startHealthServer({
  onPublishDue: guard("publish", async () => { await draftNew(); return await publishDue(); }),
  onSmartCreate: guard("create", async () => { await smartCreate(); await draftNew(); }),
});

async function main() {
  await ensureDirs();
  await recoverStuck();

  // Reschedule any stale approved posts from >36 hours in the past so the queue is never blocked
  try {
    const staleCutoff = DateTime.now().setZone(env.TIMEZONE).minus({ hours: 36 }).toUTC().toISO()!;
    const stalePosts = db
      .prepare("SELECT id, kind FROM posts WHERE status = 'approved' AND scheduled_at < ?")
      .all(staleCutoff) as { id: number; kind: string }[];
    for (const s of stalePosts) {
      const newSlot = nextSlot(s.kind as "IMAGE" | "REEL");
      db.prepare("UPDATE posts SET scheduled_at = ? WHERE id = ?").run(newSlot, s.id);
      log.warn({ post: s.id, newSlot }, "auto-rescheduled stale overdue post forward to next open slot");
    }
  } catch (e) {
    log.warn({ err: errMsg(e) }, "stale queue cleanup check encountered error");
  }

  const savedToken = getSetting("ig_access_token");
  if (savedToken && savedToken.trim()) {
    env.IG_ACCESS_TOKEN = savedToken.trim();
  }

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_TOKEN !== "NO_TOKEN") {
    bot.catch((err) => log.error({ err: err.message }, "telegram handler error"));
    void bot.start({
      onStart: (me) =>
        log.info({ bot: me.username, dryRun: DRY_RUN, generation: env.ENABLE_GENERATION }, DRY_RUN ? "agent online (DRY_RUN: nothing will be posted)" : "agent online (LIVE)"),
    });
  } else {
    log.warn("TELEGRAM_BOT_TOKEN is not set. Telegram bot is currently waiting for a token in .env");
  }

  void guard("token-check", tokenMaintenance)();
  void intake();
  // Immediately run smart creation on startup so missing image slots are filled right away
  void guard("create", smartCreate)();
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "shutting down");
  tasks.forEach((t) => t.stop());
  health.close();
  if (env.TELEGRAM_BOT_TOKEN) await bot.stop().catch(() => {});
  // Give an in-flight job a moment to finish its current step.
  for (let i = 0; i < 30 && running.size; i++) await new Promise((r) => setTimeout(r, 1000));
  db.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (e) => log.error({ err: errMsg(e) }, "unhandled rejection"));
process.on("uncaughtException", (e) => {
  log.fatal({ err: errMsg(e) }, "uncaught exception");
  process.exit(1); // let Docker / pm2 restart us
});

void main();
