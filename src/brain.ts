import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { z } from "zod";
import { env } from "./config.js";
import { db, listProjects, type Post } from "./db.js";
import { winners, losers } from "./insights.js";
import { brand } from "./brand.js";
import { captionProblems, finalizeCaption } from "./caption.js";
import { retry } from "./util.js";

const DraftSchema = z.object({
  pillar: z.string(),
  hook: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  alt_text: z.string(),
  on_screen_text: z.string().default(""),
  keywords: z.array(z.string()).default([]),
});

const IdeaSchema = z.array(
  z.object({ title: z.string(), format: z.string(), hook: z.string(), shots: z.string(), why: z.string() }),
);

export const PlanSchema = z.object({
  format: z.enum(["image", "tips_reel", "quote_reel", "showcase_reel"]),
  pillar: z.string(),
  title: z.string(),
  message: z.string(),
  image_prompt: z.string().default(""),
  headline: z.string().default(""),
  tips: z.array(z.string()).default([]),
  statement: z.string().default(""),
  subtext: z.string().default(""),
  software_name: z.string().default(""),
  problem_hook: z.string().default(""),
  features: z.array(z.string()).default([]),
  cta: z.string().default("Follow for more"),
});
export type Plan = z.infer<typeof PlanSchema>;

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png"; data: string } };

const SYSTEM = `You are the in-house Instagram strategist and copywriter for ${brand.name}.

BRAND
${JSON.stringify({ ...brand, visual: undefined }, null, 2)}

INSTAGRAM SEO + REACH RULES
- Instagram search reads the caption, on-screen text and alt text, so keywords matter more than hashtags.
- Line 1 (max ~125 chars, it's all people see before "more") must be a genuine hook that also contains one primary keyword, naturally.
- Body: 2 to 4 short lines. Weave in 1 to 3 secondary keywords naturally. Never stuff keywords.
- End with ONE call to action that invites a save, share or DM.
- 3 to 5 specific hashtags (mix niche + mid-size). Never generic mega-tags spam.
- alt_text: a literal, useful description of what is visible (max 100 words), with a keyword only if it fits.
- on_screen_text: for REELs, a 3 to 7 word hook overlay for the first second. Empty string for IMAGE.
- Describe ONLY what you can see in the provided frames. Never invent clients, numbers, results or locations.
- Never promise followers, sales or virality.

Respond with a single JSON value and nothing else.`;

export function extractJson(text: string): string {
  const starts = ["{", "["].map((c) => text.indexOf(c)).filter((i) => i >= 0);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (!starts.length || end < Math.min(...starts)) throw new Error(`Model did not return JSON. Output: ${text.slice(0, 200)}`);
  return text.slice(Math.min(...starts), end + 1);
}

// Anthropic provider
async function askAnthropic(content: ContentBlock[], maxTokens = 1500, systemPrompt = SYSTEM): Promise<string> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 120_000 });
  const res = await client.messages.create({
    model: env.CLAUDE_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: content as any }],
  });
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

// Gemini provider
async function askGemini(content: ContentBlock[], maxTokens = 1500, systemPrompt = SYSTEM): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const parts = content.map((c) => {
    if (c.type === "text") return { text: c.text };
    return {
      inline_data: {
        mime_type: c.source.media_type,
        data: c.source.data,
      },
    };
  });

  const candidateModels = Array.from(new Set([
    env.GEMINI_TEXT_MODEL,
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
  ]));
  let lastError: Error | null = null;

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          system_instruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
        }),
        signal: AbortSignal.timeout(60_000),
      });

      const json: any = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        throw new Error(`Gemini (${model}): ${json.error?.message ?? res.statusText}`);
      }

      const outParts = json.candidates?.[0]?.content?.parts ?? [];
      const text = outParts.map((p: any) => p.text ?? "").join("");
      if (text) return text;
    } catch (e) {
      lastError = e as Error;
      continue;
    }
  }

  throw lastError ?? new Error("Gemini generation failed on all models");
}

