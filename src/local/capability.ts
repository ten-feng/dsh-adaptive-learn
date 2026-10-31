/**
 * Local capability probe.
 *
 * Never assumes a GPU model: the verdict comes from `nvidia-smi` at runtime,
 * then `systeminformation.graphics()`, and finally falls back to "no GPU".
 * A failed probe is a normal outcome, never an exception.
 */
import { execFile } from 'node:child_process'
import os from 'node:os'

export type GpuDetectionMethod = 'nvidia-smi' | 'systeminformation' | 'none'
export type AsrModelSuggestion = 'small' | 'medium' | 'large-v3-turbo'
export type AsrComputeType = 'int8_float32' | 'float16'

export interface GpuInfo {
  available: boolean
  vendor: string
  name: string
  vramTotalMB: number
  vramFreeMB: number
  /** CUDA compute capability of the first device, when nvidia-smi reports it. */
  cudaCapability: number | null
  detectionMethod: GpuDetectionMethod
}

export interface CpuInfo {
  cores: number
  arch: string
}

export interface LocalCapability {
  gpu: GpuInfo
  cpu: CpuInfo
  memoryFreeMB: number
  localOcrReady: boolean
  localAsrReady: boolean
  localAsrModelSuggestion: AsrModelSuggestion
  /** INT8 is forced on pre-Volta parts (compute capability < 7.0). */
  localAsrComputeType: AsrComputeType
  probedAt: number
  /** Set when the latest probe failed and this is the last known good snapshot. */
  stale?: boolean
}

export interface ProbeOptions {
  /** Test seam: run one command and return stdout. */
  exec?: (command: string, args: string[]) => Promise<string>
  /** Test seam: graphics fallback (defaults to `systeminformation`). */
  graphics?: () => Promise<GraphicsController[]>
  /** Test seam: clock. */
  now?: () => number
  ocrMinVramMB?: number
  asrMinVramMB?: number
  /** Force a Whisper size instead of deriving one from VRAM. */
  localAsrModel?: 'auto' | AsrModelSuggestion
  timeoutMs?: number
}

export interface GraphicsController {
  vendor?: string
  model?: string
  vram?: number | null
  vramDynamic?: boolean | null
}

const NVIDIA_ARGS = [
  '--query-gpu=name,memory.total,memory.free,compute_cap',
  '--format=csv,noheader,nounits',
]

function defaultExec(timeoutMs: number) {
  return (command: string, args: string[]): Promise<string> =>
    new Promise((resolve, reject) => {
      execFile(command, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
        if (error) reject(error)
        else resolve(String(stdout))
      })
    })
}

/** Parse one `name, total, free, compute_cap` line (units are stripped by nvidia-smi). */
export function parseNvidiaSmi(stdout: string): GpuInfo | null {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  if (!line) return null
  const parts = line.split(',').map((item) => item.trim())
  if (parts.length < 4) return null
  const [name, total, free, cap] = parts as [string, string, string, string]
  const vramTotalMB = Math.round(Number.parseFloat(total))
  const vramFreeMB = Math.round(Number.parseFloat(free))
  if (!Number.isFinite(vramTotalMB) || !Number.isFinite(vramFreeMB)) return null
  const cudaCapability = Number.parseFloat(cap)
  return {
    available: true,
    vendor: /nvidia/i.test(name) ? 'nvidia' : (name.split(/\s+/)[0] ?? 'unknown').toLowerCase(),
    name,
    vramTotalMB,
    vramFreeMB,
    cudaCapability: Number.isFinite(cudaCapability) ? cudaCapability : null,
    detectionMethod: 'nvidia-smi',
  }
}

const NO_GPU: GpuInfo = {
  available: false,
  vendor: 'none',
  name: '',
  vramTotalMB: 0,
  vramFreeMB: 0,
  cudaCapability: null,
  detectionMethod: 'none',
}

