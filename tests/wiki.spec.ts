import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideTrigger, scoreRequest } from '../src/local/classify.js'
import { WikiStore } from '../src/tools/learn-wiki.js'
import { evaluatePreStep, resolveKnowledgeRoot, type PluginContext } from '../src/index.js'
import { resolveConfig } from '../src/config.js'

const baseConfig = resolveConfig({})

/** A fake host context exposing only the workspace registry. */
function registryCtx(): PluginContext {
  const workspaceRegistry = {
    state: {
      global: { defaultWorkspaceId: 'w2' },
      tables: {
        workspaces: {
          w1: { path: 'C:/ws/alpha', sessionIds: ['session-a'] },
          w2: { path: 'C:/ws/beta', sessionIds: [] },
        },
      },
    },
  }
  return { get: (name: string) => (name === 'workspaceRegistry' ? workspaceRegistry : undefined) } as unknown as PluginContext
}

describe('knowledge root', () => {
  it('resolves the calling session workspace instead of the profile cwd', () => {
    const ctx = registryCtx()
    expect(resolveKnowledgeRoot(ctx, baseConfig, { id: 'session-a' }).replace(/\\/g, '/')).toBe('C:/ws/alpha/_knowledge')
    expect(resolveKnowledgeRoot(ctx, baseConfig, { id: 'unknown' }).replace(/\\/g, '/')).toBe('C:/ws/beta/_knowledge')
    expect(resolveKnowledgeRoot(ctx, resolveConfig({ knowledgeDir: 'C:/kb' }), { id: 'session-a' })).toBe('C:/kb')
    // The session's own cwd wins over any registry entry.
    expect(resolveKnowledgeRoot(ctx, baseConfig, { id: 'session-a', cwd: 'C:/ws/live' }).replace(/\\/g, '/')).toBe(
      'C:/ws/live/_knowledge',
    )
    // DSH keeps the creation cwd on the durable header.
    expect(
      resolveKnowledgeRoot(ctx, baseConfig, { id: 'session-a', header: { cwd: 'C:/ws/header' } }).replace(/\\/g, '/'),
    ).toBe('C:/ws/header/_knowledge')
  })

  it('falls back to the environment when no registry is present', () => {
    const previous = process.env.DSH_WORKSPACE
    process.env.DSH_WORKSPACE = 'C:/ws/from-env'
    try {
      const root = resolveKnowledgeRoot({} as PluginContext, baseConfig)
      expect(root.replace(/\\/g, '/')).toBe('C:/ws/from-env/_knowledge')
    } finally {
      if (previous === undefined) delete process.env.DSH_WORKSPACE
      else process.env.DSH_WORKSPACE = previous
    }
  })
})

