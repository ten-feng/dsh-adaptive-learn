/**
 * Runtime settings overlay.
 *
 * The panel edits live values; they are persisted next to the engine cache and
 * re-applied on the next boot (over the schema/patch config, which stays the
 * source of defaults). Saving mutates the in-memory config object the tools
 * already close over, so a key change takes effect without a restart.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AdaptiveLearnConfig } from './config.js'

/** Editable subset; everything else stays in the schema/patch config. */
export interface SettingsPatch {
  visionBaseUrl?: string
  visionModel?: string
  visionApiKey?: string
  audioBaseUrl?: string
  audioModel?: string
  audioApiKey?: string
  routePolicy?: 'auto' | 'local-first' | 'cloud-first'
  allowPrivateUrls?: boolean
}

const EDITABLE: (keyof SettingsPatch)[] = [
  'visionBaseUrl',
  'visionModel',
  'visionApiKey',
  'audioBaseUrl',
  'audioModel',
  'audioApiKey',
  'routePolicy',
  'allowPrivateUrls',
]

/** Keep only known keys with the right primitive types. */
export function sanitizePatch(raw: unknown): SettingsPatch {
  const source = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: SettingsPatch = {}
  for (const key of EDITABLE) {
    const value = source[key]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') continue
    ;(out as Record<string, string>)[key] = value.trim()
  }
  if (out.routePolicy && !['auto', 'local-first', 'cloud-first'].includes(out.routePolicy)) delete out.routePolicy
  if (source.allowPrivateUrls !== undefined) out.allowPrivateUrls = source.allowPrivateUrls === true
  return out
}

/** Never return a secret in clear text to the browser. */
export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}

export class SettingsStore {
  constructor(
    private readonly file: string,
    private readonly config: AdaptiveLearnConfig,
  ) {
    this.overlay()
  }

  /** Overlay the persisted patch onto the live config object. */
  overlay(): void {
    for (const [key, value] of Object.entries(this.read())) {
      ;(this.config as unknown as Record<string, unknown>)[key] = value
    }
  }

  read(): SettingsPatch {
    try {
      return sanitizePatch(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      return {}
    }
  }

  /** Persist a patch and apply it immediately. */
  save(raw: unknown): SettingsPatch {
    const patch = sanitizePatch(raw)
    if (Object.keys(patch).length === 0) return {}
    const merged = { ...this.read(), ...patch }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(merged, null, 2), 'utf8')
    for (const [key, value] of Object.entries(patch)) {
      ;(this.config as unknown as Record<string, unknown>)[key] = value
    }
    return patch
  }

  /** The browser-safe view: no clear-text secrets. */
  view(): Record<string, unknown> {
    return {
      visionBaseUrl: this.config.visionBaseUrl,
      visionModel: this.config.visionModel,
      visionApiKey: maskSecret(this.config.visionApiKey),
      visionApiKeySet: this.config.visionApiKey.length > 0,
      audioBaseUrl: this.config.audioBaseUrl,
      audioModel: this.config.audioModel,
      audioApiKey: maskSecret(this.config.audioApiKey),
      audioApiKeySet: this.config.audioApiKey.length > 0,
      routePolicy: this.config.routePolicy,
      allowPrivateUrls: this.config.allowPrivateUrls,
      triggerMode: this.config.triggerMode,
      autoCooldownMinutes: this.config.autoCooldownMinutes,
      source: this.file,
    }
  }
}

/** Which local engines are installed (checked lazily by the API). */
export function engineStatus(modelDir: string, dataDir: string, exists: (path: string) => boolean) {
  return {
    paddle: exists(`${modelDir}/paddleocr/PP-OCRv5_mobile_det_infer.onnx`),
    hunyuan: exists(`${modelDir}/hunyuanocr/HunyuanOCR-Q8_0.gguf`),
    llamaCli: exists(`${dataDir}/llamacpp/llama-mtmd-cli.exe`) || exists(`${dataDir}/llamacpp/llama-mtmd-cli`),
    whisper: exists(`${dataDir}/pyenv/Scripts/python.exe`) || exists(`${dataDir}/pyenv/bin/python`),
  }
}
