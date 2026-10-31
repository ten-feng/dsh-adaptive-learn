/**
 * Tool plumbing shared by the six learning tools.
 *
 * A tool is described once, host-independent, then registered with the DSH tool
 * registry. `execute` returns only the canonical JSON its `output.schema`
 * declares; degraded business outcomes are values, not exceptions.
 */
export interface ToolParamSpec {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    required?: boolean;
    description?: string;
    items?: ToolParamSpec;
    enum?: readonly string[];
    default?: unknown;
}
export type ToolParameters = Record<string, ToolParamSpec>;
/** Author-facing value-schema node (the host compiles it to raw JSON Schema). */
export interface JsonSchemaNode {
    type?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
    properties?: Record<string, JsonSchemaNode>;
    items?: JsonSchemaNode;
    additionalProperties?: boolean;
    /** Author-facing requiredness annotation (never a JSON-Schema array here). */
    required?: boolean;
    description?: string;
    enum?: readonly string[];
}
export interface ToolTextBlock {
    type: 'text';
    text: string;
}
export interface ToolOutput {
    schema: JsonSchemaNode;
    render?: (value: unknown) => ToolTextBlock[];
}
export interface SessionLike {
    id?: string;
    /** The session's workspace directory, when the host exposes it directly. */
    cwd?: string;
    /** The durable header; DSH stores the creation cwd there. */
    header?: {
        cwd?: string;
    };
    meta?: {
        cwd?: string;
    };
}
export interface ToolRunContextLike {
    signal?: AbortSignal;
    /** The agent on whose behalf the call runs (set by the host loop). */
    agent?: {
        session?: SessionLike;
    };
}
export interface LearnTool {
    name: string;
    description: string;
    parameters: ToolParameters;
    output: ToolOutput;
    execute(args: Record<string, unknown>, exec?: ToolRunContextLike): Promise<unknown>;
}
/** Invalid model arguments: an infrastructure-level contract failure. */
export declare class ToolArgsError extends Error {
    readonly violations: string[];
    constructor(violations: string[]);
}
/**
 * Validate model arguments against a parameter map.
 * @throws ToolArgsError with one violation per offending field.
 */
export declare function assertArgs(parameters: ToolParameters, args: unknown): Record<string, unknown>;
/** A model-facing text projection for any canonical value. */
export declare function jsonRender(value: unknown): ToolTextBlock[];
/**
 * Shorthand for an object output schema.
 *
 * The host compiles `output.schema` as an author-facing ValueSchemaSpec, so
 * requiredness is a per-property `required: true` annotation and openness is
 * mandatory — never a JSON-Schema `required: []` array.
 */
export declare function objectSchema(properties: Record<string, JsonSchemaNode>, required?: string[]): JsonSchemaNode;
/** Everything the six tools share. Optional seams keep the tools testable. */
export interface ToolDeps {
    config: AdaptiveLearnConfig;
    /** Fresh-or-cached capability snapshot. */
    capability(): Promise<LocalCapability>;
    /**
     * Knowledge store for the calling session's workspace.
     *
     * The root is resolved per call: one process can serve several workspaces,
     * and the profile directory must never become a knowledge base.
     */
    getWiki(session?: SessionLike): WikiStore;
    /** Where local model weights live (plugin data dir). */
    modelDir: string;
    /** Injected fetch, so tests never touch the network. */
    fetchImpl?: typeof fetch;
    ocr?: typeof runLocalOcr;
    asr?: typeof runLocalAsr;
    now?: () => number;
}
import type { AdaptiveLearnConfig } from '../config.js';
import type { LocalCapability } from '../local/capability.js';
import type { runLocalAsr } from '../local/asr.js';
import type { runLocalOcr } from '../local/ocr.js';
import type { WikiStore } from './learn-wiki.js';