async function store(options: { requireSource?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-learn-wiki-'))
  return new WikiStore(dir, options)
}

describe('two-tier knowledge base', () => {
  it('keeps staged entries out of recall until commit, and refuses a source-less commit', async () => {
    const wiki = await store()

    await wiki.stage({ content: 'Vite 的 optimizeDeps 可以预热依赖。', sources: [{ type: 'web', ref: 'https://vite.dev/guide/', engine: 'self_learn_fetch' }], title: 'Vite 依赖预热' })
    expect(await wiki.recall('Vite 依赖预热')).toHaveLength(0)

    await wiki.stage({ content: '没有来源的结论。', sources: [], title: '无来源条目' })
    await expect(wiki.commit('无来源条目')).rejects.toThrow(/来源|sources/)

    const committed = await wiki.commit('Vite 依赖预热')
    expect(committed.sources).toHaveLength(1)

    const hits = await wiki.recall('Vite 依赖预热')
    expect(hits.length).toBe(1)
    expect(hits[0]?.title).toBe('Vite 依赖预热')
  })

  it('records the engine of every source verbatim', async () => {
    const wiki = await store()
    await wiki.stage({
      content: '截图里写的是 config.yml。',
      title: '截图转写',
      sources: [
        { type: 'image', ref: 'https://example.com/shot.png', engine: 'local-hunyuanocr' },
        { type: 'audio', ref: 'meeting.wav', engine: 'local-faster-whisper-small' },
        { type: 'web', ref: 'https://example.com/doc', engine: 'self_learn_fetch' },
      ],
    })
    const committed = await wiki.commit('截图转写')
    expect(committed.sources.map((source) => source.engine)).toEqual([
      'local-hunyuanocr',
      'local-faster-whisper-small',
      'self_learn_fetch',
    ])
    expect(committed.sources.map((source) => source.type)).toEqual(['image', 'audio', 'web'])
  })
})

describe('trigger', () => {
  it('never auto-scores an explicit /learn request', () => {
    const decision = decideTrigger({
      text: '/learn 帮我看一下 Vite 6 的 worker 配置',
      mode: 'both',
      explicitPrefixes: ['/learn'],
      threshold: 2,
      cooldownMs: 0,
    })
    expect(decision.action).toBe('explicit')
    expect(decision.text).toBe('帮我看一下 Vite 6 的 worker 配置')
    expect(decision.score).toBe(0)
  })

  it('stays silent for small talk and fires on a real knowledge gap', () => {
    const smallTalk = decideTrigger({
      text: '好的，谢谢',
      mode: 'auto',
      explicitPrefixes: ['/learn'],
      threshold: 2,
      cooldownMs: 0,
    })
    expect(smallTalk.action).toBe('none')

    expect(scoreRequest('好的，谢谢')).toBeLessThan(2)
    expect(scoreRequest('这个 API 我一直不会，报错了，怎么实现？')).toBeGreaterThanOrEqual(2)

    const gap = decideTrigger({
      text: '这个 API 我一直不会，报错了，怎么实现？',
      mode: 'auto',
      explicitPrefixes: ['/learn'],
      threshold: 2,
      cooldownMs: 0,
    })
    expect(gap.action).toBe('auto')
  })

  it('ignores attachments entirely: only the command or the score can trigger', () => {
    // A bare voice clip carries no text to score → nothing happens.
    const bareAudio = decideTrigger({
      text: '',
      mode: 'both',
      explicitPrefixes: ['/learn'],
      threshold: 2,
      cooldownMs: 0,
    })
    expect(bareAudio.action).toBe('none')

    // A picture with a knowledge-gap question is scored like any other text.
    const pictureWithGap = decideTrigger({
      text: '这个报错我不会，怎么实现？',
      mode: 'both',
      explicitPrefixes: ['/learn'],
      threshold: 2,
      cooldownMs: 0,
    })
    expect(pictureWithGap.action).toBe('auto')

    // A picture with plain text stays silent.
    const pictureSmallTalk = decideTrigger({
      text: '好的，谢谢',
      mode: 'both',
      explicitPrefixes: ['/learn'],
      threshold: 2,
      cooldownMs: 0,
    })
    expect(pictureSmallTalk.action).toBe('none')

    // `/learn` is the manual entry point.
    const forced = decideTrigger({
      text: '/learn 看看这张图',
      mode: 'both',
      explicitPrefixes: ['/learn'],
      threshold: 2,
      cooldownMs: 0,
    })
    expect(forced.action).toBe('explicit')

    // The pre-step hook no longer looks at attachments at all.
    const imageMessage = {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'image', attachment: { mimeType: 'image/png' } }],
    }
    expect(evaluatePreStep([imageMessage], baseConfig, { now: Date.now() }).injected).toBe('none')

    const gapMessage = {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: '这个 API 我一直不会，报错了' }],
    }
    expect(evaluatePreStep([gapMessage], baseConfig, { now: Date.now() }).injected).toBe('auto')
  })

  it('respects the 3-minute cooldown between two automatic injections', () => {
    const now = Date.now()
    const cooldownMs = baseConfig.autoCooldownMinutes * 60_000
    expect(cooldownMs).toBe(3 * 60_000)

    const inside = decideTrigger({
      text: '这个报错我不会，怎么实现？',
      mode: 'auto',
      explicitPrefixes: ['/learn'],
      threshold: 2,
      cooldownMs,
      lastInjectedAt: now - 60_000,
      now,
    })
    expect(inside.action).toBe('none')

    const after = decideTrigger({
      text: '这个报错我不会，怎么实现？',
      mode: 'auto',
      explicitPrefixes: ['/learn'],
      threshold: 2,
      cooldownMs,
      lastInjectedAt: now - (cooldownMs + 1_000),
      now,
    })
    expect(after.action).toBe('auto')
  })
})
