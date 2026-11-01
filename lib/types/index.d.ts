import { Config, type AdaptiveLearnConfig } from './config.js';
import { CapabilityCache, type LocalCapability } from './local/capability.js';
import { type TriggerAction, type TriggerDecision } from './local/classify.js';
import { type LearnTool, type SessionLike, type ToolDeps } from './tools/base.js';
import { WikiStore } from './tools/learn-wiki.js';
import { SettingsStore } from './settings.js';
import { type ApiDeps } from './api.js';
export declare const name = "adaptive-learn";
/** Tools are the only hard dependency; everything else is read opportunistically. */
export declare const inject: string[];
export { Config };
export type { AdaptiveLearnConfig };
export interface PluginContext {
    tools: {
        register(definition: unknown): unknown;
    };
    on?: (event: string, listener: (...args: unknown[]) => unknown) => unknown;
    effect?: (install: () => unknown, label?: string) => unknown;
    /** Cordis service injection, used only for the optional `skills` service. */
    inject?: (dependencies: string[], callback: (scope: Record<string, unknown>) => void) => unknown;
    logger?: {
        info?: (message: string) => void;
        warn?: (message: string) => void;
    };
    dataDir?: string;
    workspace?: {
        root?: string;
    };
    cwd?: string;
    [key: string]: unknown;
}
export interface LearnServices {
    config: AdaptiveLearnConfig;
    capability: CapabilityCache;
    wiki: WikiStore;
    modelDir: string;
}
/** Resolve the workspace root without depending on any other plugin. */
export declare function resolveWorkspaceRoot(ctx: PluginContext): string;
/** Resolve the plugin data directory (capability cache, local weights). */
export declare function resolveDataDir(ctx: PluginContext): string;
/** Build the six tools for one runtime. */
export declare function createLearnTools(deps: ToolDeps): LearnTool[];
/**
 * Resolve the knowledge base root for one session.
 *
 * The session's own cwd wins: one process can serve several workspaces, and the
 * profile directory must never become a knowledge base. Then the workspace
 * registry (session → workspace path), then the environment, then cwd.
 */
export declare function resolveKnowledgeRoot(ctx: PluginContext, config: AdaptiveLearnConfig, session?: SessionLike): string;
/** Text of one user message, for prefix stripping and scoring. */
export declare function messageText(message: unknown): string;
/** Append the protocol text to one message without mutating the frozen original. */
export declare function withInjectedText(message: unknown, text: string, options?: {
    replaceText?: string;
}): unknown;
export interface PreStepPayload {
    messages?: unknown[];
    agent?: {
        id?: string;
    };
    turn?: number;
    step?: number;
}
/** Pure(ish) trigger evaluation for one pre-step batch; returns the actions taken. */
export declare function evaluatePreStep(messages: unknown[], config: AdaptiveLearnConfig, state: {
    lastInjectedAt?: number;
    now?: number;
}): {
    injected: TriggerAction;
    rewritten: unknown[];
    decision: TriggerDecision | null;
};
/** What `apply()` hands back to the host (diagnostics and future settings hooks). */
export interface LearnRuntime {
    config: AdaptiveLearnConfig;
    /** Knowledge store for a session's workspace. */
    getWiki(session?: SessionLike): WikiStore;
    /** Force a fresh probe now (diagnostics; tools already probe on every call). */
    probeCapability(): Promise<LocalCapability>;
    /** Cached capability without forcing a probe. */
    getCapability(): Promise<LocalCapability>;
}
/** Absolute path of the shipped skill document (resolved from lib/index.js). */
export declare function skillFilePath(): string;
export interface SkillDocument {
    name: string;
    description: string;
    body: string;
    path: string;
}
/** Split `---` front-matter from the markdown body. */
export declare function parseSkillDocument(raw: string, path: string): SkillDocument;
/** Build the provider object the host's skill catalogue consumes. */
export declare function createSkillProvider(document: SkillDocument): {
    name: string;
    list: () => Promise<{
        content?: string | undefined;
        name: string;
        description: string;
        invocation: {
            modelInvocable: boolean;
            userInvocable: boolean;
        };
        source: string;
        provider: string;
        path: string;
        resourceBase: {
            kind: string;
            path: string;
        };
        rank: number;
        locator: string;
    }[]>;
    get: () => Promise<{
        content?: string | undefined;
        name: string;
        description: string;
        invocation: {
            modelInvocable: boolean;
            userInvocable: boolean;
        };
        source: string;
        provider: string;
        path: string;
        resourceBase: {
            kind: string;
            path: string;
        };
        rank: number;
        locator: string;
    }>;
};
/**
 * Register SKILL.md with the host skill catalogue, when that service exists.
 *
 * `registerProvider` takes a provider FACTORY (as dsh-music does), not a ready
 * object — passing the object silently registers nothing.
 */
