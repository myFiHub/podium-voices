/**
 * Minimal HTTP health server for liveness and readiness (e.g. Kubernetes).
 * GET /health -> 200 if process is up.
 * GET /ready -> 200 only if getReady() returns true (WS connected and joined), else 503.
 */

import * as http from "http";
import { logger } from "./logging";

const DEFAULT_PORT = 8080;

export interface HealthServerOptions {
  port?: number;
  /** Return true when the agent is ready to serve (WS connected, room joined, pipeline ready). */
  getReady?: () => boolean;
}

export function startHealthServer(options: HealthServerOptions = {}): http.Server {
  const port = options.port ?? (parseInt(process.env.HEALTH_PORT ?? String(DEFAULT_PORT), 10) || DEFAULT_PORT);
  const getReady = options.getReady ?? (() => false);

  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && (url === "/health" || url === "/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "GET" && url === "/ready") {
      const ready = getReady();
      const status = ready ? 200 : 503;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: ready, ready }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    logger.info({ event: "HEALTH_SERVER_STARTED", port }, "Health server listening");
  });

  return server;
}
