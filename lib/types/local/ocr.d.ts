export interface OcrBlock {
    text: string;
    box?: [number, number, number, number];
    confidence?: number;
}
export type OcrOutcome = {
    available: true;
    engine: 'local-hunyuanocr' | 'local-paddleocr';
    text: string;
    blocks: OcrBlock[];
} | {
    available: false;
    reason: 'engine_missing' | 'model_missing' | 'model_downloading' | 'failed' | 'unsupported_source';
    message: string;
    progress?: number;
};
export type OcrEngineChoice = 'auto' | 'hunyuanocr' | 'paddleocr';
export interface OcrInput {
    /** Local image path or a data URL. */
    source: string;
    sourceType?: 'url' | 'path' | 'base64';
    /** Directory where GGUF/ONNX weights are cached. */
    modelDir: string;
    engine?: OcrEngineChoice;
    /** Allow the first-run weight download to proceed. */
    allowDownload?: boolean;
    /** Test seam: override the llama.cpp worker. */
    runLlama?: (input: {
        source: string;
        sourceType?: OcrInput['sourceType'];
        modelPath: string;
        mmprojPath?: string | null;
        modelDir?: string;
    }) => Promise<{
        text: string;
        blocks?: OcrBlock[];
    }>;
    /** Test seam: override the paddle worker. */
    runPaddle?: (input: {
        source: string;
        sourceType?: OcrInput['sourceType'];
        modelDir?: string;
    }) => Promise<{
        text: string;
        blocks?: OcrBlock[];
    }>;
}
export interface HunyuanFiles {
    /** Main GGUF weights. */
    model: string;
    /** Vision projector (mmproj) next to the weights. */
    mmproj: string | null;
}
/** Find HunyuanOCR weights (and their mmproj) under `modelDir`. */
export declare function findHunyuanFiles(modelDir: string): Promise<HunyuanFiles | null>;
/** Backwards-compatible helper: just the weights path. */
export declare function findHunyuanModel(modelDir: string): Promise<string | null>;
/** Locate `llama-mtmd-cli`, the llama.cpp multimodal runner used for HunyuanOCR. */
export declare function findLlamaMtmd(modelDir: string): Promise<string | null>;
/** Locate the three PP-OCR model files under `<modelDir>/paddleocr/`. */
export declare function findPaddleModels(modelDir: string): Promise<{
    detection: string;
    recognition: string;
    charactersDictionary: string;
} | null>;
/** Strip llama.cpp logging and the echoed prompt from CLI output. */
export declare function cleanMtmdOutput(raw: string, prompt: string): string;
/** Run local OCR, returning a structured outcome instead of throwing. */
export declare function runLocalOcr(input: OcrInput): Promise<OcrOutcome>;
