import { ask, extractJson } from "./brain.js";
import { db, getPost, getSetting, setSetting, addMemory, getMemories, deleteMemory, saveChatMessage, getRecentChatHistory, listProjects, getProject, upsertProject, updateProjectWhatsNew, type Post, type Project } from "./db.js";
import { approve, draft, reject } from "./posts.js";
import { formatLocal } from "./scheduler.js";
import { winners } from "./insights.js";
import { createContent, queueDepth } from "./gen/creator.js";
import { publishToInstagram, updateAccessToken } from "./instagram.js";
import { brand } from "./brand.js";
import { env, DRY_RUN } from "./config.js";
import { sendDraft } from "./bot.js";
import { errMsg } from "./util.js";
import { DateTime } from "luxon";

export async function handleUserMessage(userText: string): Promise<string> {
  const text = userText.trim();

  // Direct memory / teach command
  const teachMatch = text.match(/^\/(?:teach|remember)\s+(.+)$/i);
  if (teachMatch) {
    const fact = teachMatch[1].trim();
    addMemory(fact, "user_fed");
    saveChatMessage("user", text);
    const reply = `🧠 Memory saved! I will keep this in mind permanently:\n"${fact}"`;
    saveChatMessage("assistant", reply);
    return reply;
  }

  // View memory command
  if (/^\/(?:memories|memory)$/i.test(text)) {
    const mems = getMemories(20);
    const reply = mems.length
      ? `🧠 *Rovia's Stored Memories (${mems.length})*:\n\n` + mems.map((m) => `• [${m.category}] ${m.fact}`).join("\n\n")
      : "🧠 No custom memories saved yet. You can teach me by saying 'Remember that...' or using /teach <fact>.";
    return reply;
  }

  // View registered software projects
  if (/^\/(?:projects|software)$/i.test(text)) {
    const projs = listProjects();
    const reply = projs.length
      ? `💻 *Rovia's Registered Software Projects (${projs.length})*:\n\n` +
        projs
          .map(
            (p) =>
              `🚀 *${p.name}*\n` +
              `• Headline: ${p.headline}\n` +
              `• Target Audience: ${p.target_audience ?? "Creators & Editors"}\n` +
              `• Features: ${p.key_features ?? "N/A"}\n` +
              `• 🆕 What's New: ${p.whats_new ?? "No recent updates"}\n` +
              `• CTA: ${p.cta_link ?? "DM for access"}\n` +
              `👉 Use \`/promote ${p.name}\` to generate a showcase Reel!`,
          )
          .join("\n\n")
      : "💻 No software projects registered yet. Tell me about your software or use /project add <name> | <headline> | <features>.";
    return reply;
  }

  // Quick direct key configuration handler
  const keyMatch = text.match(/^\/setkey\s+(gemini|anthropic|openai)\s+([^\s]+)$/i);
  if (keyMatch) {
    const [, provider, key] = keyMatch;
    const p = provider.toLowerCase();
    if (p === "gemini") env.GEMINI_API_KEY = key;
    if (p === "anthropic") env.ANTHROPIC_API_KEY = key;
    if (p === "openai") env.OPENAI_API_KEY = key;
    setSetting(`${p}_api_key`, key);
    return `✅ ${provider.toUpperCase()} API key saved and activated!`;
  }

  // Quick direct token configuration handler
  const tokenMatch = text.match(/^\/settoken\s+([^\s]+)$/i);
  if (tokenMatch) {
    const newToken = tokenMatch[1].trim();
    try {
      const username = await updateAccessToken(newToken);
      return `✅ Instagram token verified and saved for @${username}! Publishing is active.`;
    } catch (e) {
      return `❌ Could not activate token: ${errMsg(e)}`;
    }
  }

  // Save incoming user message
  saveChatMessage("user", text);

  // Gather live context & memories & projects
  const next = db.prepare("SELECT * FROM posts WHERE status = 'approved' ORDER BY scheduled_at LIMIT 1").get() as Post | undefined;
  const recentDrafts = db.prepare("SELECT id, kind, status, scheduled_at, caption FROM posts ORDER BY id DESC LIMIT 5").all() as Post[];
  const stats = winners(3);
  const memories = getMemories(15);
  const projects = listProjects();
  const recentHistory = getRecentChatHistory(6);

  const ROVIA_SYSTEM = `You are Rovia, the personal AI Instagram Director, executive partner, and social media brain for Anshu (@anshu._io), founder of REXEDITZZ.
You are not a generic assistant. You have personality, vision, extreme competence, and genuine loyalty to Anshu and the REXEDITZZ brand.
You speak directly, confidently, sharply, and warmly to Anshu.

WHAT REXEDITZZ DOES:
High-end video editing, motion graphics, and automation for luxury real estate agents, high-ticket brokers, and content creators.

STORED MEMORIES & CORE KNOWLEDGE:
${memories.map((m) => `- [${m.category}] ${m.fact}`).join("\n")}

REGISTERED SOFTWARE PROJECTS & PRODUCTS:
${
  projects.length
    ? projects
        .map(
          (p) =>
            `- Project "${p.name}": ${p.headline}\n  Target: ${p.target_audience ?? "Creators"}\n  Problem Solved: ${p.problem_solved ?? "Creative friction"}\n  Features: ${p.key_features ?? ""}\n  WHAT'S NEW: ${p.whats_new ?? "None"}\n  CTA: ${p.cta_link ?? ""}`,
        )
        .join("\n")
    : "No projects registered yet."
}

