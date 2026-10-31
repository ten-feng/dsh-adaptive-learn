/**
 * Plugin configuration.
 *
 * Defaults live in {@link DEFAULTS} and are shared by the Schema declaration and
 * {@link resolveConfig}, so tests and runtime agree on one source of truth.
 * Secret fields are declared with `.role('secret')` and are never logged.
 */
import Schema from '@deepseek-ai/schemastery';
export const DEFAULTS = {
    triggerMode: 'both',
    explicitPrefixes: ['/learn'],
    knowledgeDir: '_knowledge',
    maxFetchChars: 6000,
    autoScoreThreshold: 2,
    autoCooldownMinutes: 3,
    wikiCommitRequiresSource: true,
    routePolicy: 'auto',
    localEnabled: true,
    ocrMinVramMB: 2048,
    asrMinVramMB: 1024,
    audioLocalMaxMinutes: 10,
    localAsrModel: 'auto',
    localOcrEngine: 'auto',
    visionBaseUrl: 'https://developer.amd.com.cn/radeon/api/v1',
    visionModel: 'DeepSeek-V4-Flash-Vision-Exp',
    visionApiKey: '',
    audioBaseUrl: 'https://api.siliconflow.cn/v1',
    audioModel: 'FunAudioLLM/SenseVoiceSmall',
    audioApiKey: '',
};
export const Config = Schema.object({
    triggerMode: Schema.union(['auto', 'explicit', 'both']).default('both'),
    explicitPrefixes: Schema.array(Schema.string()).default(['/learn']),
    knowledgeDir: Schema.string().default('_knowledge'),
    maxFetchChars: Schema.number().default(6000),
    autoScoreThreshold: Schema.number().default(2),
    autoCooldownMinutes: Schema.number().default(3),
    wikiCommitRequiresSource: Schema.boolean().default(true),
    routePolicy: Schema.union(['auto', 'local-first', 'cloud-first']).default('auto'),
    localEnabled: Schema.boolean().default(true),
    ocrMinVramMB: Schema.number().default(2048),
    asrMinVramMB: Schema.number().default(1024),
    audioLocalMaxMinutes: Schema.number().default(10),
    localAsrModel: Schema.union(['auto', 'small', 'medium', 'large-v3-turbo']).default('auto'),
    localOcrEngine: Schema.union(['auto', 'hunyuanocr', 'paddleocr']).default('auto'),
    visionBaseUrl: Schema.string().default('https://developer.amd.com.cn/radeon/api/v1'),
    visionModel: Schema.string().default('DeepSeek-V4-Flash-Vision-Exp'),
    visionApiKey: Schema.string().role('secret').default(''),
    audioBaseUrl: Schema.string().default('https://api.siliconflow.cn/v1'),
    audioModel: Schema.string().default('FunAudioLLM/SenseVoiceSmall'),
    audioApiKey: Schema.string().role('secret').default(''),
});
/** Merge raw plugin config over {@link DEFAULTS} without mutating either side. */
export function resolveConfig(raw) {
    const out = { ...DEFAULTS };
    if (!raw)
        return out;
    for (const key of Object.keys(DEFAULTS)) {
        const value = raw[key];
        if (value !== undefined && value !== null) {
            // Assigning through a generic key is safe: `raw` is a Partial of the same shape.
            ;
            out[key] = value;
        }
    }
    return out;
}
