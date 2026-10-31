import { jsonRender, type SessionLike, type ToolRunContextLike } from './base.js';
export type WikiSourceType = 'web' | 'image' | 'video' | 'audio';
export interface WikiSource {
    type: WikiSourceType;
    /** URL, path, or another stable identifier. */
    ref: string;
    /** Engine that produced the observation (e.g. `local-hunyuanocr`). */
    engine: string;
    title?: string;
    fetchedAt?: string;
}
export interface WikiEntry {
    title: string;
    slug: string;
    content: string;
    sources: WikiSource[];
    createdAt: string;
    updatedAt?: string;
    committedAt?: string;
}
export interface WikiHit {
    title: string;
    slug: string;
    score: number;
    excerpt: string;
    sources: WikiSource[];
    updatedAt?: string;
}
export interface StageInput {
    title?: string;
    content: string;
    sources: WikiSource[];
}
export declare class WikiSourceRequiredError extends Error {
    readonly code = "WIKI_SOURCE_REQUIRED";
    constructor(title: string);
}
export declare function parseEntry(text: string): WikiEntry | null;
export declare class WikiStore {
    readonly rootDir: string;
    private readonly options;
    readonly pagesDir: string;
    readonly stagedDir: string;
    constructor(rootDir: string, options?: {
        requireSource?: boolean;
    });
    /** Nothing is created until the first write. */
    private ensure;
    private entries;
    /** Recall hits only from the committed tier. */
    recall(query: string, limit?: number): Promise<WikiHit[]>;
    /** Write a draft into the staged tier; pending entries never participate in recall. */
    stage(input: StageInput): Promise<WikiEntry>;
    /** Find one staged entry by slug first, then by exact title. */
    findStaged(identifier: string): Promise<WikiEntry | null>;
    /**
     * Promote a staged entry into the recallable tier.
     * @throws WikiSourceRequiredError when the entry has no sources and the policy demands one.
     */
    commit(identifier: string): Promise<WikiEntry>;
    /** Staged entries, for a "what is pending?" listing. */
    listStaged(): Promise<WikiEntry[]>;
    /** Committed entries, for a "what do we know?" listing. */
    listPages(): Promise<WikiEntry[]>;
}
/** The three knowledge-base tools. */
export declare function createWikiTools(deps: {
    getWiki: (session?: SessionLike) => WikiStore;
    requireSource?: boolean;
}): ({
    name: string;
    description: string;
    parameters: {
        query: {
            type: "string";
            required: true;
            description: string;
        };
        content?: undefined;
        sources?: undefined;
        title?: undefined;
    };
    output: {
        schema: import("./base.js").JsonSchemaNode;
        render: typeof jsonRender;
    };
    execute(args: Record<string, unknown>, exec?: ToolRunContextLike): Promise<{
        available: boolean;
        count: number;
        hits: WikiHit[];
    }>;
} | {
    name: string;
    description: string;
    parameters: {
        content: {
            type: "string";
            required: true;
            description: string;
        };
        sources: {
            type: "array";
            required: true;
            description: string;
            items: {
                type: "object";
                additionalProperties: boolean;
            };
        };
        title: {
            type: "string";
            description: string;
            required?: undefined;
        };
        query?: undefined;
    };
    output: {
        schema: import("./base.js").JsonSchemaNode;
        render: typeof jsonRender;
    };
    execute(args: Record<string, unknown>, exec?: ToolRunContextLike): Promise<{
        available: boolean;
        status: string;
        title: string;
        slug: string;
        path: string;
        sourceCount: number;
    }>;
} | {
    name: string;
    description: string;
    parameters: {
        title: {
            type: "string";
            required: true;
            description: string;
        };
        query?: undefined;
        content?: undefined;
        sources?: undefined;
    };
    output: {
        schema: import("./base.js").JsonSchemaNode;
        render: typeof jsonRender;
    };
    execute(args: Record<string, unknown>, exec?: ToolRunContextLike): Promise<{
        available: boolean;
        status: string;
        title: string;
        slug: string;
        path: string;
        sourceCount: number;
        reason?: undefined;
        message?: undefined;
    } | {
        available: boolean;
        status: string;
        reason: string;
        message: string;
        title?: undefined;
        slug?: undefined;
        path?: undefined;
        sourceCount?: undefined;
    }>;
})[];