// OpenAI provider
async function askOpenAI(content: ContentBlock[], maxTokens = 1500, systemPrompt = SYSTEM): Promise<string> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const parts = content.map((c) => {
    if (c.type === "text") return { type: "text", text: c.text };
    return {
      type: "image_url",
      image_url: { url: `data:${c.source.media_type};base64,${c.source.data}` },
    };
  });

  const url = "https://api.openai.com/v1/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: parts },
      ],
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`OpenAI error: ${json.error?.message ?? res.statusText}`);
  }

  return json.choices?.[0]?.message?.content ?? "";
}

export async function ask(content: ContentBlock[], maxTokens = 1500, systemPrompt = SYSTEM): Promise<string> {
  if (env.ANTHROPIC_API_KEY) {
    return askAnthropic(content, maxTokens, systemPrompt);
  }
  if (env.GEMINI_API_KEY) {
    return askGemini(content, maxTokens, systemPrompt);
  }
  if (env.OPENAI_API_KEY) {
    return askOpenAI(content, maxTokens, systemPrompt);
  }
  throw new Error("No AI provider key configured. Please add GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY in your .env");
}

function performanceContext(): string {
  const w = winners(5);
  const l = losers(3);
  const recent = (
    db
      .prepare("SELECT caption FROM posts WHERE caption IS NOT NULL AND status IN ('drafted','approved','published') ORDER BY id DESC LIMIT 8")
      .all() as { caption: string }[]
  ).map((r) => r.caption.split("\n")[0]);

  return [
    w.length ? `TOP PERFORMERS (learn from their hook and angle):\n${w.map((x) => `- [${x.kind}/${x.pillar}] score ${x.score.toFixed(3)}: ${x.caption.split("\n")[0]}`).join("\n")}` : "No performance data yet.",
    l.length ? `WEAKEST (avoid this style):\n${l.map((x) => `- ${x.caption.split("\n")[0]}`).join("\n")}` : "",
    recent.length ? `RECENT FIRST LINES (do not repeat these openings):\n${recent.map((r) => `- ${r}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function draftCaption(post: Post, feedback?: string) {
  const frames: string[] = JSON.parse(post.frames ?? "[]");
  const images: ContentBlock[] = frames.map((f) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: fs.readFileSync(f).toString("base64") },
  }));

  const banned = brand.banned_phrases ?? [];
  let note = feedback ?? "";

  return retry(
    "ai draft",
    async () => {
      const prompt = `Write the Instagram post for this ${post.kind === "REEL" ? "Reel (frames from start, middle and end are shown)" : "photo"}.
${post.brief ? `\nCONTENT BRIEF (what this post is meant to say): ${post.brief}\n` : ""}
${performanceContext()}

${note ? `REVISION NOTE: ${note}\n` : ""}
Return JSON: {"pillar": string, "hook": string, "caption": string (without hashtags), "hashtags": string[] (3-5), "alt_text": string, "on_screen_text": string, "keywords": string[]}`;

      const d = DraftSchema.parse(JSON.parse(extractJson(await ask([...images, { type: "text", text: prompt }]))));
      const caption = finalizeCaption(d.caption, d.hashtags);
      const problems = captionProblems(caption, banned);
      if (problems.length) {
        note = `The previous attempt was rejected: ${problems.join("; ")}. Fix this.`;
        throw new Error(`caption rejected: ${problems.join("; ")}`);
      }
      return { ...d, caption, keywords: JSON.stringify(d.keywords) };
    },
    3,
    1000,
  );
}

function projectContext(): string {
  try {
    const projects = listProjects();
    if (!projects.length) return "";
    return `AVAILABLE SOFTWARE PROJECTS TO SHOWCASE / PROMOTE:
${projects
  .map(
    (p) =>
      `• Project: ${p.name}
  Headline: ${p.headline}
  Target: ${p.target_audience ?? "Digital creators and video editors"}
  Problem: ${p.problem_solved ?? "Manual creative bottlenecks"}
  Key Features: ${p.key_features ?? "Automated workflow tools"}
  WHAT'S NEW: ${p.whats_new ?? "Latest features active"}
  CTA: ${p.cta_link ?? "DM for access"}`,
  )
  .join("\n\n")}`;
  } catch {
    return "";
  }
}