export declare function installSkill(ctx: PluginContext, file?: string): void;
/** Cordis plugin entry point. */
export declare function apply(ctx: PluginContext, rawConfig?: Partial<AdaptiveLearnConfig>, overrides?: Partial<ToolDeps>): LearnRuntime;
/**
 * Mount the settings panel's JSON API on the host webServer.
 *
 * Optional: a headless profile without a web UI simply never calls this, and
 * the plugin keeps working with its schema/patch config.
 */
export declare function installSettingsApi(ctx: PluginContext, deps: Omit<ApiDeps, 'store'> & {
    store: SettingsStore;
}): void;
/** Re-apply one trigger decision to the batch the downstream waterfall returned. */
export declare function applyDecision(messages: unknown[], decision: TriggerDecision): unknown[];
/** Register the `agent/pre-step` trigger. Zero interference when nothing fires. */
export declare function installTrigger(ctx: PluginContext, config: AdaptiveLearnConfig): void;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
    Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        triggerMode: import("@deepseek-ai/schemastery").default<"auto" | "explicit" | "both", "auto" | "explicit" | "both", "defined">;
        explicitPrefixes: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
        knowledgeDir: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        maxFetchChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        autoScoreThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        autoCooldownMinutes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        wikiCommitRequiresSource: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        allowPrivateUrls: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        routePolicy: import("@deepseek-ai/schemastery").default<"auto" | "local-first" | "cloud-first", "auto" | "local-first" | "cloud-first", "defined">;
        localEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        ocrMinVramMB: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        asrMinVramMB: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        audioLocalMaxMinutes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        localAsrModel: import("@deepseek-ai/schemastery").default<"small" | "medium" | "large-v3-turbo" | "auto", "small" | "medium" | "large-v3-turbo" | "auto", "defined">;
        localOcrEngine: import("@deepseek-ai/schemastery").default<"auto" | "hunyuanocr" | "paddleocr", "auto" | "hunyuanocr" | "paddleocr", "defined">;
        visionBaseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        visionModel: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        visionApiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        audioBaseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        audioModel: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        audioApiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        triggerMode: import("@deepseek-ai/schemastery").default<"auto" | "explicit" | "both", "auto" | "explicit" | "both", "defined">;
        explicitPrefixes: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
        knowledgeDir: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        maxFetchChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        autoScoreThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        autoCooldownMinutes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        wikiCommitRequiresSource: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        allowPrivateUrls: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        routePolicy: import("@deepseek-ai/schemastery").default<"auto" | "local-first" | "cloud-first", "auto" | "local-first" | "cloud-first", "defined">;
        localEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        ocrMinVramMB: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        asrMinVramMB: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        audioLocalMaxMinutes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        localAsrModel: import("@deepseek-ai/schemastery").default<"small" | "medium" | "large-v3-turbo" | "auto", "small" | "medium" | "large-v3-turbo" | "auto", "defined">;
        localOcrEngine: import("@deepseek-ai/schemastery").default<"auto" | "hunyuanocr" | "paddleocr", "auto" | "hunyuanocr" | "paddleocr", "defined">;
        visionBaseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        visionModel: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        visionApiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        audioBaseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        audioModel: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        audioApiKey: import("@deepseek-ai/schemastery").default<string, string, "defined">;
    }>>, "plain">;
};
export default _default;
