/**
 * Podium REST API client.
 * Auth: Authorization: Bearer <token>. Base URL from config.
 * On 401/403 logs AUTH_FAILURE for alerting (see docs/TOKEN_ROTATION_SOP.md).
 */
import type { User, OutpostModel, OutpostLiveData } from "./types";
export interface PodiumApiConfig {
    baseUrl: string;
    token: string;
}
export declare class PodiumApi {
    private readonly config;
    constructor(config: PodiumApiConfig);
    /**
     * Podium REST: Auth is Bearer token; successful responses put payload in response.data.data.
     * Base URL has no trailing slash; paths appended as-is.
     */
    private request;
    /** GET /users/profile */
    getProfile(): Promise<User>;
    /** GET /outposts/detail?uuid=<uuid> */
    getOutpost(uuid: string): Promise<OutpostModel>;
    /** POST /outposts/add-me-as-member. Body: { uuid: outpostUuid }, optional inviter_uuid (user UUID). */
    addMeAsMember(outpostId: string, inviterUuid?: string): Promise<unknown>;
    /** GET /outposts/online-data?uuid=<uuid>. Call only after successful WS join. 422 = "outpost is not live" or "user is not in the session". */
    getLatestLiveData(outpostId: string): Promise<OutpostLiveData>;
    /** POST /outposts/creator-joined (creator only) */
    setCreatorJoinedToTrue(outpostId: string): Promise<unknown>;
    /** POST /outposts/leave */
    leave(outpostId: string): Promise<unknown>;
}
//# sourceMappingURL=api.d.ts.map