async function defaultGraphics(): Promise<GraphicsController[]> {
  const module = await import('systeminformation')
  const graphics = (module as { default?: { graphics?: () => Promise<{ controllers?: GraphicsController[] }> } }).default
    ?? (module as unknown as { graphics?: () => Promise<{ controllers?: GraphicsController[] }> })
  const info = await graphics.graphics?.()
  return info?.controllers ?? []
}

/** Suggest the largest Whisper size the free VRAM can plausibly hold. */
export function suggestAsrModel(vramFreeMB: number): AsrModelSuggestion {
  if (vramFreeMB >= 5120) return 'large-v3-turbo'
  if (vramFreeMB >= 3072) return 'medium'
  return 'small'
}

export function computeReadiness(
  gpu: GpuInfo,
  config: Pick<ProbeOptions, 'ocrMinVramMB' | 'asrMinVramMB' | 'localAsrModel'>,
): Pick<LocalCapability, 'localOcrReady' | 'localAsrReady' | 'localAsrModelSuggestion' | 'localAsrComputeType'> {
  const vramFreeMB = gpu.available ? gpu.vramFreeMB : 0
  const ocrMin = config.ocrMinVramMB ?? 2048
  const asrMin = config.asrMinVramMB ?? 1024
  const forced = config.localAsrModel && config.localAsrModel !== 'auto' ? config.localAsrModel : null
  const capability = gpu.cudaCapability
  return {
    localOcrReady: gpu.available && vramFreeMB >= ocrMin,
    localAsrReady: gpu.available && vramFreeMB >= asrMin,
    localAsrModelSuggestion: forced ?? suggestAsrModel(vramFreeMB),
    localAsrComputeType: capability !== null && capability < 7.0 ? 'int8_float32' : 'float16',
  }
}

/** Probe once. Never throws: an unreadable host is reported as "no GPU". */
export async function probeCapability(options: ProbeOptions = {}): Promise<LocalCapability> {
  const timeoutMs = options.timeoutMs ?? 2000
  const now = options.now ?? (() => Date.now())
  const run = options.exec ?? defaultExec(timeoutMs)

  let gpu: GpuInfo = { ...NO_GPU }
  try {
    gpu = parseNvidiaSmi(await run('nvidia-smi', NVIDIA_ARGS)) ?? { ...NO_GPU }
  } catch {
    gpu = { ...NO_GPU }
  }

  if (!gpu.available) {
    try {
      const graphics = options.graphics ?? defaultGraphics
      const controllers = await graphics()
      const dgpu = (controllers ?? []).filter((item) => Number(item.vram ?? 0) > 0)[0]
      if (dgpu) {
        const vram = Math.round(Number(dgpu.vram ?? 0))
        const model = String(dgpu.model ?? '')
        gpu = {
          available: vram > 0,
          vendor: String(dgpu.vendor ?? '').toLowerCase() || (/nvidia/i.test(model) ? 'nvidia' : 'unknown'),
          name: model,
          vramTotalMB: vram,
          // systeminformation exposes capacity only; treat it as free until nvidia-smi says otherwise.
          vramFreeMB: vram,
          cudaCapability: null,
          detectionMethod: 'systeminformation',
        }
      }
    } catch {
      gpu = { ...NO_GPU }
    }
  }

  const memoryFreeMB = Math.round((os.freemem?.() ?? 0) / (1024 * 1024))
  return {
    gpu,
    cpu: { cores: os.cpus()?.length ?? 1, arch: process.arch },
    memoryFreeMB,
    ...computeReadiness(gpu, options),
    probedAt: now(),
  }
}

export interface CapabilityCacheOptions extends ProbeOptions {
  /** Where the JSON snapshot lives (the plugin data dir). */
  file: string
  /** Reserved: kept for config compatibility. */
  ttlMs?: number
  /** Reserved: kept for config compatibility. */
  slowProbeMs?: number
  /** Reuse the last probe result within this window (default 10 s). */
  dedupeMs?: number
  /** When the host reports no GPU, skip probing again for this long (default 60 s). */
  noGpuCacheMs?: number
  /** A last-known-good snapshot is only reused within this age when a probe fails. */
  fallbackMaxAgeMs?: number
  read?: (file: string) => Promise<string | null>
  write?: (file: string, data: string) => Promise<void>
}

