import path from "node:path";
import { DateTime } from "luxon";
import { env } from "../config.js";
import { db, getSetting } from "../db.js";
import { log } from "../log.js";
import { errMsg } from "../util.js";
import { planContent, type Plan } from "../brain.js";
import { generateImage } from "./image.js";
import { renderReel, type ReelContent } from "./reel.js";
import { coverCrop } from "../media.js";
import { ingestFile } from "../pipeline.js";

const WORK = "work";
const today = () => DateTime.now().setZone(env.TIMEZONE).toISODate()!;
const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { c: number }).c;

export const queueDepth = () => count("SELECT COUNT(*) c FROM posts WHERE status IN ('new','drafted','approved')");
export const generatedToday = () => count("SELECT COUNT(*) c FROM generations WHERE day = ? AND ok = 1", today());

function validate(p: Plan) {
  if (p.format === "image" && !p.image_prompt.trim()) throw new Error("plan: image format needs image_prompt");
  if (p.format === "tips_reel" && (!p.headline.trim() || p.tips.filter(Boolean).length < 2)) throw new Error("plan: tips_reel needs headline and at least 2 tips");
  if (p.format === "quote_reel" && !p.statement.trim()) throw new Error("plan: quote_reel needs a statement");
  if (p.format === "showcase_reel" && (!p.software_name.trim() || !p.problem_hook.trim())) throw new Error("plan: showcase_reel needs software_name and problem_hook");
}

const briefOf = (p: Plan) =>
  [
    `${p.title}.`,
    `Core message: ${p.message}`,
    p.software_name && `Featuring software: ${p.software_name}`,
    p.problem_hook && `Hook problem: ${p.problem_hook}`,
    p.headline && `On-screen headline: ${p.headline}`,
    p.tips.length && `Tips shown: ${p.tips.join(" | ")}`,
    p.statement && `Statement shown: ${p.statement}`,
    "Visuals are AI-generated / motion graphics, not real footage.",
  ]
    .filter(Boolean)
    .join(" ");

/**
 * Plans, generates and ingests one piece of content. Returns a human-readable result.
 * Opt-in (ENABLE_GENERATION) and capped per day so a bug can never burn through quota or fill the queue.
 */
export async function createContent(opts: { topic?: string; ignoreQueue?: boolean; bypassLimit?: boolean } = {}): Promise<string> {
  const cap = Number(getSetting("max_generations_per_day", String(env.MAX_GENERATIONS_PER_DAY)));
  if (!env.ENABLE_GENERATION) return "Generation is off. Set ENABLE_GENERATION=true to enable it.";
  if (!opts.bypassLimit && generatedToday() >= cap) return `Daily generation cap reached (${cap}).`;
  if (count("SELECT COUNT(*) c FROM generations WHERE day = ? AND ok = 0", today()) >= 10) return "Too many failed generations today, pausing until tomorrow.";
  if (!opts.ignoreQueue && queueDepth() >= env.QUEUE_TARGET) return `Queue already has ${queueDepth()} posts (target ${env.QUEUE_TARGET}).`;

  let format = "unknown";
  let provider = "";
  try {
    const plan = await planContent(opts.topic);
    validate(plan);
    format = plan.format;
    const stamp = Date.now();

    let file: string;
    if (plan.format === "image") {
      const img = await generateImage(plan.image_prompt, "4:5", WORK);
      provider = img.provider;
      file = await coverCrop(img.file, path.join(WORK, `gen-${stamp}-feed.jpg`), 1080, 1350);
    } else {
      let bgImage: string | undefined;
      if (plan.image_prompt.trim()) {
        try {
          const img = await generateImage(plan.image_prompt, "9:16", WORK);
          provider = img.provider;
          bgImage = await coverCrop(img.file, path.join(WORK, `gen-${stamp}-bg.jpg`), 1080, 1920);
        } catch (e) {
          log.warn({ err: errMsg(e) }, "background image failed, using gradient background");
        }
      }
      let content: ReelContent;
      if (plan.format === "showcase_reel") {
        content = {
          template: "showcase",
          softwareName: plan.software_name || "Software",
          problemHook: plan.problem_hook || plan.title,
          features: plan.features.filter(Boolean).length ? plan.features.filter(Boolean) : [plan.message],
          cta: plan.cta,
        };
      } else if (plan.format === "tips_reel") {
        content = { template: "tips", headline: plan.headline, tips: plan.tips.filter(Boolean), cta: plan.cta };
      } else {
        content = { template: "quote", statement: plan.statement, subtext: plan.subtext, cta: plan.cta };
      }

      file = (await renderReel(content, path.join(WORK, `gen-${stamp}-${plan.format}.mp4`), { bgImage, workDir: WORK })).file;
    }

    const id = await ingestFile(file, { generated: true, brief: briefOf(plan) });
    db.prepare("INSERT INTO generations (day, format, provider, ok, detail) VALUES (?, ?, ?, 1, ?)").run(today(), format, provider, `post ${id}`);
    return `Created ${plan.format.replace("_", " ")} "${plan.title}" as post #${id}. A draft will arrive shortly.`;
  } catch (e) {
    db.prepare("INSERT INTO generations (day, format, provider, ok, detail) VALUES (?, ?, ?, 0, ?)").run(today(), format, provider, errMsg(e).slice(0, 500));
    throw e;
  }
}
