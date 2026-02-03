/**
 * Podium WebSocket client.
 * Connect with ?token=<token>&timezone=<IANA>.
 * Outgoing messages must use exact keys: message_type (lowercase, e.g. "join"), outpost_uuid (snake_case).
 *
 * Muting/speaking: start_speaking when bot unmutes, stop_speaking when bot mutes (see docs/AGENT_MUTING_AND_SPEAKING_TIME.md).
 */

import WebSocket from "ws";
import type { WSOutMessage, WSInMessage } from "./types";
import { WS_INCOMING_NAMES } from "./types";
import { logger } from "../logging";

/** Podium backend expects lowercase message_type values (e.g. "join", not "JOIN"). */
const WS_SEND_TYPES = {
  JOIN: "join",
  LEAVE: "leave",
  START_SPEAKING: "start_speaking",
  STOP_SPEAKING: "stop_speaking",
} as const;

export interface PodiumWSConfig {
  wsAddress: string;
  token: string;
  timezone?: string;
}

export type WSMessageHandler = (msg: WSInMessage) => void;

export class PodiumWS {
  private ws: WebSocket | null = null;
  private readonly config: PodiumWSConfig;
  private handlers: WSMessageHandler[] = [];

  constructor(config: PodiumWSConfig) {
    this.config = config;
  }

  onMessage(handler: WSMessageHandler): void {
    this.handlers.push(handler);
  }

  connect(): Promise<void> {
    const token = this.config.token?.trim() ?? "";
    if (!token) {
      return Promise.reject(new Error("WebSocket auth: token is missing. Set PODIUM_TOKEN in .env.local."));
    }
    const tz = this.config.timezone ?? (typeof Intl !== "undefined" && Intl.DateTimeFormat?.().resolvedOptions?.().timeZone) ?? "America/New_York";
    const url = `${this.config.wsAddress}?token=${encodeURIComponent(token)}&timezone=${encodeURIComponent(tz)}`;
    const urlForLog = `${this.config.wsAddress}?token=${token ? "[REDACTED]" : "[MISSING]"}&timezone=${encodeURIComponent(tz)}`;
    logger.debug({ event: "WS_CONNECT", url: urlForLog, hasToken: !!token, timezone: tz }, "WebSocket connecting (auth in URL)");
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.on("open", () => resolve());
      this.ws.on("error", reject);
      this.ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as WSInMessage;
          if (msg.name === "error") {
            const errMsg = (msg.data as Record<string, unknown>)?.message as string | undefined;
            logger.warn({ event: "WS_ERROR", message: errMsg, data: msg.data }, "WebSocket server error");
          }
          logger.debug({ event: "WS_MESSAGE", name: msg.name, data: msg.data }, "WebSocket message");
          this.handlers.forEach((h) => h(msg));
        } catch {
          // ignore parse errors
        }
      });
    });
  }

  send(msg: WSOutMessage | Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.debug({ event: "WS_SEND_SKIP", reason: "not connected" }, "WebSocket send skipped (not connected)");
      return;
    }
    const str = JSON.stringify(msg);
    logger.debug({ event: "WS_SEND", payload: str }, "WebSocket send");
    this.ws.send(str);
  }

  /** Send JOIN and wait for user.joined for this user (match by address or uuid). */
  async joinOutpost(
    outpostUuid: string,
    myAddress: string,
    options?: { myUuid?: string; timeoutMs?: number }
  ): Promise<void> {
    const myUuid = options?.myUuid;
    const timeoutMs = options?.timeoutMs ?? 15000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        logger.warn({ event: "WS_JOIN_TIMEOUT", outpostUuid, myAddress }, "Join timeout – no user.joined received");
        reject(new Error("Join timeout"));
      }, timeoutMs);
      const handler = (msg: WSInMessage) => {
        const isJoinEvent = msg.name === WS_INCOMING_NAMES.USER_JOINED || msg.name === "user_joined";
        if (!isJoinEvent) return;
        const data = msg.data as Record<string, unknown> | undefined;
        const matchAddress = data && typeof data.address === "string" && data.address === myAddress;
        const matchUuid = myUuid && data && typeof data.uuid === "string" && data.uuid === myUuid;
        if (matchAddress || matchUuid) {
          clearTimeout(timer);
          this.handlers = this.handlers.filter((h) => h !== handler);
          resolve();
        }
      };
      this.onMessage(handler);
      const payload = { message_type: WS_SEND_TYPES.JOIN, outpost_uuid: outpostUuid, data: {} };
      logger.debug({ event: "WS_JOIN_SEND", outpostUuid, payload }, "Sending JOIN");
      this.send(payload);
    });
  }

  leave(outpostUuid: string): void {
    this.send({ message_type: WS_SEND_TYPES.LEAVE, outpost_uuid: outpostUuid, data: {} });
  }

  startSpeaking(outpostUuid: string): void {
    this.send({ message_type: WS_SEND_TYPES.START_SPEAKING, outpost_uuid: outpostUuid, data: {} });
  }

  stopSpeaking(outpostUuid: string): void {
    this.send({ message_type: WS_SEND_TYPES.STOP_SPEAKING, outpost_uuid: outpostUuid, data: {} });
  }

  /** Reactions: data must include react_to_user_address (wallet address of target user). */
  sendReaction(outpostUuid: string, reactionType: "like" | "dislike" | "boo" | "cheer", reactToUserAddress: string): void {
    this.send({
      message_type: reactionType,
      outpost_uuid: outpostUuid,
      data: { react_to_user_address: reactToUserAddress },
    });
  }

  /** True if WebSocket is open (for watchdog). */
  isConnected(): boolean {
    return this.ws != null && this.ws.readyState === WebSocket.OPEN;
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
