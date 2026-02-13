/**
 * Podium REST API client.
 * Auth: Authorization: Bearer <token>. Base URL from config.
 * On 401/403 logs AUTH_FAILURE for alerting (see docs/TOKEN_ROTATION_SOP.md).
 */

import type { User, OutpostModel, OutpostLiveData } from "./types";
import { logger } from "../logging";

export interface PodiumApiConfig {
  baseUrl: string;
  token: string;
}

export class PodiumApi {
  constructor(private readonly config: PodiumApiConfig) {}

  /**
   * Podium REST: Auth is Bearer token; successful responses put payload in response.data.data.
   * Base URL has no trailing slash; paths appended as-is.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.token}`,
      "Content-Type": "application/json",
    };
    const options: RequestInit = { method, headers };
    if (body != null) options.body = JSON.stringify(body);
    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 401 || response.status === 403) {
        logger.warn(
          { event: "AUTH_FAILURE", source: "api", method, path, status: response.status },
          "Podium API auth failure – token may be invalid or expired"
        );
      }
      throw new Error(`Podium API ${method} ${path}: ${response.status} ${text}`);
    }
    if (response.status === 204) return undefined as T;
    const json = (await response.json()) as Record<string, unknown>;
    if (json?.data != null && typeof json.data === "object" && "data" in json.data) {
      return (json.data as Record<string, unknown>).data as T;
    }
    if (json?.data != null) return json.data as T;
    return json as T;
  }

  /** GET /users/profile */
  async getProfile(): Promise<User> {
    return this.request<User>("GET", "/users/profile");
  }

  /** GET /outposts/detail?uuid=<uuid> */
  async getOutpost(uuid: string): Promise<OutpostModel> {
    return this.request<OutpostModel>("GET", `/outposts/detail?uuid=${encodeURIComponent(uuid)}`);
  }

  /** POST /outposts/add-me-as-member. Body: { uuid: outpostUuid }, optional inviter_uuid (user UUID). */
  async addMeAsMember(outpostId: string, inviterUuid?: string): Promise<unknown> {
    const body: Record<string, string> = { uuid: outpostId };
    if (inviterUuid) body.inviter_uuid = inviterUuid;
    return this.request("POST", "/outposts/add-me-as-member", body);
  }

  /** GET /outposts/online-data?uuid=<uuid>. Call only after successful WS join. 422 = "outpost is not live" or "user is not in the session". */
  async getLatestLiveData(outpostId: string): Promise<OutpostLiveData> {
    return this.request<OutpostLiveData>(
      "GET",
      `/outposts/online-data?uuid=${encodeURIComponent(outpostId)}`
    );
  }

  /** POST /outposts/creator-joined (creator only) */
  async setCreatorJoinedToTrue(outpostId: string): Promise<unknown> {
    return this.request("POST", "/outposts/creator-joined", { uuid: outpostId });
  }

  /** POST /outposts/leave */
  async leave(outpostId: string): Promise<unknown> {
    return this.request("POST", "/outposts/leave", { uuid: outpostId });
  }
}
