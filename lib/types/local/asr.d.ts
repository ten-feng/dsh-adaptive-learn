export type AsrOutcome = {
    available: true;
    engine: string;
    text: string;
    language?: string;
} | {
    available: false;
    reason: 'engine_missing' | 'model_downloading' | 'failed' | 'too_long';
    message: string;
    progress?: number;
};
export interface AsrInput {
    audioPath: string;
    /** Whisper size, already resolved from VRAM. */
    model: 'small' | 'medium' | 'large-v3-turbo';
    /** `int8` compute type derived from the device. */
    computeType: 'int8_float32' | 'float16';
    /** Root of the model cache. */
    modelDir: string;
    language?: string;
    /** Test seam. */
    runBridge?: (input: AsrInput) => Promise<AsrOutcome>;
    pythonPath?: string;
}
/** Transcribe with faster-whisper, or explain why that is impossible here. */
export declare function runLocalAsr(input: AsrInput): Promise<AsrOutcome>;
