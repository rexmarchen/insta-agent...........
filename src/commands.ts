import { bot } from "./bot.js";
import { env, DRY_RUN } from "./config.js";
import { db, getPost, getSetting, setSetting, listProjects, getProject, type Post } from "./db.js";
import { approve, draft, reject, retryPost } from "./posts.js";
import { formatLocal } from "./scheduler.js";
import { formatIdeas, generateIdeas, ask, extractJson, type ContentBlock } from "./brain.js";
import { winners } from "./insights.js";
import { createContent, generatedToday, queueDepth } from "./gen/creator.js";
import { generateImage } from "./gen/image.js";
import { sendDraft } from "./bot.js";
import { errMsg } from "./util.js";
import { handleUserMessage } from "./agentChat.js";
import { checkToken, publishToInstagram, refreshLongLivedToken, updateAccessToken } from "./instagram.js";
import { ensureDirs, ingestFile } from "./pipeline.js";
import { prepareVideo, extractFrames, coverCrop } from "./media.js";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const clearButtons = (ctx: { editMessageReplyMarkup: (o: object) => Promise<unknown> }) => ctx.editMessageReplyMarkup({}).catch(() => {});

bot.callbackQuery(/^(ok|redo|no):(\d+)$/, async (ctx) => {
  const [, action, idStr] = ctx.match;
  const id = Number(idStr);
  await ctx.answerCallbackQuery();
  try {
    if (action === "ok") {
      const at = approve(id);
      await clearButtons(ctx);
      await ctx.reply(`✅ #${id} scheduled for ${formatLocal(at)}`);
    } else if (action === "no") {
      reject(id);
      await clearButtons(ctx);
      await ctx.reply(`❌ #${id} rejected`);
    } else {
      await clearButtons(ctx);
      await ctx.reply("🔁 Rewriting with a fresh angle...");
      await sendDraft(await draft(id, "Take a clearly different angle and a different opening line from the previous draft."));
    }
  } catch (e) {
    await ctx.reply(`⚠️ ${errMsg(e)}`);
  }
});

bot.command("start", (ctx) =>
  ctx.reply(
    [
      "🤖 *Super-Human Intelligence Instagram Agent (Rovia)*",
      "",
      "I autonomously manage, generate, and post to your Instagram account (@anshu._io):",
      "📸 *Photo Posts:* 5:00 PM IST",
      "🎬 *Reels:* 7:00 PM IST",
      "",
      "💬 *Natural Language Control*:",
      "You can text me anything in plain English, for example:",
      "• \"Create a post about luxury video editing tips\"",
      "• \"Promote rexionAI with our latest agent observability feature\"",
      "• \"I just added realtime sync to rexionAI, update what's new\"",
      "• \"Publish post #1 right now\"",
      "• \"Change caption for #2 to be punchier\"",
      "",
      "⚡ *Quick Commands*:",
      "/status - System state, queue & account info",
      "/queue - Scheduled posts queue",
      "/projects - View registered software products & what's new",
      "/promote [name] - Generate a high-converting software showcase Reel",
      "/generate [topic] - Generate a new post immediately",
      "/postnow [id] - Immediately publish post live",
      "/memories - View Rovia's stored brain memories",
      "/teach [fact] - Feed permanent knowledge to Rovia",
      "/autopilot on|off - Toggle autonomous posting",
      "/refreshtoken - Refresh 60-day Instagram token",
      "/settoken [token] - Update Instagram access token",
      "/pause /resume - Emergency stop / resume",
    ].join("\n"),
    { parse_mode: "Markdown" },
  ),
);

