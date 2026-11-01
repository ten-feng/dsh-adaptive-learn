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
/**
 * Cap the transcript before it reaches the model.
 *
 * A one-hour recording can be tens of thousands of characters; unlike
 * `self_learn_fetch` there was no ceiling here, so long audio could crowd out
 * the rest of the conversation. Truncation is reported, never silent.
 */
export declare function capText(text: string, maxChars: number): {
    text: string;
    totalChars: number;
    truncated: boolean;
};
export declare function createAudioTool(deps: ToolDeps): LearnTool;
