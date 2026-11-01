import type { AdaptiveLearnConfig } from './config.js';
/** Editable subset; everything else stays in the schema/patch config. */
export interface SettingsPatch {
    visionBaseUrl?: string;
    visionModel?: string;
    visionApiKey?: string;
    audioBaseUrl?: string;
    audioModel?: string;
    audioApiKey?: string;
    routePolicy?: 'auto' | 'local-first' | 'cloud-first';
    allowPrivateUrls?: boolean;
    /** Cap for text extracted from a page. */
    maxFetchChars?: number;
    /** Cap for a transcript handed back to the model. */
    maxAudioChars?: number;
}
/** Keep only known keys with the right primitive types. */
export declare function sanitizePatch(raw: unknown): SettingsPatch;
/** Never return a secret in clear text to the browser. */
export declare function maskSecret(value: string): string;
export declare class SettingsStore {
    private readonly file;
    private readonly config;
    constructor(file: string, config: AdaptiveLearnConfig);
    /** Overlay the persisted patch onto the live config object. */
    overlay(): void;
    read(): SettingsPatch;
    /** Persist a patch and apply it immediately. */
    save(raw: unknown): SettingsPatch;
    /** The browser-safe view: no clear-text secrets. */
    view(): Record<string, unknown>;
}
/** Which local engines are installed (checked lazily by the API). */
export declare function engineStatus(modelDir: string, dataDir: string, exists: (path: string) => boolean): {
    paddle: boolean;
    hunyuan: boolean;
    llamaCli: boolean;
    whisper: boolean;
};
