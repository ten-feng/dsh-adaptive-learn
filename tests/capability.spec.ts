import { describe, expect, it } from 'vitest'
import {
  CapabilityCache,
  computeReadiness,
  parseNvidiaSmi,
  probeCapability,
  suggestAsrModel,
} from '../src/local/capability.js'

describe('local capability probe', () => {
  it('derives VRAM, compute capability and readiness from nvidia-smi', async () => {
    const exec = async () => ' NVIDIA GeForce RTX 3060, 12288, 11000, 8.6\n'

    const capability = await probeCapability({
      exec,
      ocrMinVramMB: 2048,
      asrMinVramMB: 1024,
      now: () => 1_700_000_000_000,
    })

    expect(capability.gpu.available).toBe(true)
    expect(capability.gpu.detectionMethod).toBe('nvidia-smi')
    expect(capability.gpu.vramFreeMB).toBe(11000)
    expect(capability.gpu.cudaCapability).toBeCloseTo(8.6)
    expect(capability.localOcrReady).toBe(true)
    expect(capability.localAsrReady).toBe(true)
    expect(capability.localAsrModelSuggestion).toBe('large-v3-turbo')
    expect(capability.localAsrComputeType).toBe('float16')
    expect(capability.probedAt).toBe(1_700_000_000_000)
  })

  it('reports gpu.available=false when probing fails, without throwing', async () => {
    const exec = async () => {
      throw new Error('nvidia-smi: not found')
    }
    const graphics = async () => {
      throw new Error('systeminformation unavailable')
    }

    const capability = await probeCapability({ exec, graphics })

    expect(capability.gpu.available).toBe(false)
    expect(capability.gpu.detectionMethod).toBe('none')
    expect(capability.localOcrReady).toBe(false)
    expect(capability.localAsrReady).toBe(false)
    expect(capability.cpu.cores).toBeGreaterThan(0)
  })

  it('forces INT8 below compute capability 7.0 and respects the configured minimums', () => {
    const parsed = parseNvidiaSmi('Tesla P100, 16384, 900, 6.0')!
    const readiness = computeReadiness(parsed, { ocrMinVramMB: 2048, asrMinVramMB: 1024, localAsrModel: 'auto' })

    expect(readiness.localAsrComputeType).toBe('int8_float32')
    expect(readiness.localOcrReady).toBe(false) // 900 MB free < 2048 MB
    expect(readiness.localAsrReady).toBe(false) // 900 MB free < 1024 MB
    expect(readiness.localAsrModelSuggestion).toBe('small')
    expect(suggestAsrModel(1600)).toBe('small')
    expect(suggestAsrModel(3200)).toBe('medium')
    expect(suggestAsrModel(6000)).toBe('large-v3-turbo')
  })

  it('falls back to systeminformation when nvidia-smi is missing', async () => {
    const exec = async () => {
      throw new Error('ENOENT')
    }
    const graphics = async () => [{ vendor: 'NVIDIA', model: 'Quadro T1000', vram: 4096 }]

    const capability = await probeCapability({ exec, graphics, ocrMinVramMB: 2048, asrMinVramMB: 1024 })

    expect(capability.gpu.available).toBe(true)
    expect(capability.gpu.detectionMethod).toBe('systeminformation')
    expect(capability.gpu.vramFreeMB).toBe(4096)
    expect(capability.localOcrReady).toBe(true)
  })
})

describe('capability cache', () => {
  const memory = () => {
    const files = new Map<string, string>()
    return {
      read: async (file: string) => files.get(file) ?? null,
      write: async (file: string, data: string) => {
        files.set(file, data)
      },
    }
  }

  it('re-probes on every call so a changed free-VRAM reading takes effect', async () => {
    let free = 12000
    let probes = 0
    const cache = new CapabilityCache({
      file: 'C:/tmp/capability.json',
      ...memory(),
      dedupeMs: 0,
      exec: async () => {
        probes += 1
        return `NVIDIA GeForce RTX 4090, 24564, ${free}, 8.9`
      },
    })

    const first = await cache.get()
    expect(first.localOcrReady).toBe(true)
    expect(probes).toBe(1)

    free = 800 // another app took the GPU between two tool calls
    const second = await cache.get()
    expect(second.gpu.vramFreeMB).toBe(800)
    expect(second.localOcrReady).toBe(false)
    expect(probes).toBe(2)
  })

  it('reuses the snapshot for the default 10 s dedupe window, and force bypasses it', async () => {
    let probes = 0
    const cache = new CapabilityCache({
      file: 'C:/tmp/capability.json',
      ...memory(),
      exec: async () => {
        probes += 1
        return `NVIDIA GeForce RTX 3060, 12288, ${9000 + probes}, 8.6`
      },
    })

    const first = await cache.get()
    expect(first.gpu.vramFreeMB).toBe(9001)
    const second = await cache.get() // inside the default 10 s window
    expect(second.gpu.vramFreeMB).toBe(9001)
    expect(probes).toBe(1)

    const forced = await cache.probe(true)
    expect(forced.gpu.vramFreeMB).toBe(9002)
    expect(probes).toBe(2)
  })

  it('caches a "no GPU" verdict for 60 s instead of re-running the fallback', async () => {
    let execCalls = 0
    let graphicsCalls = 0
    const cache = new CapabilityCache({
      file: 'C:/tmp/capability.json',
      ...memory(),
      dedupeMs: 0,
      exec: async () => {
        execCalls += 1
        throw new Error('nvidia-smi missing')
      },
      graphics: async () => {
        graphicsCalls += 1
        return []
      },
    })

    const first = await cache.get()
    expect(first.gpu.available).toBe(false)
    expect(execCalls).toBe(1)
    expect(graphicsCalls).toBe(1)

    const second = await cache.get() // negative cache, no new probing
    expect(second.gpu.available).toBe(false)
    expect(execCalls).toBe(1)
    expect(graphicsCalls).toBe(1)
  })

  it('shares one probe between concurrent calls and keeps a good snapshot when a probe fails', async () => {
    let failing = false
    let probes = 0
    const cache = new CapabilityCache({
      file: 'C:/tmp/capability.json',
      ...memory(),
      dedupeMs: 0,
      exec: async () => {
        probes += 1
        if (failing) throw new Error('nvidia-smi busy')
        return 'NVIDIA GeForce RTX 3060, 12288, 9000, 8.6'
      },
      graphics: async () => {
        throw new Error('no fallback')
      },
    })

    const [a, b] = await Promise.all([cache.get(), cache.get()])
    expect(probes).toBe(1)
    expect(a.gpu.vramFreeMB).toBe(9000)
    expect(b.gpu.vramFreeMB).toBe(9000)

    failing = true
    const kept = await cache.get()
    expect(kept.gpu.vramFreeMB).toBe(9000)
    expect(kept.stale).toBe(true)
  })
})
