/**
 * Task tiering. Pure functions: no I/O, no model, no network.
 */
import type { LocalCapability } from './capability.js';
export type TaskKind = 'image' | 'audio' | 'video';
export type TaskTier = 'light' | 'heavy';
export interface ClassifyInput {
    kind: TaskKind;
    /** Payload size in bytes, when known. */
    sizeBytes?: number;
    /** Media duration in seconds, when known. */
    durationSeconds?: number;
    /** The user's question about the media, when there is one. */
    question?: string;
    /** Channel count reported by the container, when known. */
    channels?: number;
    /** Speaker diarisation or transcript alignment can't be done by the light path. */
    needsSpeakerSeparation?: boolean;
    /** Probed capability (accepted for symmetry; readiness is the router's job). */
    capability?: LocalCapability | null;
    audioLocalMaxMinutes?: number;
}
/** Decide whether a task may run on the light (local) path. */
export declare function classify(input: ClassifyInput): TaskTier;
/** Cheap structural score of a request; the trigger uses it in auto mode. */
export declare function structureSignals(text: string): number;
export type TriggerAction = 'none' | 'explicit' | 'auto';
export interface TriggerInput {
    text: string;
    mode: 'auto' | 'explicit' | 'both';
    explicitPrefixes: string[];
    threshold: number;
    cooldownMs: number;
    lastInjectedAt?: number;
    now?: number;
}
export interface TriggerDecision {
    action: TriggerAction;
    /** Text with an explicit prefix stripped. */
    text: string;
    score: number;
    /** Set when the explicit prefix fired. */
    prefix?: string;
}
/** Score one user request for a knowledge gap. Pure: no model, no network. */
export declare function scoreRequest(text: string): number;
/**
 * Decide whether the self-learning protocol should be injected for one message.
 *
 * Exactly two entry points: an explicit command prefix, or the text score.
 * Attachments never decide anything — a picture or a voice clip is content the
 * model can look at anyway, not a trigger.
 */
export declare function decideTrigger(input: TriggerInput): TriggerDecision;
