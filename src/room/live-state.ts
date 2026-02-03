import type { LiveMember, OutpostLiveData, WSInMessage } from "./types";
import { WS_INCOMING_NAMES } from "./types";
import { logger } from "../logging";

export interface LiveStateConfig {
  /** The bot's Podium user identity. */
  selfAddress: string;
  selfUuid: string;
  /** Outpost creator UUID (creator has unlimited time). */
  creatorUuid: string;
}

export interface SpeakAllowance {
  allowed: boolean;
  reason?: string;
}

type MemberState = {
  address: string;
  uuid: string;
  remainingTime?: number;
  isSpeaking?: boolean;
  lastUpdatedAt: number;
};

/**
 * LiveState tracks per-member speaking time + speaking state based on:
 * - initial snapshot from GET /outposts/online-data
 * - incremental WS updates (remaining_time.updated, user.time_is_up, started/stopped_speaking)
 *
 * Source of truth is the server; this module does not run a local countdown.
 */
export class LiveState {
  private readonly cfg: LiveStateConfig;
  private membersByAddress = new Map<string, MemberState>();

  constructor(cfg: LiveStateConfig) {
    this.cfg = cfg;
  }

  applySnapshot(live: OutpostLiveData): void {
    const now = Date.now();
    this.membersByAddress.clear();
    for (const m of live.members ?? []) {
      this.membersByAddress.set(m.address, {
        address: m.address,
        uuid: m.uuid,
        remainingTime: m.remaining_time,
        isSpeaking: m.is_speaking,
        lastUpdatedAt: now,
      });
    }
    logger.debug({ event: "LIVE_STATE_SNAPSHOT", members: this.membersByAddress.size }, "LiveState snapshot applied");
  }

  handleWSMessage(msg: WSInMessage): void {
    const data = msg.data as Record<string, unknown> | undefined;
    const address = data && typeof data.address === "string" ? data.address : undefined;
    const now = Date.now();

    if (msg.name === WS_INCOMING_NAMES.REMAINING_TIME_UPDATED) {
      if (!address) return;
      const remaining = typeof data?.remaining_time === "number" ? data.remaining_time : undefined;
      const state = this.upsertAddress(address, now);
      if (remaining != null) state.remainingTime = remaining;
      state.lastUpdatedAt = now;
      return;
    }

    if (msg.name === WS_INCOMING_NAMES.USER_TIME_IS_UP) {
      if (!address) return;
      const state = this.upsertAddress(address, now);
      state.remainingTime = 0;
      state.isSpeaking = false;
      state.lastUpdatedAt = now;
      return;
    }

    if (msg.name === WS_INCOMING_NAMES.USER_STARTED_SPEAKING) {
      if (!address) return;
      const state = this.upsertAddress(address, now);
      state.isSpeaking = true;
      state.lastUpdatedAt = now;
      return;
    }

    if (msg.name === WS_INCOMING_NAMES.USER_STOPPED_SPEAKING) {
      if (!address) return;
      const state = this.upsertAddress(address, now);
      state.isSpeaking = false;
      state.lastUpdatedAt = now;
      return;
    }
  }

  /** Returns true if this bot is the creator (unlimited speaking time). */
  isCreator(): boolean {
    return this.cfg.selfUuid === this.cfg.creatorUuid;
  }

  /** Get the bot's remaining time (seconds), or \"unlimited\" for creator, or \"unknown\" if not present. */
  getSelfRemainingTime(): number | "unlimited" | "unknown" {
    if (this.isCreator()) return "unlimited";
    const self = this.membersByAddress.get(this.cfg.selfAddress);
    if (!self || self.remainingTime == null) return "unknown";
    return self.remainingTime;
  }

  /** Nexus parity rule: if not creator and remaining_time <= 0, do not start speaking. */
  canSpeakNow(): SpeakAllowance {
    if (this.isCreator()) return { allowed: true };
    const rt = this.getSelfRemainingTime();
    if (rt === "unknown") return { allowed: true, reason: "remaining_time_unknown" };
    if (rt === "unlimited") return { allowed: true };
    if (typeof rt === "number" && rt <= 0) return { allowed: false, reason: "time_is_up" };
    return { allowed: true };
  }

  isSelfTimeUpEvent(msg: WSInMessage): boolean {
    if (msg.name !== WS_INCOMING_NAMES.USER_TIME_IS_UP) return false;
    const data = msg.data as Record<string, unknown> | undefined;
    return !!data && data.address === this.cfg.selfAddress;
  }

  private upsertAddress(address: string, now: number): MemberState {
    const existing = this.membersByAddress.get(address);
    if (existing) return existing;
    const created: MemberState = { address, uuid: "", lastUpdatedAt: now };
    this.membersByAddress.set(address, created);
    return created;
  }
}