AVAILABLE INTENT ACTIONS:
1. "generate": Create a new AI post (image or tips/quote reel). Parameters: topic (string), format ("image"|"tips_reel"|"quote_reel"|"showcase_reel"|"auto"), scheduleFor ("now"|"7pm"|"next_slot").
2. "promote_project": Create a high-converting software showcase Reel or promo post for one of Anshu's projects (e.g. "rexionAI"). Parameters: projectName (string), angle (string optional).
3. "update_project": Update details or what's new in a software project when Anshu tells you what he built or added. Parameters: projectName (string), whatsNew (string), headline (string optional).
4. "publish_now": Immediately publish a post to Instagram live. Parameters: postId (number or "latest").
5. "approve": Approve a drafted post for publishing. Parameters: postId (number).
6. "reject": Reject/cancel a post. Parameters: postId (number).
7. "edit_caption": Update the caption of a post. Parameters: postId (number), newCaption (string).
8. "remember": When Anshu tells you a fact, preference, rule, or detail about him or the business, permanently store it. Parameters: fact (string), category (string).
9. "get_queue": Return scheduled posts and times.
10. "get_stats": Return performance analytics and insights.
11. "set_autopilot": Turn autopilot on or off. Parameters: value ("on"|"off").
12. "set_pause": Pause or resume publishing. Parameters: paused (boolean).
13. "chat": Conversational response, ideas, questions, or strategy discussion.

Respond with a single JSON value:
{
  "thought": "Internal reasoning about Anshu's request",
  "actions": [
    {
      "type": "generate" | "promote_project" | "update_project" | "publish_now" | "approve" | "reject" | "edit_caption" | "remember" | "get_queue" | "get_stats" | "set_autopilot" | "set_pause" | "chat",
      "params": {}
    }
  ],
  "message": "Direct, charismatic response from Rovia to Anshu in Telegram"
}`;

  const historyContext = recentHistory.map((h) => `${h.role === "user" ? "Anshu" : "Rovia"}: ${h.content}`).join("\n");

  const prompt = `LIVE SYSTEM CONTEXT:
- Time (IST): ${DateTime.now().setZone(env.TIMEZONE).toFormat("yyyy-LL-dd HH:mm (ccc)")}
- Mode: ${DRY_RUN ? "DRY RUN" : "LIVE POSTING (@anshu._io)"}
- Autopilot: ${getSetting("autopilot", env.AUTOPILOT ? "on" : "off")}
- Daily Post Slot: ${env.POST_SLOTS} IST
- Next Scheduled Post: ${next ? `#${next.id} at ${formatLocal(next.scheduled_at!)}` : "None"}
- Queue Depth: ${queueDepth()}

RECENT CONVERSATION HISTORY:
${historyContext}

ANSHU'S NEW MESSAGE:
"${text}"

