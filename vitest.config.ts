import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      ANTHROPIC_API_KEY: "test",
      IG_USER_ID: "1",
      IG_ACCESS_TOKEN: "test",
      CLOUDINARY_URL: "cloudinary://a:b@c",
      TELEGRAM_BOT_TOKEN: "test",
      TELEGRAM_CHAT_ID: "1",
      DB_PATH: ":memory:",
      TIMEZONE: "UTC",
      POST_SLOTS: "09:00,13:00,19:00",
      MAX_POSTS_PER_DAY: "2",
      LOG_LEVEL: "silent",
    },
  },
});
