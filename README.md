# REXEDITZZ Super-Human Intelligence Instagram Agent

An autonomous AI agent that manages, creates, and publishes content to your Instagram account (@anshu._io) every day at **7:00 PM IST** on complete autopilot, with **full natural language control via Telegram**.

```
                        +--> Your photos/videos in inbox/ ----------------+
Super-Human AI Brain  --+                                                 |
(Claude / Gemini /      +--> AI Image (Gemini / Cloudflare / Local GPU)   |
OpenAI / Groq)          +--> Branded Reel (FFmpeg tips & quote templates) |
                                                                          v
                       FFmpeg prep -> Public hosting (Cloudinary/Catbox) -> AI Vision Drafts
                                                                          v
             Telegram Super-Intelligence Agent: Text ANY instruction, voice, or approve/redo
                                                                          v
    Autopilot Scheduler (7:00 PM IST daily) -> Instagram Graph API -> Insights feedback loop
```

---

## ⚡ Super-Human Features

1. **Autonomous Daily Posting at 7:00 PM IST**:
   - `TIMEZONE=Asia/Kolkata`, `POST_SLOTS=19:00`, `AUTOPILOT=true`.
   - When the queue is empty, the AI Creative Director automatically plans, generates an image or branded reel, writes an SEO-optimized caption with hooks and hashtags, and publishes it at 7:00 PM IST every single day.

2. **Natural Language Telegram Control**:
   - You can text your Telegram bot anything in plain English:
     - *"Create a post about luxury video editing tips"*
     - *"Make an animated tips reel on 3 hooks for real estate agents"*
     - *"Publish post #1 right now"*
     - *"Rewrite the caption for #2 to be punchier with more intrigue"*
     - *"Show me upcoming scheduled posts and queue"*
     - *"Pause publishing"* / *"Resume"*
     - *"What's our best performing post this month?"*
     - *`/setkey gemini AIza...`* (configure AI keys directly in Telegram without touching code)

3. **Multi-AI Provider Support**:
   - Works with **Google Gemini** (`gemini-2.5-flash`), **Anthropic Claude** (`claude-sonnet-5-5`), or **OpenAI** (`gpt-4o`).
   - You can get a free Gemini API key from [Google AI Studio](https://aistudio.google.com/) and start generating immediately with zero cost.

4. **Self-Healing Token & Zero Native Build Dependencies**:
   - Connected directly to Meta Graph API for `@anshu._io` (`39134971926150240`).
   - Automatically refreshes your 60-day Instagram access token every 25 days so it **never expires**.
   - Built on native `node:sqlite` (Node 24) and dynamic FFmpeg discovery with zero C++ compiler requirements.
   - Built-in public media hosting with automatic Catbox fallback so publishing works immediately even before configuring Cloudinary.

---

## 🚀 Quick Start

1. **Clone & Install**:
   ```bash
   npm install
   ```

2. **Configure `.env`**:
   The `.env` file is already created with your Instagram App ID, Secret, User ID (`39134971926150240`), 60-day token, and 7:00 PM IST schedule.
   
   To connect your Telegram bot:
   - Message **@BotFather** on Telegram -> `/newbot` -> copy token into `TELEGRAM_BOT_TOKEN=`.
   - Add your AI key: `GEMINI_API_KEY=` or `ANTHROPIC_API_KEY=`.

3. **Start the Agent**:
   ```bash
   npm run dev
   ```

---

## 📱 Telegram Commands & Controls

| Command / Prompt | What It Does |
| :--- | :--- |
| `Any natural sentence` | Agent analyzes intent, plans/generates content, updates settings, or answers questions |
| `/status` | Real-time system health, next 7 PM slot, queue depth, and account info |
| `/queue` | View all scheduled posts and their planned publication time |
| `/generate [topic]` | Immediately creates an AI image or reel on the given topic |
| `/postnow [id]` | Immediately publishes a draft or post to Instagram live |
| `/autopilot on\|off` | Toggle between fully autonomous mode and approval-only mode |
| `/setkey gemini\|anthropic <key>` | Save and activate an AI model key on the fly |
| `/refreshtoken` | Manually extend your Instagram access token for another 60 days |
| `/ideas` | Brainstorm 7 viral content concepts tailored to your brand |
| `/pause` / `/resume` | Emergency stop / resume for publishing |

---

## 🛠️ Verification & Tests

Run the comprehensive test suite anytime:
```bash
npm test
```
All tests validate caption generation, scheduling, state machines, FFmpeg rendering, and Instagram API routing.
