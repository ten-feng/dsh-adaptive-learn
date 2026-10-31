/**
 * Route one task to the local engine, the cloud, or an explicit "unavailable".
 *
 * Precedence (see README): explicit policy first, then readiness, then keys.
 * Missing cloud keys never trigger a key request when local can do the work.
 */
import type { LocalCapability } from './capability.js';
import type { TaskKind, TaskTier } from './classify.js';
import type { RoutePolicy } from '../config.js';
export type LocalEngine = 'hunyuanocr' | 'paddleocr' | 'faster-whisper';
export type RouteDecision = {
    route: 'local';
    engine: LocalEngine;
    reason: string;
} | {
    route: 'cloud';
    reason: string;
} | {
    route: 'unavailable';
    reason: string;
    userActionRequired?: string;
};
export interface RouteInput {
    kind: TaskKind;
    tier: TaskTier;
    policy?: RoutePolicy;
    capability: LocalCapability | null;
    localEnabled?: boolean;
    /** Whether a vision/audio cloud key is configured. */
    hasCloudKey: boolean;
    /** Preferred local OCR engine; `auto` picks hunyuanocr then paddleocr. */
    localOcrEngine?: 'auto' | 'hunyuanocr' | 'paddleocr';
}
export declare function routeTask(input: RouteInput): RouteDecision;
/** Decide whether a failed local run may silently fall back to the cloud. */
export declare function shouldFallbackToCloud(input: RouteInput, reason?: string): boolean;