bot.command("status", async (ctx) => {
  const rows = db.prepare("SELECT status, COUNT(*) c FROM posts GROUP BY status").all() as { status: string; c: number }[];
  const next = db.prepare("SELECT scheduled_at FROM posts WHERE status = 'approved' ORDER BY scheduled_at LIMIT 1").get() as { scheduled_at: string } | undefined;
  
  let igStatus = "Checking...";
  try {
    const me = await checkToken();
    igStatus = `✅ Connected (@${me})`;
  } catch (e) {
    igStatus = `⚠️ Issue: ${errMsg(e)}`;
  }

  await ctx.reply(
    [
      `Mode: ${DRY_RUN ? "DRY RUN (testing, nothing posted)" : "LIVE POSTING"}`,
      `Instagram API: ${igStatus}`,
      `Account ID: ${env.IG_USER_ID}`,
      `Status: ${getSetting("paused") === "1" ? "PAUSED" : "ACTIVE"} · Autopilot: ${getSetting("autopilot", "on")}`,
      `Daily Slots: Photos 5:00 PM IST · Reels 7:00 PM IST (${env.TIMEZONE})`,
      `Queue Depth: ${queueDepth()} · Next post: ${next ? formatLocal(next.scheduled_at) : "none scheduled"}`,
      rows.length ? "Posts Breakdown: " + rows.map((r) => `${r.status}: ${r.c}`).join(", ") : "No posts yet.",
    ].join("\n"),
  );
});

bot.command("queue", async (ctx) => {
  const rows = db.prepare("SELECT id, kind, scheduled_at, caption FROM posts WHERE status = 'approved' ORDER BY scheduled_at").all() as Post[];
  await ctx.reply(rows.length ? rows.map((r) => `#${r.id} ${r.kind} · ${formatLocal(r.scheduled_at!)}\n${r.caption?.split("\n")[0]}`).join("\n\n") : "Queue is empty.");
});

bot.command("stats", async (ctx) => {
  const w = winners(5);
  await ctx.reply(
    w.length
      ? "🏆 Top posts by weighted engagement\n\n" + w.map((x) => `${x.score.toFixed(3)} · reach ${x.reach} · saves ${x.saved} · shares ${x.shares}\n${x.caption.split("\n")[0]}`).join("\n\n")
      : "No metrics yet. They appear about 12 hours after a post goes live.",
  );
});

bot.command("ideas", async (ctx) => {
  await ctx.reply("🧠 Brainstorming content ideas...");
  try {
    await ctx.reply(formatIdeas(await generateIdeas()).slice(0, 4000));
  } catch (e) {
    await ctx.reply(`⚠️ ${errMsg(e)}`);
  }
});

bot.command("projects", async (ctx) => {
  const projs = listProjects();
  if (!projs.length) {
    return ctx.reply("No software projects registered yet. Mention your software in chat or tell Rovia about it!");
  }
  const text =
    `💻 *Registered Software Projects (${projs.length})*\n\n` +
    projs
      .map(
        (p) =>
          `🚀 *${p.name}*\n` +
          `• Headline: ${p.headline}\n` +
          `• Audience: ${p.target_audience ?? "Digital creators"}\n` +
          `• Features: ${p.key_features ?? "N/A"}\n` +
          `• 🆕 What's New: ${p.whats_new ?? "Latest features active"}\n` +
          `• CTA: ${p.cta_link ?? "DM for access"}\n` +
          `👉 Type \`/promote ${p.name}\` to produce a showcase Reel!`,
      )
      .join("\n\n");
  await ctx.reply(text, { parse_mode: "Markdown" });
});

bot.command("limit", async (ctx) => {
  const arg = ctx.match.trim();
  const num = Number(arg);
  if (!arg || isNaN(num) || num < 1) {
    const cur = getSetting("max_generations_per_day", String(env.MAX_GENERATIONS_PER_DAY));
    return ctx.reply(`Current daily generation limit: ${cur}. To change: /limit <number> (e.g. /limit 10)`);
  }
  setSetting("max_generations_per_day", String(num));
  await ctx.reply(`✅ Daily generation limit set to ${num}! You can now generate up to ${num} posts/reels today.`);
});

bot.command("promote", async (ctx) => {
  const name = ctx.match.trim() || "rexionAI";
  const project = getProject(name);
  await ctx.reply(`🎬 Planning & producing high-converting software showcase Reel for *${name}*...`, { parse_mode: "Markdown" });
  try {
    const topic = project
      ? `Software Showcase Reel for ${project.name}: ${project.headline}. Features: ${project.key_features}. What's new: ${project.whats_new ?? "latest version"}. CTA: ${project.cta_link ?? "DM for access"}.`
      : `Software Showcase Reel promoting ${name}.`;
    const res = await createContent({ topic, ignoreQueue: true, bypassLimit: true });
    await ctx.reply(res);
  } catch (e) {
    await ctx.reply(`⚠️ Promotion generation failed: ${errMsg(e)}`.slice(0, 3500));
  }
});

