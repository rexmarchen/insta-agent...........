import "dotenv/config";
import { z } from "zod";

const bool = (def: string) =>
  z.string().default(def).transform((v) => ["true", "1", "yes", "on"].includes(v.toLowerCase()));

const defaultFont =
  process.platform === "win32"
    ? "C:/Windows/Fonts/arialbd.ttf"
    : process.platform === "darwin"
      ? "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
      : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const schema = z.object({
  // Core AI Providers (at least one recommended)
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default("claude-sonnet-5-5"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_TEXT_MODEL: z.string().default("gemini-2.5-flash"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  GROQ_API_KEY: z.string().optional(),

  // Instagram Graph API
  IG_APP_ID: z.string().optional(),
  IG_APP_SECRET: z.string().optional(),
  IG_USER_ID: z.string().default("39134971926150240"),
  IG_ACCESS_TOKEN: z.string().min(1),
  GRAPH_VERSION: z.string().default("v23.0"),
  IG_GRAPH_BASE: z.string().optional(),

  // Media hosting (Cloudinary or Catbox fallback)
  CLOUDINARY_URL: z.string().optional(),

  // Telegram bot
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // Scheduling (Photos at 5 PM IST, Reels at 7 PM IST default)
  TIMEZONE: z.string().default("Asia/Kolkata"),
  POST_SLOTS: z.string().default("17:00,19:00"),
  POST_IMAGE_SLOT: z.string().default("17:00"),
  POST_REEL_SLOT: z.string().default("19:00"),
  MAX_POSTS_PER_DAY: z.coerce.number().int().positive().default(2),

  // Safety & Mode
  DRY_RUN: bool("false"),
  AUTOPILOT: bool("true"),

  // Autonomous Generation
  ENABLE_GENERATION: bool("true"),
  MAX_GENERATIONS_PER_DAY: z.coerce.number().int().nonnegative().default(3),
  QUEUE_TARGET: z.coerce.number().int().positive().default(2),
  IMAGE_PROVIDERS: z.string().default("gemini,cloudflare,a1111"),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-2.5-flash-image"),
  A1111_URL: z.string().optional(),
  BRAND_FONT: z.string().default(defaultFont),

  // Media Binaries
  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),

  // Ops
  LOG_LEVEL: z.string().default("info"),
  PORT: z.coerce.number().int().default(8080),
  DB_PATH: z.string().default("data/agent.db"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error(`Invalid configuration. Fix your .env:\n${missing}`);
  process.exit(1);
}

export const env = parsed.data;
export const DRY_RUN = env.DRY_RUN;
