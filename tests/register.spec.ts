import { describe, expect, it } from 'vitest'
import { apply, createLearnTools, type PluginContext } from '../src/index.js'
import { resolveConfig } from '../src/config.js'
import { WikiStore } from '../src/tools/learn-wiki.js'
import { FakeToolRegistry } from './support/dsh-tools.js'
import { capability, noGpuCapability } from './support/fixtures.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EXPECTED_TOOLS = [
  'self_learn_fetch',
  'self_learn_vision',
  'self_learn_audio',
  'self_learn_wiki_recall',
  'self_learn_wiki_stage',
  'self_learn_wiki_commit',
]

async function harness(options: { withGpu?: boolean; visionKey?: string; audioKey?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-learn-test-'))
  const registry = new FakeToolRegistry()
  const ctx = { tools: registry, dataDir: dir } as unknown as PluginContext
  const config = resolveConfig({
    visionApiKey: options.visionKey ?? '',
    audioApiKey: options.audioKey ?? '',
    // Absolute temp dir keeps every run isolated from the workspace knowledge base.
    knowledgeDir: join(dir, '_knowledge'),
  })
  apply(ctx, { ...config }, {
    capability: async () => (options.withGpu ? capability() : noGpuCapability()),
  })
  return { registry, dir }
}

describe('plugin registration', () => {
  it('registers exactly the six documented tools and rejects missing required arguments', async () => {
    const { registry } = await harness({ withGpu: true })

    expect([...registry.tools.keys()].sort()).toEqual([...EXPECTED_TOOLS].sort())
    expect(registry.tools.size).toBe(6)

    await expect(registry.call('self_learn_vision', {})).rejects.toThrow(/source/)
    await expect(registry.call('self_learn_fetch', {})).rejects.toThrow(/url/)
    await expect(registry.call('self_learn_wiki_recall', {})).rejects.toThrow(/query/)
    await expect(registry.call('self_learn_wiki_stage', { content: '只有正文' })).rejects.toThrow(/sources/)
    await expect(registry.call('self_learn_wiki_commit', {})).rejects.toThrow(/title/)
  })

  it('loads without keys or GPU: fetch and wiki still work, vision/audio ask for a key', async () => {
    const { registry, dir } = await harness({ withGpu: false })

    const vision = (await registry.call('self_learn_vision', {
      source: 'https://example.com/chart.png',
      question: '分析这张图表',
    })) as Record<string, unknown>
    expect(vision.available).toBe(false)
    expect(vision.reason).toBe('vision_api_key_missing')
    expect(String(vision.userActionRequired)).toMatch(/密钥|key/i)
    expect(Array.isArray(vision.freeOptions)).toBe(true)
    expect((vision.freeOptions as string[]).length).toBeGreaterThan(0)

    const audio = (await registry.call('self_learn_audio', {
      source: join(dir, 'missing.mp3'),
      sourceType: 'path',
    })) as Record<string, unknown>
    expect(audio.available).toBe(false)

    const stage = (await registry.call('self_learn_wiki_stage', {
      content: '结论：插件骨架可加载。',
      sources: [{ type: 'web', ref: 'https://example.com/doc', engine: 'self_learn_fetch' }],
      title: '骨架验证',
    })) as Record<string, unknown>
    expect(stage.available).toBe(true)
    expect(stage.status).toBe('staged')

    const recallBefore = (await registry.call('self_learn_wiki_recall', { query: '骨架验证' })) as Record<string, unknown>
    expect(recallBefore.count).toBe(0)

    const commit = (await registry.call('self_learn_wiki_commit', { title: '骨架验证' })) as Record<string, unknown>
    expect(commit.available).toBe(true)
    expect(commit.status).toBe('committed')

    const recallAfter = (await registry.call('self_learn_wiki_recall', { query: '骨架验证' })) as Record<string, unknown>
    expect(recallAfter.count).toBe(1)
  })

  it('registers the skill as a provider FACTORY, which is what the host expects', async () => {
    const { installSkill } = await import('../src/index.js')
    let captured: unknown
    const ctx = {
      tools: new FakeToolRegistry(),
      inject(_deps: string[], callback: (scope: Record<string, unknown>) => void) {
        callback({ skills: { registerProvider: (factory: unknown) => { captured = factory } } })
      },
    } as unknown as PluginContext

    installSkill(ctx)
    expect(typeof captured).toBe('function')

    const provider = (captured as () => { name: string; list: () => Promise<unknown[]>; get: () => Promise<unknown> })()
    expect(provider.name).toBe('dsh-adaptive-learn')
    const listed = (await provider.list()) as { name: string; description: string }[]
    expect(listed[0]?.name).toBe('dsh-adaptive-learn')
    expect(listed[0]?.description).toContain('没有现成材料')
    const full = (await provider.get()) as { content: string }
    expect(full.content).toContain('self_learn_wiki_recall')
  })

  it('builds the tool set directly and keeps the empty-GPU capability honest', () => {
    const tools = createLearnTools({
      config: resolveConfig({}),
      capability: async () => noGpuCapability(),
      getWiki: () => new WikiStore(join(tmpdir(), 'dsh-learn-unused')),
      modelDir: join(tmpdir(), 'dsh-learn-unused', 'models'),
    })
    expect(tools).toHaveLength(6)
    expect(capability().localOcrReady).toBe(true)
    expect(noGpuCapability().localOcrReady).toBe(false)
  })
})
