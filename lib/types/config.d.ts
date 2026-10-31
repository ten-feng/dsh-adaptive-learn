/**
 * Plugin configuration.
 *
 * Defaults live in {@link DEFAULTS} and are shared by the Schema declaration and
 * {@link resolveConfig}, so tests and runtime agree on one source of truth.
 * Secret fields are declared with `.role('secret')` and are never logged.
 */
import Schema from '@deepseek-ai/schemastery';
export type TriggerMode = 'auto' | 'explicit' | 'both';
export type RoutePolicy = 'auto' | 'local-first' | 'cloud-first';
export type LocalAsrModel = 'auto' | 'small' | 'medium' | 'large-v3-turbo';
export type LocalOcrEngine = 'auto' | 'hunyuanocr' | 'paddleocr';
export interface AdaptiveLearnConfig {
    /** When the self-learning protocol is injected. */
    triggerMode: TriggerMode;
    /** Message prefixes that force the explicit protocol. */
    explicitPrefixes: string[];
    /** Directory (relative to the workspace) holding the two-tier knowledge base. */
    knowledgeDir: string;
    /** Upper bound for text extracted from one page. */
    maxFetchChars: number;
    /** Auto-trigger score required to inject the protocol. */
    autoScoreThreshold: number;
    /** Per-session cooldown between two auto injections. */
    autoCooldownMinutes: number;
    /** Reject a commit whose staged entry has no sources. */
    wikiCommitRequiresSource: boolean;
    /** Routing preference. */
    routePolicy: RoutePolicy;
    /** Master switch for every local engine. */
    localEnabled: boolean;
    /** Free VRAM required before local OCR is considered ready. */
    ocrMinVramMB: number;
    /** Free VRAM required before local ASR is considered ready. */
    asrMinVramMB: number;
    /** Audio longer than this stays on the cloud path. */
    audioLocalMaxMinutes: number;
    /** Local Whisper size, or `auto` to derive it from VRAM. */
    localAsrModel: LocalAsrModel;
    /** Local OCR engine, or `auto`. */
    localOcrEngine: LocalOcrEngine;
    /** OpenAI-compatible vision endpoint. */
    visionBaseUrl: string;
    visionModel: string;
    visionApiKey: string;
    /** OpenAI-compatible audio transcription endpoint. */
    audioBaseUrl: string;
    audioModel: string;
    audioApiKey: string;
}
export declare const DEFAULTS: AdaptiveLearnConfig;
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    triggerMode: Schema<"auto" | "explicit" | "both", "auto" | "explicit" | "both", "defined">;
    explicitPrefixes: Schema<string[], string[], "defined">;
    knowledgeDir: Schema<string, string, "defined">;
    maxFetchChars: Schema<number, number, "defined">;
    autoScoreThreshold: Schema<number, number, "defined">;
    autoCooldownMinutes: Schema<number, number, "defined">;
    wikiCommitRequiresSource: Schema<boolean, boolean, "defined">;
    routePolicy: Schema<"auto" | "local-first" | "cloud-first", "auto" | "local-first" | "cloud-first", "defined">;
    localEnabled: Schema<boolean, boolean, "defined">;
    ocrMinVramMB: Schema<number, number, "defined">;
    asrMinVramMB: Schema<number, number, "defined">;
    audioLocalMaxMinutes: Schema<number, number, "defined">;
    localAsrModel: Schema<"auto" | "small" | "medium" | "large-v3-turbo", "auto" | "small" | "medium" | "large-v3-turbo", "defined">;
    localOcrEngine: Schema<"auto" | "hunyuanocr" | "paddleocr", "auto" | "hunyuanocr" | "paddleocr", "defined">;
    visionBaseUrl: Schema<string, string, "defined">;
    visionModel: Schema<string, string, "defined">;
    visionApiKey: Schema<string, string, "defined">;
    audioBaseUrl: Schema<string, string, "defined">;
    audioModel: Schema<string, string, "defined">;
    audioApiKey: Schema<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    triggerMode: Schema<"auto" | "explicit" | "both", "auto" | "explicit" | "both", "defined">;
    explicitPrefixes: Schema<string[], string[], "defined">;
    knowledgeDir: Schema<string, string, "defined">;
    maxFetchChars: Schema<number, number, "defined">;
    autoScoreThreshold: Schema<number, number, "defined">;
    autoCooldownMinutes: Schema<number, number, "defined">;
    wikiCommitRequiresSource: Schema<boolean, boolean, "defined">;
    routePolicy: Schema<"auto" | "local-first" | "cloud-first", "auto" | "local-first" | "cloud-first", "defined">;
    localEnabled: Schema<boolean, boolean, "defined">;
    ocrMinVramMB: Schema<number, number, "defined">;
    asrMinVramMB: Schema<number, number, "defined">;
    audioLocalMaxMinutes: Schema<number, number, "defined">;
    localAsrModel: Schema<"auto" | "small" | "medium" | "large-v3-turbo", "auto" | "small" | "medium" | "large-v3-turbo", "defined">;
    localOcrEngine: Schema<"auto" | "hunyuanocr" | "paddleocr", "auto" | "hunyuanocr" | "paddleocr", "defined">;
    visionBaseUrl: Schema<string, string, "defined">;
    visionModel: Schema<string, string, "defined">;
    visionApiKey: Schema<string, string, "defined">;
    audioBaseUrl: Schema<string, string, "defined">;
    audioModel: Schema<string, string, "defined">;
    audioApiKey: Schema<string, string, "defined">;
}>>, "plain">;
/** Merge raw plugin config over {@link DEFAULTS} without mutating either side. */
export declare function resolveConfig(raw?: Partial<AdaptiveLearnConfig> | null): AdaptiveLearnConfig;
