/**
 * Minimal HTTP health server for liveness and readiness (e.g. Kubernetes).
 * GET /health -> 200 if process is up.
 * GET /ready -> 200 only if getReady() returns true (WS connected and joined), else 503.
 */
import * as http from "http";
export interface HealthServerOptions {
    port?: number;
    /** Return true when the agent is ready to serve (WS connected, room joined, pipeline ready). */
    getReady?: () => boolean;
}
export declare function startHealthServer(options?: HealthServerOptions): http.Server;
//# sourceMappingURL=health-server.d.ts.map