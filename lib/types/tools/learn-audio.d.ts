import { type LearnTool, type ToolDeps } from './base.js';
/**
 * Read a WAV header (no decoding) so short clips get an exact duration.
 *
 * Walks the RIFF chunks instead of assuming a 44-byte header: SAPI and other
 * writers emit an 18-byte `fmt ` chunk, which shifts the `data` size field.
 */
export declare function wavDurationSeconds(bytes: Uint8Array): number | null;
/** Fall back to a 128 kbps estimate when the container has no cheap header. */
export declare function estimateDurationSeconds(sizeBytes: number): number;
export declare function createAudioTool(deps: ToolDeps): LearnTool;