/** The "creative director": decides what to CREATE next when there is nothing to post. */
export async function planContent(topicHint?: string): Promise<Plan> {
  const isWebsitePredictor = /future|predict|website|builder|code|stack|deploy|agency/i.test(topicHint ?? "");
  const defaultSoftwareName = isWebsitePredictor ? "rexionAI" : "REXION";

  const prompt = `Plan ONE high-converting, aesthetic piece of Instagram content for ${defaultSoftwareName}.

${performanceContext()}

${projectContext()}

${topicHint ? `TOPIC / GOAL REQUESTED BY THE OWNER: ${topicHint}\n` : ""}

CREATIVE FRAMEWORK:
- Products to showcase:
  1. REXION (AI Future Predictor & Autonomous Website Builder): Generates high-end websites instantly, predicts market trends and user behavior, eliminates weeks of manual development.
  2. REXION (AI Career Platform): Smart job & internship matching at Google, Microsoft, Meta, real-time AI resume ATS scoring, 1-click direct apply links at rexion.ai.
- Aesthetic: Warm, organic editorial technology aesthetic. Warm cream (#FAF7F2), peach, ivory, soft terracotta accents (#DE6B48), dark charcoal text (#1C1917), natural morning sunlight across a cozy wooden desk, open laptop showing the clean software dashboard, ceramic coffee mug with gentle steam, spiral notebook.
- Tone: Empathetic, ambitious, sharp, authentic. Zero hype, zero cringe, zero fake guarantees.

Choose a format:
- "image": An aesthetic feed photo or editorial lifestyle mockup.
- "showcase_reel": A sleek, aesthetic Reel showcasing a software feature! Needs:
  - software_name: "${defaultSoftwareName}"
  - problem_hook: (max 52 chars, e.g. ${isWebsitePredictor ? '"Building custom websites wastes weeks of time?"' : '"Sending 100 applications with 0 callbacks?"'})
  - features: (array of 2-3 killer features, each max 55 chars, e.g. ${isWebsitePredictor ? '["Instant Autonomous Web Builder", "Future Trend Prediction Engine", "One-Click Instant Deploy"]' : '["AI Resume Match Score", "Live Opportunities (<48h)", "1-Click Direct Apply"]'})
  - cta: (max 40 chars, e.g. ${isWebsitePredictor ? '"DM \'REXION\' for early access"' : '"Explore jobs on rexion.ai"'})
- "tips_reel": 3 actionable career / development tips. Needs headline (max 48 chars), 3 tips (each max 55 chars), cta (max 40 chars).
- "quote_reel": one powerful mindset statement (max 90 chars), subtext (max 70 chars), cta (max 40 chars).

Rules:
- image_prompt: A prompt crafted for FLUX.1 to generate an ultra-aesthetic warm editorial photograph:
  "Warm cream and ivory background, sunlit wooden workspace with an open laptop displaying the ${defaultSoftwareName} software dashboard with clean analytics and modern UI, ceramic coffee mug with 'Progress looks good on you' note, spiral notebook with handwritten checklist, small potted green plant, soft morning sunlight casting gentle shadows, warm terracotta and cream tones, minimal and premium, 8k commercial photography"
  NEVER include: neon, cyberpunk, dark background, lasers, robots, floating 3D cubes, gibberish text.

Return JSON: {"format","pillar","title","message","image_prompt","headline","tips":[],"statement","subtext","software_name","problem_hook","features":[],"cta"}`;
  return retry("ai plan", async () => PlanSchema.parse(JSON.parse(extractJson(await ask([{ type: "text", text: prompt }], 1500)))), 3, 1000);
}

export async function generateIdeas() {
  const prompt = `Suggest 7 Instagram content ideas I can film or edit this week.

${performanceContext()}

Each idea needs a real hook (first 2 seconds), a simple shot list, and why it should perform. Mix the brand pillars and lean toward what has worked.
Return a JSON array: [{"title": string, "format": "REEL" | "IMAGE", "hook": string, "shots": string, "why": string}]`;
  return retry("ai ideas", async () => IdeaSchema.parse(JSON.parse(extractJson(await ask([{ type: "text", text: prompt }], 2500)))), 3, 1000);
}

export const formatIdeas = (ideas: Awaited<ReturnType<typeof generateIdeas>>) =>
  "💡 Content ideas for this week\n\n" +
  ideas.map((i, n) => `${n + 1}. ${i.title} (${i.format})\nHook: ${i.hook}\nShots: ${i.shots}\nWhy: ${i.why}`).join("\n\n");
