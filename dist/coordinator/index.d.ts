/**
 * Turn Coordinator: HTTP service for multi-agent turn-taking.
 * Run as a separate process. Agents GET /recent-turns, POST /request-turn, poll GET /turn-decision, POST /end-turn.
 * Uses lease-based grants: winner receives turnId and leaseMs; must POST /end-turn with turnId (or lease auto-expires).
 */
import * as http from "http";
declare const server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;
export { server };
//# sourceMappingURL=index.d.ts.map