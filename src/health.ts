import http from "node:http";
import { env } from "./config.js";
import { db, getSetting } from "./db.js";

/** Tiny HTTP endpoint for uptime monitors and Docker HEALTHCHECK. */
export function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    try {
      const counts = db.prepare("SELECT status, COUNT(*) c FROM posts GROUP BY status").all();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()), paused: getSetting("paused") === "1", posts: counts }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
    }
  });
  server.listen(env.PORT, () => {});
  return server;
}
