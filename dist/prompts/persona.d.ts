import type { FeedbackThresholds } from "../feedback/types";
import type { FeedbackContextBuilder } from "./prompt-manager";
export interface Persona {
    id: string;
    systemPrompt: string;
    storytellerAddendum?: string;
    feedbackThresholds?: FeedbackThresholds;
    feedbackContextBuilder?: FeedbackContextBuilder;
}
export declare const PERSONAS: Record<string, Persona>;
export declare function getPersona(personaId?: string): Persona;
//# sourceMappingURL=persona.d.ts.map