/**
 * Capability provider.
 *
 * Tools ask for the capability on every call. Repeated asks within
 * `dedupeMs` reuse the last answer (default 10 s), and a host that reports no
 * GPU at all is not probed again for `noGpuCacheMs` — on such a machine the
 * `systeminformation` fallback is the expensive part, and it will not start
 * returning a GPU one minute later anyway.
 *
 * A probe that *fails* keeps the last good snapshot (≤ 24 h) and marks it
 * `stale` instead of pretending the machine has no GPU. `probe(true)` bypasses
 * both windows for a forced diagnostic refresh.
 */
export class CapabilityCache {
  private snapshot: LocalCapability | null = null
  private loaded = false
  private inflight: Promise<LocalCapability> | null = null
  private lastProbeAt = 0

  constructor(private readonly options: CapabilityCacheOptions = { file: '' } as CapabilityCacheOptions) {}

  private get dedupeMs() {
    return this.options.dedupeMs ?? 10_000
  }

  private get noGpuCacheMs() {
    return this.options.noGpuCacheMs ?? 60_000
  }

  private get fallbackMaxAgeMs() {
    return this.options.fallbackMaxAgeMs ?? 24 * 60 * 60 * 1000
  }

  private async readSnapshot(): Promise<LocalCapability | null> {
    if (this.loaded) return this.snapshot
    this.loaded = true
    try {
      const read = this.options.read ?? (async (file: string) => {
        const { readFile } = await import('node:fs/promises')
        return readFile(file, 'utf8')
      })
      const text = await read(this.options.file)
      if (text) this.snapshot = JSON.parse(text) as LocalCapability
    } catch {
      this.snapshot = null
    }
    return this.snapshot
  }

  private async persist(value: LocalCapability): Promise<void> {
    this.snapshot = value
    this.loaded = true
    try {
      const write = this.options.write ?? (async (file: string, data: string) => {
        const { mkdir, writeFile } = await import('node:fs/promises')
        const { dirname } = await import('node:path')
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, data, 'utf8')
      })
      await write(this.options.file, JSON.stringify(value, null, 2))
    } catch {
      // Cache persistence is best effort.
    }
  }

  /**
   * Probe the host.
   *
   * Concurrent callers share one run. A result younger than `dedupeMs` is
   * reused, and a "no GPU here" answer is reused for `noGpuCacheMs` so a
   * GPU-less host does not pay the `systeminformation` fallback on every call.
   * `force` skips both windows.
   */
  async probe(force = false): Promise<LocalCapability> {
    if (this.inflight) return this.inflight
    if (!force && this.snapshot) {
      const age = Date.now() - this.lastProbeAt
      if (age < this.dedupeMs) return this.snapshot
      if (!this.snapshot.gpu.available && age < this.noGpuCacheMs) return this.snapshot
    }

    this.inflight = (async () => {
      const previous = this.snapshot ?? (await this.readSnapshot())
      const fresh = await probeCapability(this.options)
      this.lastProbeAt = Date.now()

      if (!fresh.gpu.available && previous?.gpu.available) {
        const age = Date.now() - previous.probedAt
        if (age < this.fallbackMaxAgeMs) {
          // Transient probe failure (driver busy, timeout): keep the last good
          // snapshot so routing does not lose local inference mid-session.
          const kept: LocalCapability = { ...previous, stale: true }
          this.snapshot = kept
          return kept
        }
      }
      await this.persist(fresh)
      return fresh
    })().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  /** Capability for the current call (probed at most once per `dedupeMs`). */
  async get(): Promise<LocalCapability> {
    return this.probe()
  }
}
