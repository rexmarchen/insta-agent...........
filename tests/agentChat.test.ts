import { describe, it, expect } from "vitest";
import { handleUserMessage } from "../src/agentChat.js";
import { env } from "../src/config.js";
import { getSetting } from "../src/db.js";

describe("Agent Chat Intelligence", () => {
  it("handles /setkey command directly", async () => {
    const res = await handleUserMessage("/setkey gemini test-key-12345");
    expect(res).toContain("GEMINI API key saved");
    expect(env.GEMINI_API_KEY).toBe("test-key-12345");
    expect(getSetting("gemini_api_key")).toBe("test-key-12345");
  });

  it("handles missing AI key gracefully with guidance", async () => {
    // Clear keys temporarily for fallback test
    const oldGemini = env.GEMINI_API_KEY;
    const oldAnthropic = env.ANTHROPIC_API_KEY;
    const oldOpenAI = env.OPENAI_API_KEY;
    env.GEMINI_API_KEY = "";
    env.ANTHROPIC_API_KEY = "";
    env.OPENAI_API_KEY = "";

    const res = await handleUserMessage("What should I post today?");
    expect(res).toContain("Rovia here");
    expect(res).toContain("No AI provider key configured");

    // Restore keys
    env.GEMINI_API_KEY = oldGemini;
    env.ANTHROPIC_API_KEY = oldAnthropic;
    env.OPENAI_API_KEY = oldOpenAI;
  });

  it("handles /projects command", async () => {
    const res = await handleUserMessage("/projects");
    expect(res).toContain("Registered Software Projects");
    expect(res).toContain("rexionAI");
  });
});
