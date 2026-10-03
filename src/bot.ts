import { Bot, InlineKeyboard, InputFile } from "grammy";
import { env, DRY_RUN } from "./config.js";
import { db, setSetting, type Post } from "./db.js";
import { log } from "./log.js";
import fs from "node:fs";

const token = env.TELEGRAM_BOT_TOKEN || "NO_TOKEN";
export const bot = new Bot(token);
export let owner = env.TELEGRAM_CHAT_ID ? Number(env.TELEGRAM_CHAT_ID) : 0;

// Security and auto-binding middleware
bot.use(async (ctx, next) => {
  if (!owner && ctx.chat?.id) {
    owner = ctx.chat.id;
    setSetting("telegram_chat_id", String(owner));
    await ctx.reply(`👑 Welcome! Your Telegram Chat ID is ${owner}.\nSaved as owner of this Instagram Agent.`);
  }

  if (owner && ctx.chat?.id !== owner) {
    await ctx.reply("⛔ Unauthorized access.");
    return;
  }
  await next();
});

/** Never throws: a Telegram outage must not break publishing. */
export async function notify(text: string) {
  if (!env.TELEGRAM_BOT_TOKEN || !owner) {
    log.info({ text: text.slice(0, 100) }, "telegram notify (token or chat_id not set)");
    return;
  }
  try {
    await bot.api.sendMessage(owner, text.slice(0, 4000));
  } catch (e) {
    log.error({ err: (e as Error).message }, "telegram notify failed");
  }
}

const render = (p: Post) =>
  [
    `📌 Draft #${p.id} · ${p.kind} · ${p.pillar ?? ""}${DRY_RUN ? " · DRY RUN" : ""}`,
    p.ai_generated ? "🤖 AI-generated visuals. If they look photorealistic, turn on Instagram's \"AI info\" label when it posts." : "",
    p.kind === "REEL" && p.on_screen_text && !p.ai_generated ? `🎬 Hook text to overlay: ${p.on_screen_text}` : "",
    "",
    p.caption ?? "",
    "",
    `Alt text: ${p.alt_text ?? ""}`,
    `Media URL: ${p.media_url}`,
    "",
    "Reply to this message with new text to replace the caption.",
  ]
  .filter((l, i, a) => l !== "" || a[i - 1] !== "")
  .join("\n");

export async function sendDraft(p: Post) {
  if (!env.TELEGRAM_BOT_TOKEN || !owner) return;
  const kb = new InlineKeyboard().text("✅ Approve", `ok:${p.id}`).text("🔁 Redo", `redo:${p.id}`).text("❌ Reject", `no:${p.id}`);

  // Send the actual video or photo file directly to Telegram chat so user can watch it
  if (p.src_path && fs.existsSync(p.src_path)) {
    try {
      if (p.kind === "REEL") {
        await bot.api.sendVideo(owner, new InputFile(p.src_path), {
          caption: `🎬 Reel Video #${p.id} Preview`,
        });
      } else if (p.kind === "IMAGE") {
        await bot.api.sendPhoto(owner, new InputFile(p.src_path), {
          caption: `📸 Image #${p.id} Preview`,
        });
      }
    } catch (mediaErr) {
      log.warn({ err: (mediaErr as Error).message }, "Failed to send direct media file to Telegram");
    }
  }

  const msg = await bot.api.sendMessage(owner, render(p).slice(0, 4000), { reply_markup: kb });
  db.prepare("UPDATE posts SET tg_msg_id = ? WHERE id = ?").run(msg.message_id, p.id);
}
