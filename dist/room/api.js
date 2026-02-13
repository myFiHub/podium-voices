"use strict";
/**
 * Podium REST API client.
 * Auth: Authorization: Bearer <token>. Base URL from config.
 * On 401/403 logs AUTH_FAILURE for alerting (see docs/TOKEN_ROTATION_SOP.md).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PodiumApi = void 0;
const logging_1 = require("../logging");
class PodiumApi {
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * Podium REST: Auth is Bearer token; successful responses put payload in response.data.data.
     * Base URL has no trailing slash; paths appended as-is.
     */
    async request(method, path, body) {
        const url = `${this.config.baseUrl.replace(/\/$/, "")}${path}`;
        const headers = {
            Authorization: `Bearer ${this.config.token}`,
            "Content-Type": "application/json",
        };
        const options = { method, headers };
        if (body != null)
            options.body = JSON.stringify(body);
        const response = await fetch(url, options);
        if (!response.ok) {
            const text = await response.text();
            if (response.status === 401 || response.status === 403) {
                logging_1.logger.warn({ event: "AUTH_FAILURE", source: "api", method, path, status: response.status }, "Podium API auth failure – token may be invalid or expired");
            }
            throw new Error(`Podium API ${method} ${path}: ${response.status} ${text}`);
        }
        if (response.status === 204)
            return undefined;
        const json = (await response.json());
        if (json?.data != null && typeof json.data === "object" && "data" in json.data) {
            return json.data.data;
        }
        if (json?.data != null)
            return json.data;
        return json;
    }
    /** GET /users/profile */
    async getProfile() {
        return this.request("GET", "/users/profile");
    }
    /** GET /outposts/detail?uuid=<uuid> */
    async getOutpost(uuid) {
        return this.request("GET", `/outposts/detail?uuid=${encodeURIComponent(uuid)}`);
    }
    /** POST /outposts/add-me-as-member. Body: { uuid: outpostUuid }, optional inviter_uuid (user UUID). */
    async addMeAsMember(outpostId, inviterUuid) {
        const body = { uuid: outpostId };
        if (inviterUuid)
            body.inviter_uuid = inviterUuid;
        return this.request("POST", "/outposts/add-me-as-member", body);
    }
    /** GET /outposts/online-data?uuid=<uuid>. Call only after successful WS join. 422 = "outpost is not live" or "user is not in the session". */
    async getLatestLiveData(outpostId) {
        return this.request("GET", `/outposts/online-data?uuid=${encodeURIComponent(outpostId)}`);
    }
    /** POST /outposts/creator-joined (creator only) */
    async setCreatorJoinedToTrue(outpostId) {
        return this.request("POST", "/outposts/creator-joined", { uuid: outpostId });
    }
    /** POST /outposts/leave */
    async leave(outpostId) {
        return this.request("POST", "/outposts/leave", { uuid: outpostId });
    }
}
exports.PodiumApi = PodiumApi;
//# sourceMappingURL=api.js.map