import { DateTime } from "luxon";
import { env } from "./config.js";
import { db } from "./db.js";

export type PostKind = "IMAGE" | "REEL";

/**
 * Next free posting slot (ISO UTC), respecting:
 * - Photo Posts (IMAGE) scheduled at 5:00 PM IST (17:00)
 * - Reels (REEL) scheduled at 7:00 PM IST (19:00)
 */
export function nextSlot(kind?: "IMAGE" | "REEL"): string {
  const imageSlot = (env.POST_IMAGE_SLOT || "17:00").trim();
  const reelSlot = (env.POST_REEL_SLOT || "19:00").trim();

  // If a kind is specified, prioritize its dedicated daily slot:
  // IMAGE -> 5:00 PM IST (17:00)
  // REEL  -> 7:00 PM IST (19:00)
  // If not specified, use configured POST_SLOTS in chronological order
  const targetSlots =
    kind === "IMAGE"
      ? [imageSlot]
      : kind === "REEL"
      ? [reelSlot]
      : env.POST_SLOTS
      ? env.POST_SLOTS.split(",").map((s) => s.trim()).filter(Boolean)
      : [imageSlot, reelSlot];

  const rows = db
    .prepare("SELECT scheduled_at, kind FROM posts WHERE status IN ('approved','publishing','published') AND scheduled_at IS NOT NULL")
    .all() as { scheduled_at: string; kind?: string }[];

  const taken = new Set(rows.map((r) => r.scheduled_at));

  // Count scheduled posts per day in the target timezone to enforce MAX_POSTS_PER_DAY
  const countsByDay = new Map<string, number>();
  for (const r of rows) {
    const dayKey = DateTime.fromISO(r.scheduled_at).setZone(env.TIMEZONE).toISODate();
    if (dayKey) {
      countsByDay.set(dayKey, (countsByDay.get(dayKey) ?? 0) + 1);
    }
  }

  const now = DateTime.now().setZone(env.TIMEZONE);
  for (let d = 0; d < 30; d++) {
    const date = now.startOf("day").plus({ days: d });
    const dayKey = date.toISODate();
    const dayCount: number = dayKey ? (countsByDay.get(dayKey) ?? 0) : 0;
    if (dayCount >= env.MAX_POSTS_PER_DAY) continue;

    for (const s of targetSlots) {
      const [hour, minute] = s.split(":").map(Number);
      const t = date.set({ hour, minute, second: 0, millisecond: 0 });
      const iso = t.toUTC().toISO()!;
      if (t > now.plus({ minutes: 5 }) && !taken.has(iso)) return iso;
    }
  }
  throw new Error("No free posting slot in the next 30 days");
}

export const formatLocal = (iso: string) =>
  DateTime.fromISO(iso).setZone(env.TIMEZONE).toFormat("ccc d LLL, h:mm a");
