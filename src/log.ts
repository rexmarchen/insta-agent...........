import pino from "pino";
import { env } from "./config.js";

export const log = pino({
  level: env.LOG_LEVEL,
  redact: ["*.access_token", "*.token", "*.apiKey"],
  base: undefined,
});
