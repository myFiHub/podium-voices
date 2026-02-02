/**
 * In-memory session buffer: rolling transcript with max turn count.
 * Optional running summary hook for long sessions (e.g. 4h); MVP uses turns only.
 */
import type { SessionMemorySnapshot, ISessionMemory } from "./types";
export interface SessionMemoryConfig {
    /** Max number of recent turns to keep. */
    maxTurns: number;
}
export declare class SessionMemory implements ISessionMemory {
    private turns;
    private runningSummary;
    private readonly maxTurns;
    constructor(config: SessionMemoryConfig);
    append(role: "user" | "assistant", content: string): void;
    getSnapshot(): SessionMemorySnapshot;
    clear(): void;
    /** Optional: set a running summary (e.g. from a background summarizer). */
    setRunningSummary(summary: string | undefined): void;
}
//# sourceMappingURL=session.d.ts.map