bot.command("generate", async (ctx) => {
  await ctx.reply("🎨 Planning and generating content, please wait...");
  try {
    await ctx.reply(await createContent({ topic: ctx.match.trim() || undefined, ignoreQueue: true, bypassLimit: true }));
  } catch (e) {
    await ctx.reply(`⚠️ Generation failed: ${errMsg(e)}`.slice(0, 3500));
  }
});

bot.command("postnow", async (ctx) => {
  const arg = ctx.match.trim();
  const id = arg ? Number(arg) : (db.prepare("SELECT id FROM posts WHERE status IN ('drafted','approved') ORDER BY id DESC LIMIT 1").get() as any)?.id;
  if (!id) return ctx.reply("No post found to publish. Usage: /postnow <id>");

  await ctx.reply(`🚀 Publishing post #${id} to Instagram...`);
  try {
    const post = getPost(id);
    if (!post) throw new Error(`Post #${id} not found`);
    if (!post.caption) await draft(post.id);
    const fresh = getPost(id)!;
    const res = await publishToInstagram(fresh);
    db.prepare("UPDATE posts SET status = 'published', ig_media_id = ?, permalink = ?, published_at = datetime('now') WHERE id = ?").run(res.id, res.permalink, id);
    await ctx.reply(`🎉 Post #${id} published live!\n${res.permalink}`);
  } catch (e) {
    await ctx.reply(`⚠️ Publish failed: ${errMsg(e)}`);
  }
});

bot.command("retry", async (ctx) => {
  const id = Number(ctx.match.trim());
  if (!id) return ctx.reply("Usage: /retry <post id>");
  try {
    await ctx.reply(`♻️ #${id} re-queued for ${formatLocal(retryPost(id))}`);
  } catch (e) {
    await ctx.reply(`⚠️ ${errMsg(e)}`);
  }
});

bot.command("autopilot", async (ctx) => {
  const arg = ctx.match.trim().toLowerCase();
  if (arg === "on" || arg === "off") setSetting("autopilot", arg);
  const on = getSetting("autopilot", "on") === "on";
  await ctx.reply(`Autopilot is ${on ? "ON. Content generates and publishes automatically: Photos at 5:00 PM IST & Reels at 7:00 PM IST." : "OFF. Posts require approval before publishing."}`);
});

bot.command("refreshtoken", async (ctx) => {
  await ctx.reply("🔄 Refreshing Instagram token...");
  try {
    const res = await refreshLongLivedToken();
    await ctx.reply(`✅ Token refreshed! Valid for another ${Math.round(res.expires_in / 86400)} days.`);
  } catch (e) {
    await ctx.reply(`⚠️ Failed to refresh token: ${errMsg(e)}`);
  }
});

bot.command("settoken", async (ctx) => {
  const token = ctx.match.trim();
  if (!token) {
    return ctx.reply("Usage: /settoken <new_instagram_access_token>\nPaste your new token to verify and update it immediately.");
  }
  await ctx.reply("🔑 Verifying and activating new Instagram token...");
  try {
    const username = await updateAccessToken(token);
    await ctx.reply(`✅ Instagram token verified successfully for @${username}!\nToken saved and publishing is active.`);
  } catch (e) {
    await ctx.reply(`❌ Token verification failed:\n${errMsg(e)}`);
  }
});

bot.command("pause", async (ctx) => {
  setSetting("paused", "1");
  await ctx.reply("⏸ Publishing paused. Nothing will be posted until /resume.");
});

bot.command("resume", async (ctx) => {
  setSetting("paused", "0");
  await ctx.reply("▶️ Publishing resumed.");
});