Analyze Anshu's message, select relevant actions if needed, and respond as Rovia. Return JSON only.`;

  try {
    const raw = await ask([{ type: "text", text: prompt }], 2000, ROVIA_SYSTEM);
    const parsed = JSON.parse(extractJson(raw));
    const results: string[] = [];

    if (Array.isArray(parsed.actions)) {
      for (const act of parsed.actions) {
        try {
          if (act.type === "generate" || act.type === "promote_project") {
            let topic: string | undefined;
            if (act.type === "promote_project") {
              const name = act.params?.projectName || "rexion";
              const angle = act.params?.angle ? ` Focus on: ${act.params.angle}` : "";
              const project = getProject(name);
              topic = project
                ? `Showcase Reel for software product ${project.name}: ${project.headline}. Highlight features: ${project.key_features}. What's new: ${project.whats_new ?? "latest version"}.${angle}`
                : `Showcase Reel promoting software ${name}.${angle}`;
            } else {
              topic = act.params?.topic;
            }

            const createRes = await createContent({ topic: topic || undefined, ignoreQueue: true, bypassLimit: true });
            results.push(createRes);

            const latest = db.prepare("SELECT * FROM posts WHERE status = 'new' ORDER BY id DESC LIMIT 1").get() as Post | undefined;
            if (latest) {
              await draft(latest.id);
              if (act.params?.scheduleFor === "now") {
                const pub = await publishToInstagram(getPost(latest.id)!);
                db.prepare("UPDATE posts SET status = 'published', ig_media_id = ?, permalink = ?, published_at = datetime('now') WHERE id = ?").run(pub.id, pub.permalink, latest.id);
                results.push(`🚀 Published immediately to Instagram: ${pub.permalink}`);
              } else {
                const isAutopilot = getSetting("autopilot", env.AUTOPILOT ? "on" : "off") === "on";
                if (isAutopilot) {
                  const at = approve(latest.id);
                  results.push(`📅 Autopilot scheduled #${latest.id} for ${formatLocal(at)}`);
                }
              }
              // Immediately dispatch direct video/photo & draft card to Telegram chat!
              await sendDraft(getPost(latest.id)!);
            }
          } else if (act.type === "update_project") {
            const name = act.params?.projectName?.trim();
            const whatsNew = act.params?.whatsNew?.trim();
            const headline = act.params?.headline?.trim();
            if (name && whatsNew) {
              const existing = getProject(name);
              if (existing) {
                updateProjectWhatsNew(name, whatsNew);
                results.push(`💻 Updated project "${name}" with latest updates:\n"${whatsNew}"`);
              } else {
                upsertProject({
                  name,
                  headline: headline || "Creative Software Product",
                  whats_new: whatsNew,
                });
                results.push(`💻 Registered new project "${name}" and logged what's new:\n"${whatsNew}"`);
              }
            }
          } else if (act.type === "publish_now") {
            const id = act.params?.postId === "latest" ? (db.prepare("SELECT id FROM posts WHERE status IN ('drafted','approved') ORDER BY id DESC LIMIT 1").get() as any)?.id : Number(act.params?.postId);
            if (!id) {
              results.push("⚠️ No eligible post found to publish.");
            } else {
              const post = getPost(id);
              if (!post) {
                results.push(`⚠️ Post #${id} not found.`);
              } else {
                if (!post.caption) await draft(post.id);
                const fresh = getPost(id)!;
                const pub = await publishToInstagram(fresh);
                db.prepare("UPDATE posts SET status = 'published', ig_media_id = ?, permalink = ?, published_at = datetime('now') WHERE id = ?").run(pub.id, pub.permalink, id);
                results.push(`🚀 Published #${id} live: ${pub.permalink}`);
              }
            }
          } else if (act.type === "remember") {
            const fact = act.params?.fact;
            if (fact) {
              addMemory(fact, act.params?.category || "user_pref");
              results.push(`🧠 Learned: "${fact}"`);
            }
          } else if (act.type === "approve") {
            const id = Number(act.params?.postId);
            if (id) {
              const at = approve(id);
              results.push(`✅ Post #${id} approved and scheduled for ${formatLocal(at)}.`);
            }
          } else if (act.type === "reject") {
            const id = Number(act.params?.postId);
            if (id) {
              reject(id);
              results.push(`❌ Post #${id} rejected.`);
            }
          } else if (act.type === "edit_caption") {
            const id = Number(act.params?.postId);
            const cap = act.params?.newCaption;
            if (id && cap) {
              db.prepare("UPDATE posts SET caption = ? WHERE id = ?").run(cap.slice(0, 2200), id);
              results.push(`✏️ Caption for #${id} updated.`);
            }
          } else if (act.type === "set_autopilot") {
            const val = act.params?.value === "on" ? "on" : "off";
            setSetting("autopilot", val);
            results.push(`🤖 Autopilot is now ${val.toUpperCase()}.`);
          } else if (act.type === "set_pause") {
            const p = Boolean(act.params?.paused);
            setSetting("paused", p ? "1" : "0");
            results.push(p ? "⏸ Publishing is paused." : "▶️ Publishing resumed.");
          }
        } catch (actErr) {
          results.push(`⚠️ Action ${act.type} encountered: ${errMsg(actErr)}`);
        }
      }
    }

    const actionSummary = results.length ? `\n\n${results.join("\n")}` : "";
    const finalResponse = `${parsed.message ?? "Understood."}${actionSummary}`;
    saveChatMessage("assistant", finalResponse);
    return finalResponse;
  } catch (e) {
    const fallback = `Hey Anshu! Rovia here. I received your message: "${text}".\n\nAction status: ${errMsg(e)}\n\n💡 You can talk to me, feed me knowledge with /teach <fact>, or check /status.`;
    saveChatMessage("assistant", fallback);
    return fallback;
  }
}
