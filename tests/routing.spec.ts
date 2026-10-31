import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classify } from '../src/local/classify.js'
import { routeTask } from '../src/local/router.js'
import { resolveConfig } from '../src/config.js'
import { createVisionTool } from '../src/tools/learn-vision.js'
import { WikiStore } from '../src/tools/learn-wiki.js'
import { capability, noGpuCapability } from './support/fixtures.js'

describe('task tiering', () => {
  it('keeps plain screenshots light and sends chart analysis to the cloud', () => {
    expect(classify({ kind: 'image', question: '提取文字' })).toBe('light')
    expect(classify({ kind: 'image', question: '把这张截图里的文字识别出来' })).toBe('light')
    expect(classify({ kind: 'image', question: '分析这张图表的趋势' })).toBe('heavy')
    expect(classify({ kind: 'image', question: '这张图说明了什么，为什么这样' })).toBe('heavy')
    expect(classify({ kind: 'image' })).toBe('light')
    expect(classify({ kind: 'video' })).toBe('heavy')
  })

  it('keeps short audio local and long audio on the cloud', () => {
    expect(classify({ kind: 'audio', durationSeconds: 600, sizeBytes: 5_000_000 })).toBe('light')
    expect(classify({ kind: 'audio', durationSeconds: 20 * 60, sizeBytes: 5_000_000 })).toBe('heavy')
    expect(classify({ kind: 'audio', durationSeconds: 60, sizeBytes: 60 * 1024 * 1024 })).toBe('heavy')
    expect(classify({ kind: 'audio', durationSeconds: 60, channels: 2 })).toBe('heavy')
    expect(classify({ kind: 'audio', durationSeconds: 60, needsSpeakerSeparation: true })).toBe('heavy')
  })
})

describe('routing', () => {
  it('honours local-first and cloud-first policies', () => {
    const localFirst = routeTask({
      kind: 'image',
      tier: 'light',
      policy: 'local-first',
      capability: capability(),
      hasCloudKey: true,
    })
    expect(localFirst).toMatchObject({ route: 'local', engine: 'hunyuanocr' })

    const cloudFirst = routeTask({
      kind: 'image',
      tier: 'light',
      policy: 'cloud-first',
      capability: capability(),
      hasCloudKey: true,
    })
    expect(cloudFirst.route).toBe('cloud')
  })

  it('uses the local engine in auto mode without asking for a cloud key', () => {
    const decision = routeTask({
      kind: 'audio',
      tier: 'light',
      policy: 'auto',
      capability: capability(),
      hasCloudKey: false,
    })
    expect(decision).toMatchObject({ route: 'local', engine: 'faster-whisper' })
  })

  it('skips local OCR when free VRAM is below the threshold', () => {
    const lowVram = capability({
      localOcrReady: false,
      gpu: { ...capability().gpu, vramFreeMB: 1024 },
    })
    const withKey = routeTask({ kind: 'image', tier: 'light', capability: lowVram, hasCloudKey: true })
    expect(withKey.route).toBe('cloud')

    const withoutKey = routeTask({ kind: 'image', tier: 'light', capability: lowVram, hasCloudKey: false })
    expect(withoutKey.route).toBe('unavailable')
    if (withoutKey.route === 'unavailable') expect(withoutKey.userActionRequired).toBeTruthy()

    expect(routeTask({ kind: 'video', tier: 'heavy', capability: noGpuCapability(), hasCloudKey: false }).route).toBe('cloud')
  })

  it('reads an 18-byte fmt WAV header (SAPI) instead of assuming 44 bytes', async () => {
    const { wavDurationSeconds, estimateDurationSeconds } = await import('../src/tools/learn-audio.js')
    const sampleRate = 22050
    const samples = sampleRate * 2 * 2 // 2 seconds, mono int16
    const buffer = Buffer.alloc(44 + samples)
    buffer.write('RIFF', 0, 'ascii')
    buffer.writeUInt32LE(36 + samples, 4)
    buffer.write('WAVE', 8, 'ascii')
    buffer.write('fmt ', 12, 'ascii')
    buffer.writeUInt32LE(18, 16) // WAVEFORMATEX, not 16
    buffer.writeUInt16LE(1, 20)
    buffer.writeUInt16LE(1, 22)
    buffer.writeUInt32LE(sampleRate, 24)
    buffer.writeUInt32LE(sampleRate * 2, 28)
    buffer.writeUInt16LE(2, 32)
    buffer.writeUInt16LE(16, 34)
    buffer.writeUInt16LE(0, 36)
    buffer.write('data', 38, 'ascii')
    buffer.writeUInt32LE(samples, 42)

    const duration = wavDurationSeconds(new Uint8Array(buffer))
    expect(duration).toBeCloseTo(2, 1)
    expect(estimateDurationSeconds(1_000_000)).toBeGreaterThan(60)
    expect(wavDurationSeconds(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('reports a missing local file instead of asking for a cloud key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-learn-vision-missing-'))
    const tool = createVisionTool({
      config: resolveConfig({}),
      capability: async () => capability(),
      getWiki: () => new WikiStore(dir),
      modelDir: dir,
    })
    const result = (await tool.execute({
      source: join(dir, 'nope.png'),
      sourceType: 'path',
      question: '提取文字',
    })) as Record<string, unknown>
    expect(result.available).toBe(false)
    expect(result.reason).toBe('source_unreadable')
  })

  it('degrades from a failed local OCR to the cloud, and reports when both sides fail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-learn-vision-'))
    const failingOcr = async () => ({ available: false as const, reason: 'failed' as const, message: 'CUDA out of memory' })

    const cloudOk = createVisionTool({
      config: resolveConfig({ visionApiKey: 'sk-test' }),
      capability: async () => capability(),
      getWiki: () => new WikiStore(dir),
      modelDir: dir,
      ocr: failingOcr,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '图里有三行字' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    })

    const degraded = (await cloudOk.execute({
      source: 'https://example.com/a.png',
      question: '提取文字',
    })) as Record<string, unknown>
    expect(degraded.available).toBe(true)
    expect(degraded.route).toBe('cloud')
    expect(degraded.text).toBe('图里有三行字')

    const cloudDown = createVisionTool({
      config: resolveConfig({ visionApiKey: 'sk-test' }),
      capability: async () => capability(),
      getWiki: () => new WikiStore(dir),
      modelDir: dir,
      ocr: failingOcr,
      fetchImpl: (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch,
    })
    const failed = (await cloudDown.execute({
      source: 'https://example.com/a.png',
      question: '提取文字',
    })) as Record<string, unknown>
    expect(failed.available).toBe(false)
    expect(failed.route).toBe('unavailable')
    expect(String(failed.message)).toMatch(/CUDA out of memory/)
    expect(String(failed.message)).toMatch(/500/)
  })
})
