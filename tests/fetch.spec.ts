import { describe, expect, it } from 'vitest'
import { createFetchTool, isPrivateAddress } from '../src/tools/learn-fetch.js'
import { resolveConfig } from '../src/config.js'
import { WikiStore } from '../src/tools/learn-wiki.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDeps } from '../src/tools/base.js'

describe('fetch address guard', () => {
  it('flags loopback, private, link-local and metadata addresses', () => {
    for (const host of [
      'localhost',
      'api.localhost',
      'printer.local',
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.8',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '[::1]',
      'fe80::1',
      'fd00::1',
      '::ffff:192.168.1.1',
    ]) {
      expect(isPrivateAddress(host), host).toBe(true)
    }
  })

  it('lets public hosts through', () => {
    for (const host of ['example.com', '203.0.113.9', '8.8.8.8', 'www.baidu.com', '172.32.0.1']) {
      expect(isPrivateAddress(host), host).toBe(false)
    }
  })

  it('blocks a private URL with a structured reason before any request', async () => {
    let called = 0
    const tool = createFetchTool({
      config: resolveConfig({}),
      getWiki: () => new WikiStore(join(tmpdir(), 'unused')),
      capability: async () => {
        throw new Error('unused')
      },
      modelDir: join(tmpdir(), 'unused'),
      fetchImpl: (async () => {
        called += 1
        return new Response('should not happen')
      }) as unknown as typeof fetch,
    } as ToolDeps)

    const result = (await tool.execute({ url: 'http://127.0.0.1:47812/gbk.html' })) as Record<string, unknown>
    expect(result.available).toBe(false)
    expect(result.reason).toBe('blocked_private_address')
    expect(called).toBe(0)
  })

  it('re-checks every redirect hop, so a public 302 cannot reach the intranet', async () => {
    const tool = createFetchTool({
      config: resolveConfig({}),
      getWiki: () => new WikiStore(join(tmpdir(), 'unused')),
      capability: async () => {
        throw new Error('unused')
      },
      modelDir: join(tmpdir(), 'unused'),
      fetchImpl: (async (input: string | URL | Request) => {
        const target = String(typeof input === 'string' ? input : (input as Request).url ?? input)
        if (target.startsWith('https://public.example')) {
          return new Response(null, { status: 302, headers: { location: 'http://192.168.1.1/admin' } })
        }
        return new Response('internal secret')
      }) as unknown as typeof fetch,
    } as ToolDeps)

    const result = (await tool.execute({ url: 'https://public.example/start' })) as Record<string, unknown>
    expect(result.available).toBe(false)
    expect(result.reason).toBe('blocked_private_address')
    expect(String(result.message)).toContain('192.168.1.1')
  })

  it('honours allowPrivateUrls for people who really need their intranet', async () => {
    const tool = createFetchTool({
      config: resolveConfig({ allowPrivateUrls: true }),
      getWiki: () => new WikiStore(join(tmpdir(), 'unused')),
      capability: async () => {
        throw new Error('unused')
      },
      modelDir: join(tmpdir(), 'unused'),
      fetchImpl: (async () =>
        new Response('<html><head><title>内网</title></head><body><main>内网文档正文</main></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })) as unknown as typeof fetch,
    } as ToolDeps)

    const result = (await tool.execute({ url: 'http://192.168.1.10/docs' })) as Record<string, unknown>
    expect(result.available).toBe(true)
    expect(String(result.text)).toContain('内网文档正文')
  })
})
