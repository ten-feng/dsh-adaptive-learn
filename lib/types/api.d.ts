import type { CapabilityCache } from './local/capability.js';
import { type SettingsStore } from './settings.js';
export declare const API_PREFIX = "/plugins/dsh-adaptive-learn/api";
export interface ApiDeps {
    store: SettingsStore;
    cache: CapabilityCache;
    modelDir: string;
    dataDir: string;
}
export declare function createApiHandler(deps: ApiDeps): (req: {
    method?: string;
    url?: string;
}, res: unknown) => Promise<void>;
