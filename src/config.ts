/**
 * Plugin configuration.
 *
 * Defaults live in {@link DEFAULTS} and are shared by the Schema declaration and
 * {@link resolveConfig}, so tests and runtime agree on one source of truth.
 * Secret fields are declared with `.role('secret')` and are never logged.
 */
import Schema from '@deepseek-ai/schemastery'

export type TriggerMode = 'auto' | 'explicit' | 'both'
export type RoutePolicy = 'auto' | 'local-first' | 'cloud-first'
export type LocalAsrModel = 'auto' | 'small' | 'medium' | 'large-v3-turbo'
export type LocalOcrEngine = 'auto' | 'hunyuanocr' | 'paddleocr'

export interface AdaptiveLearnConfig {
  /** When the self-learning protocol is injected. */
  triggerMode: TriggerMode
  /** Message prefixes that force the explicit protocol. */
  explicitPrefixes: string[]
  /** Directory (relative to the workspace) holding the two-tier knowledge base. */
  knowledgeDir: string
  /** Upper bound for text extracted from one page. */
  maxFetchChars: number
  /** Auto-trigger score required to inject the protocol. */
  autoScoreThreshold: number
  /** Per-session cooldown between two auto injections. */
  autoCooldownMinutes: number
  /** Reject a commit whose staged entry has no sources. */
  wikiCommitRequiresSource: boolean
  /** Allow fetching loopback/intranet addresses (SSRF guard off). */
  allowPrivateUrls: boolean
  /** Routing preference. */
  routePolicy: RoutePolicy
  /** Master switch for every local engine. */
  localEnabled: boolean
  /** Free VRAM required before local OCR is considered ready. */
  ocrMinVramMB: number
  /** Free VRAM required before local ASR is considered ready. */
  asrMinVramMB: number
  /** Audio longer than this stays on the cloud path. */
  audioLocalMaxMinutes: number
  /** Local Whisper size, or `auto` to derive it from VRAM. */
  localAsrModel: LocalAsrModel
  /** Local OCR engine, or `auto`. */
  localOcrEngine: LocalOcrEngine
  /** OpenAI-compatible vision endpoint. */
  visionBaseUrl: string
  visionModel: string
  visionApiKey: string
  /** OpenAI-compatible audio transcription endpoint. */
  audioBaseUrl: string
  audioModel: string
  audioApiKey: string
}

export const DEFAULTS: AdaptiveLearnConfig = {
  triggerMode: 'both',
  explicitPrefixes: ['/learn'],
  knowledgeDir: '_knowledge',
  maxFetchChars: 6000,
  autoScoreThreshold: 2,
  autoCooldownMinutes: 3,
  wikiCommitRequiresSource: true,
  allowPrivateUrls: false,
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
}

export const Config = Schema.object({
  triggerMode: Schema.union(['auto', 'explicit', 'both'] as const).default('both'),
  explicitPrefixes: Schema.array(Schema.string()).default(['/learn']),
  knowledgeDir: Schema.string().default('_knowledge'),
  maxFetchChars: Schema.number().default(6000),
  autoScoreThreshold: Schema.number().default(2),
  autoCooldownMinutes: Schema.number().default(3),
  wikiCommitRequiresSource: Schema.boolean().default(true),
  allowPrivateUrls: Schema.boolean().default(false),
  routePolicy: Schema.union(['auto', 'local-first', 'cloud-first'] as const).default('auto'),
  localEnabled: Schema.boolean().default(true),
  ocrMinVramMB: Schema.number().default(2048),
  asrMinVramMB: Schema.number().default(1024),
  audioLocalMaxMinutes: Schema.number().default(10),
  localAsrModel: Schema.union(['auto', 'small', 'medium', 'large-v3-turbo'] as const).default('auto'),
  localOcrEngine: Schema.union(['auto', 'hunyuanocr', 'paddleocr'] as const).default('auto'),
  visionBaseUrl: Schema.string().default('https://developer.amd.com.cn/radeon/api/v1'),
  visionModel: Schema.string().default('DeepSeek-V4-Flash-Vision-Exp'),
  visionApiKey: Schema.string().role('secret').default(''),
  audioBaseUrl: Schema.string().default('https://api.siliconflow.cn/v1'),
  audioModel: Schema.string().default('FunAudioLLM/SenseVoiceSmall'),
  audioApiKey: Schema.string().role('secret').default(''),
})

/** Merge raw plugin config over {@link DEFAULTS} without mutating either side. */
export function resolveConfig(raw?: Partial<AdaptiveLearnConfig> | null): AdaptiveLearnConfig {
  const out: AdaptiveLearnConfig = { ...DEFAULTS }
  if (!raw) return out
  for (const key of Object.keys(DEFAULTS) as (keyof AdaptiveLearnConfig)[]) {
    const value = raw[key]
    if (value !== undefined && value !== null) {
      // Assigning through a generic key is safe: `raw` is a Partial of the same shape.
      ;(out as unknown as Record<string, unknown>)[key] = value
    }
  }
  return out
}
