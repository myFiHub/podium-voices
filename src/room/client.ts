/**
 * High-level Podium room client: runs host join flow and exposes audio in/out.
 * Uses REST (api), WebSocket (ws), and Jitsi (jitsi) to join as host; then provides
 * incoming audio stream for the pipeline and a method to push TTS output.
 */

import type { User, OutpostModel, OutpostLiveData, WSInMessage } from "./types";
import { PodiumApi } from "./api";
import { PodiumWS } from "./ws";
import { createJitsiRoom } from "./jitsi";
import type { IJitsiRoom } from "./jitsi";
import { VAD } from "../pipeline/vad";

export interface RoomClientConfig {
  apiUrl: string;
  wsAddress: string;
  outpostServer: string;
  token: string;
  outpostUuid: string;
  /** Use browser bot for Jitsi (real audio). When false, JitsiStub is used. */
  useJitsiBot?: boolean;
  /** URL of the minimal bot join page. If unset and useJitsiBot, Node serves bot-page/. */
  botPageUrl?: string;
  /** XMPP domain for Jitsi (e.g. meet.jitsi). When public meet URL differs from Prosody host, set this. */
  jitsiXmppDomain?: string;
  /** XMPP MUC domain for conference rooms (e.g. muc.meet.jitsi). Jitsi Docker uses muc.<domain>; set when not using default conference.<xmppDomain>. */
  jitsiMucDomain?: string;
  /** JWT for Jitsi/Prosody meeting join. Only when deployment requires JWT auth to join the conference. */
  jitsiJwt?: string;
  /** First port to try for the Jitsi bot bridge (default 8766). If in use, next ports are tried. */
  jitsiBridgePort?: number;
}

export interface RoomClientCallbacks {
  /** Incoming audio for pipeline (16kHz mono 16-bit PCM for VAD). */
  onAudioChunk?(buffer: Buffer): void;
}

export class RoomClient {
  private api: PodiumApi;
  private ws: PodiumWS;
  private jitsi: IJitsiRoom | null = null;
  private user: User | null = null;
  private outpost: OutpostModel | null = null;
  private readonly config: RoomClientConfig;
  private callbacks: RoomClientCallbacks = {};

  constructor(config: RoomClientConfig) {
    this.config = config;
    this.api = new PodiumApi({ baseUrl: config.apiUrl, token: config.token });
    this.ws = new PodiumWS({
      wsAddress: config.wsAddress,
      token: config.token,
    });
  }

  onAudioChunk(cb: (buffer: Buffer) => void): void {
    this.callbacks.onAudioChunk = cb;
  }

  /** Subscribe to raw Podium WS messages (reactions, speaking-time events, etc.). */
  onWSMessage(cb: (msg: WSInMessage) => void): void {
    this.ws.onMessage(cb);
  }

  /** Fetch latest live data snapshot (members + remaining_time). Call only after successful WS join. */
  async getLatestLiveData(): Promise<OutpostLiveData> {
    return this.api.getLatestLiveData(this.config.outpostUuid);
  }

  /** Run full host join flow. Returns when joined (WS + optional Jitsi). */
  async join(): Promise<{ user: User; outpost: OutpostModel }> {
    this.user = await this.api.getProfile();
    this.outpost = await this.api.getOutpost(this.config.outpostUuid);
    // Join permission is enforced by the Podium API/WS; addMeAsMember and joinOutpost will fail if the user is not allowed.
    await this.ws.connect();
    await this.api.addMeAsMember(this.config.outpostUuid);
    await this.ws.joinOutpost(this.config.outpostUuid, this.user.address, {
      myUuid: this.user.uuid,
      timeoutMs: 15000,
    });

    if (this.outpost.creator_user_uuid === this.user.uuid) {
      await this.api.setCreatorJoinedToTrue(this.config.outpostUuid);
    }

    // Jitsi expects hostname only (no protocol). outpost_host_url may be "https://outposts.example.com".
    const rawDomain = this.outpost.outpost_host_url ?? this.config.outpostServer;
    const domain = rawDomain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim() || rawDomain;
    this.jitsi = createJitsiRoom({
      domain,
      xmppDomain: this.config.jitsiXmppDomain,
      mucDomain: this.config.jitsiMucDomain,
      roomName: this.config.outpostUuid,
      user: this.user,
      creatorUuid: this.outpost.creator_user_uuid,
      cohostUuids: this.outpost.cohost_user_uuids ?? [],
      useJitsiBot: this.config.useJitsiBot,
      botPageUrl: this.config.botPageUrl,
      jwt: this.config.jitsiJwt,
      bridgePort: this.config.jitsiBridgePort,
    });
    this.jitsi.onIncomingAudio((buffer, sampleRate) => {
      if (sampleRate !== VAD.getSampleRate()) {
        // Resample or document that we expect 16kHz; for MVP pass through and let VAD handle
        this.callbacks.onAudioChunk?.(buffer);
      } else {
        this.callbacks.onAudioChunk?.(buffer);
      }
    });

    if (typeof this.jitsi.start === "function") {
      await this.jitsi.start();
    }

    return { user: this.user, outpost: this.outpost };
  }

  /** Push TTS audio to the room (PCM 16-bit mono). */
  pushTtsAudio(buffer: Buffer): void {
    this.jitsi?.pushAudio(buffer);
  }

  /** Podium WS: indicate bot started speaking (UI state). */
  startSpeaking(): void {
    this.ws.startSpeaking(this.config.outpostUuid);
  }

  /** Podium WS: indicate bot stopped speaking (UI state). */
  stopSpeaking(): void {
    this.ws.stopSpeaking(this.config.outpostUuid);
  }

  /** True if Podium WS is connected. */
  wsConnected(): boolean {
    return this.ws.isConnected();
  }

  /** Health checks for watchdog: WS connected, conference alive, audio rx/tx. */
  getHealthChecks(): {
    wsConnected: () => boolean;
    conferenceAlive: () => boolean;
    audioRxTx: () => { rx: number; tx: number } | null;
  } {
    return {
      wsConnected: () => this.ws.isConnected(),
      conferenceAlive: () => (this.jitsi && typeof this.jitsi.isAlive === "function" ? this.jitsi.isAlive() : true),
      audioRxTx: () => (this.jitsi && typeof this.jitsi.getRxTx === "function" ? this.jitsi.getRxTx() : null),
    };
  }

  /** Leave outpost and close connections. */
  async leave(): Promise<void> {
    if (this.jitsi) await this.jitsi.leave();
    if (this.outpost) {
      this.ws.leave(this.config.outpostUuid);
      await this.api.leave(this.config.outpostUuid);
    }
    this.ws.close();
  }
}