// Handle incoming videos: either as a style/pacing reference or as a post to publish
bot.on(["message:video", "message:document"], async (ctx) => {
  const isDocVideo = ctx.message.document?.mime_type?.startsWith("video/");
  const fileId = ctx.message.video?.file_id ?? (isDocVideo ? ctx.message.document?.file_id : undefined);
  if (!fileId) return;

  const caption = (ctx.message.caption ?? "").trim();
  const isReference = /ref|reference|like this|make like|similar|model|copy/i.test(caption) || !caption;

  await ctx.reply("📥 Video received! Downloading and analyzing frames with Rovia AI...");
  try {
    const file = await ctx.getFile();
    if (!file.file_path) throw new Error("Could not retrieve file path from Telegram");
    const downloadUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`Telegram download failed: ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());

    await ensureDirs();
    const savePath = path.join("work", `tg-${Date.now()}.mp4`);
    await fs.writeFile(savePath, buf);

    if (isReference) {
      // Analyze reference video frames with Gemini vision
      const { out, duration } = await prepareVideo(savePath, "work");
      const frames = await extractFrames(out, "work", duration);

      const prompt = `You are Rovia, elite creative director for Anshu (@anshu._io), founder of REXEDITZZ.
Analyze this reference video across key frames:
1. Hook & Pacing: What grabs attention in the first 2 seconds?
2. Visual style & typography: How is text overlaid, what contrast/colors?
3. Narrative formula: What problem does it present and how does it introduce the solution?
User instruction: "${caption || "Analyze this reference video and model an ad reel for rexionAI"}"

Provide a sharp 3-bullet breakdown of the winning elements, and explain how we will apply this style to REXION / REXEDITZZ.`;

      const images: ContentBlock[] = frames.map((f) => ({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: fsSync.readFileSync(f).toString("base64") },
      }));

      const analysis = await ask([...images, { type: "text", text: prompt }], 1200);
      await ctx.reply(`🧠 *Rovia Reference Video Breakdown:*\n\n${analysis}`, { parse_mode: "Markdown" }).catch(() => ctx.reply(analysis));

      // Auto-generate a new Reel modeled after this reference!
      await ctx.reply("🎬 Now generating a custom Reel for REXION modeled after this reference video...");
      const topic = `Showcase Reel for rexionAI modeled after reference video style: ${caption || "high retention, bold hook, clean sequential text"}`;
      const creationResult = await createContent({ topic, ignoreQueue: true, bypassLimit: true });
      await ctx.reply(creationResult);

      const latest = db.prepare("SELECT * FROM posts WHERE kind = 'REEL' ORDER BY id DESC LIMIT 1").get() as Post | undefined;
      if (latest) {
        await draft(latest.id);
        const fresh = getPost(latest.id)!;
        await sendDraft(fresh);
      }
    } else {
      // Ingest directly as a new post to schedule or approve
      const id = await ingestFile(savePath);
      await draft(id);
      const post = getPost(id)!;
      await sendDraft(post);
      await ctx.reply(`✅ Post #${id} created from your video! Review the draft card above.`);
    }
  } catch (e) {
    await ctx.reply(`⚠️ Video processing failed: ${errMsg(e)}`);
  }
});

