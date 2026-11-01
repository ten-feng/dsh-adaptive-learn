import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capText, createAudioTool, wavDurationSeconds } from '../src/tools/learn-audio.js'
import { resolveConfig } from '../src/config.js'
import { WikiStore } from '../src/tools/learn-wiki.js'
import { capability } from './support/fixtures.js'

describe('transcript cap', () => {
  it('keeps short transcripts untouched and reports the size', () => {
    const result = capText('今天天气不错', 8000)
    expect(result).toEqual({ text: '今天天气不错', totalChars: 6, truncated: false })
  })

  it('truncates long transcripts and says so', () => {
    const long = '句子。'.repeat(5000) // 15000 字
    const result = capText(long, 8000)
    expect(result.text.length).toBe(8000)
    expect(result.totalChars).toBe(15000)
    expect(result.truncated).toBe(true)
  })

  it('falls back to 8000 when the configured cap is nonsense', () => {
    const long = 'x'.repeat(9000)
    expect(capText(long, 0).text.length).toBe(8000)
    expect(capText(long, Number.NaN).text.length).toBe(8000)
  })
})

describe('audio tool truncation (cloud path)', () => {
  it('caps a long cloud transcript and reports truncated=true', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-audio-cap-'))
    const wav = join(dir, 'long.wav')
    // 660 秒 @16k 单声道 16bit，静音内容即可（不会真的被转写）
    const sampleRate = 16000
    const seconds = 660
    const bytes = sampleRate * 2 * seconds
    const header = Buffer.alloc(44)
    header.write('RIFF', 0, 'ascii')
    header.writeUInt32LE(36 + bytes, 4)
    header.write('WAVE', 8, 'ascii')
    header.write('fmt ', 12, 'ascii')
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(sampleRate * 2, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36, 'ascii')
    header.writeUInt32LE(bytes, 40)
    await writeFile(wav, Buffer.concat([header, Buffer.alloc(bytes)]))

    const tool = createAudioTool({
      config: resolveConfig({ audioApiKey: 'sk-test', maxAudioChars: 100 }),
      capability: async () => capability(),
      getWiki: () => new WikiStore(join(dir, 'kb')),
      modelDir: dir,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ text: '这是云端转写结果。'.repeat(100) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    })

    const result = (await tool.execute({ source: wav, sourceType: 'path', language: 'zh' })) as Record<string, unknown>
    expect(result.available).toBe(true)
    expect(result.route).toBe('cloud')
    expect((result.text as string).length).toBe(100)
    expect(result.totalChars).toBe(900)
    expect(result.truncated).toBe(true)
    expect(wavDurationSeconds(new Uint8Array(await (await import('node:fs/promises')).readFile(wav)))).toBeCloseTo(
      seconds,
      0,
    )
  })
})
