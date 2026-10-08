import http from "node:http";
import { DateTime } from "luxon";
import { env } from "./config.js";
import { db, getSetting } from "./db.js";
import { log } from "./log.js";

export type HealthServerHandlers = {
  onPublishDue?: () => Promise<any>;
  onSmartCreate?: () => Promise<any>;
};

/**
 * Production-ready HTTP Operations and Health Server for Render & Docker.
 * Provides:
 * - GET / and GET /health: Health metrics, uptime, queue status, and next scheduled posts.
 * - GET /ping: Fast 200 OK for uptime monitors to prevent Render free-tier sleep.
 * - GET or POST /cron or /cron/publish: Trigger due posts immediately via external cron.
 * - GET or POST /cron/create: Trigger queue top-up generation.
 */
export function startHealthServer(handlers: HealthServerHandlers = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname.replace(/\/$/, "") || "/";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    // Ping endpoint for fast uptime check
    if (pathname === "/ping") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("PONG");
      return;
    }

    // Manual or External Cron Trigger: publish due posts
    if (pathname === "/cron" || pathname === "/cron/publish" || pathname === "/cron/publish-reel") {
      try {
        log.info("HTTP cron trigger received: publishDue");
        const result = handlers.onPublishDue ? await handlers.onPublishDue() : { skipped: "No handler configured" };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, trigger: "publishDue", result }));
      } catch (err: any) {
        log.error({ err: err.message }, "HTTP cron publishDue error");
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Manual or External Cron Trigger: fill queue
    if (pathname === "/cron/create") {
      try {
        log.info("HTTP cron trigger received: smartCreate");
        const result = handlers.onSmartCreate ? await handlers.onSmartCreate() : { skipped: "No handler configured" };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, trigger: "smartCreate", result }));
      } catch (err: any) {
        log.error({ err: err.message }, "HTTP cron smartCreate error");
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Health and Status endpoints
    if (pathname === "/health" || pathname === "/" || pathname === "/status") {
      try {
        const counts = db.prepare("SELECT status, COUNT(*) c FROM posts GROUP BY status").all();
        const nextPosts = db
          .prepare(
            "SELECT id, kind, status, scheduled_at FROM posts WHERE status = 'approved' ORDER BY scheduled_at ASC LIMIT 4"
          )
          .all() as { id: number; kind: string; status: string; scheduled_at: string }[];

        const nowIST = DateTime.now().setZone(env.TIMEZONE);
        const generations = db.prepare("SELECT id, day, format, ok, detail, created_at FROM generations ORDER BY id DESC LIMIT 5").all();

        const statusData = {
          ok: true,
          status: "healthy",
          uptimeSeconds: Math.round(process.uptime()),
          timeIST: nowIST.toFormat("yyyy-MM-dd HH:mm:ss ZZZZ"),
          autopilot: getSetting("autopilot", env.AUTOPILOT ? "on" : "off"),
          paused: getSetting("paused") === "1",
          postCounts: counts,
          upcomingQueue: nextPosts.map((p) => ({
            id: p.id,
            kind: p.kind,
            scheduledIST: p.scheduled_at
              ? DateTime.fromISO(p.scheduled_at).setZone(env.TIMEZONE).toFormat("EEE dd LLL, h:mm a")
              : null,
            scheduledUTC: p.scheduled_at,
          })),
          recentGenerations: generations,
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(statusData, null, 2));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "Not found. Try /health, /ping, or /cron" }));
  });

  server.listen(env.PORT, "0.0.0.0", () => {
    log.info({ port: env.PORT }, "Production health and cron server listening on 0.0.0.0");
  });

  // Built-in 24/7 Render Keep-Alive: Ping /cron/publish every 4 minutes to guarantee it never sleeps AND auto-publishes due posts
  const renderUrl = process.env.RENDER_EXTERNAL_URL || "https://insta-agent-ekqb.onrender.com";
  if (renderUrl) {
    const pingTarget = `${renderUrl.replace(/\/$/, "")}/cron/publish`;
    log.info({ pingTarget }, "Enabling continuous 24/7 keep-alive and auto-publisher for Render (every 4m)");
    setInterval(async () => {
      try {
        const res = await fetch(pingTarget, { signal: AbortSignal.timeout(15_000) });
        if (res.ok) {
          log.info("24/7 Keep-alive and publish check succeeded");
        }
      } catch (err: any) {
        log.warn({ err: err.message }, "Keep-alive ping attempt failed");
      }
    }, 4 * 60 * 1000); // 4 minutes ensures Render's 15m idle timer never triggers and due posts never wait
  }

  return server;
}