// Handle incoming photos: style reference or post image to publish
bot.on("message:photo", async (ctx) => {
  const photos = ctx.message.photo;
  if (!photos || photos.length === 0) return;

  const caption = (ctx.message.caption ?? "").trim();
  const isReference =
    /ref|reference|like this|make like|similar|model|copy|create|generate|like that/i.test(caption) ||
    !caption ||
    /photo like that/i.test(caption);

  await ctx.reply("📥 Photo received! Downloading and analyzing with Rovia AI...");
  try {
    const file = await ctx.getFile();
    if (!file.file_path) throw new Error("Could not retrieve file path from Telegram");
    const downloadUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`Telegram download failed: ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());

    await ensureDirs();
    const savePath = path.join("work", `tg-photo-${Date.now()}.jpg`);
    await fs.writeFile(savePath, buf);

    if (isReference) {
      // Analyze reference image with vision model
      const prompt = `You are Rovia, elite creative director for Anshu (@anshu._io), founder of REXEDITZZ and REXION.
Analyze this reference image:
1. Visual Composition & Style: Layout, aesthetic, mockup style, lighting, color palette.
2. Value Proposition & Copy Structure: Headline, problem/solution hook, micro-copy.
3. Modeling for REXION: How to create a killer software / creative agency post in this exact style.
User request: "${caption || "Create a post photo like that for REXION"}"

Provide a sharp 3-bullet breakdown.`;

      const images: ContentBlock[] = [
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") },
        },
      ];

      const analysis = await ask(
        [...images, { type: "text", text: prompt }],
        1000,
        "You are Rovia, elite creative director for Anshu (@anshu._io). Respond with clear markdown bullets. No JSON.",
      );
      await ctx.reply(`🧠 *Rovia Visual Reference Breakdown:*\n\n${analysis}`, { parse_mode: "Markdown" }).catch(() => ctx.reply(analysis));

      // Auto-generate a new feed post modeled after this reference
      await ctx.reply("🎨 Now generating an aesthetic post image for REXION modeled after this reference...");

      // Formulate headline & subtext matching user's reference structure
      const copyGen = `You are the creative copy director for REXION (@anshu._io).
User request: "${caption || "Create a post photo like that with cream background"}"
Formulate a sharp headline and subtext in REXION's brand voice.
Return JSON: {"headline": string, "subtext": string}`;

      let headline = "Automate Your Social Growth with REXION";
      let subtext = "Connect, engage, and grow — all on autopilot. Choose your platform, set your goals, and let REXION handle the rest.";
      try {
        const rawJson = await ask([...images, { type: "text", text: copyGen }], 300);
        const parsed = JSON.parse(extractJson(rawJson));
        if (parsed.headline) headline = parsed.headline;
        if (parsed.subtext) subtext = parsed.subtext;
      } catch {}

      const visualPrompt = `Create a clean, modern social media post in the style of the reference image.
Style: warm cream/peach background, soft terracotta-orange accent, dark charcoal text, elegant serif headline, small handwritten script annotations, rounded white UI cards with soft shadows, minimal and premium.
Brand: REXION (logo top-left).
Exact headline text: "${headline}"
Subtext: "${subtext}"
Do NOT use: neon, dark background, cyberpunk, glowing lines, gibberish text.
All text must be spelled exactly as given.`.trim();

      const stamp = Date.now();
      const { file: rawImg } = await generateImage(visualPrompt, "4:5", "work", {
        rawPrompt: true,
        refImage: savePath,
        negative: "neon, dark background, cyberpunk, glowing lines, dark room, black background, gibberish text, blurry, distorted faces",
      });
      const croppedFile = await coverCrop(rawImg, path.join("work", `gen-${stamp}-feed.jpg`), 1080, 1350);

      const id = await ingestFile(croppedFile, {
        generated: true,
        brief: `Aesthetic feed post for rexionAI modeled after reference: "${caption || "clean modern software showcase"}". Aesthetic: ${visualPrompt.slice(0, 150)}`,
      });

      await draft(id);
      const post = getPost(id)!;
      await sendDraft(post);
      await ctx.reply(`✅ Post #${id} created modeled after your reference! Review the draft card above.`);
    } else {
      // Ingest directly as a new post to schedule or approve
      const id = await ingestFile(savePath);
      await draft(id);
      const post = getPost(id)!;
      await sendDraft(post);
      await ctx.reply(`✅ Post #${id} created from your photo! Review the draft card above.`);
    }
  } catch (e) {
    await ctx.reply(`⚠️ Photo processing failed: ${errMsg(e)}`);
  }
});

// Reply to a draft to overwrite its caption OR handle natural conversational instructions
bot.on("message:text", async (ctx) => {
  const replyTo = ctx.message.reply_to_message?.message_id;
  if (replyTo) {
    const row = db.prepare("SELECT id FROM posts WHERE tg_msg_id = ? AND status = 'drafted'").get(replyTo) as { id: number } | undefined;
    if (row && getPost(row.id)) {
      db.prepare("UPDATE posts SET caption = ? WHERE id = ?").run(ctx.message.text.slice(0, 2200), row.id);
      await ctx.reply(`Caption for #${row.id} updated. Tap ✅ Approve on the draft when ready.`);
      return;
    }
  }

  // Super-Human Intelligence natural language agent handler
  await ctx.replyWithChatAction("typing").catch(() => {});
  try {
    const reply = await handleUserMessage(ctx.message.text);
    await ctx.reply(reply.slice(0, 4000));
  } catch (e) {
    await ctx.reply(`⚠️ ${errMsg(e)}`);
  }
});
