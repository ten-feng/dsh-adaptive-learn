/**
 * Tiny JSON API for the settings panel.
 *
 * Mounted under `/plugins/dsh-adaptive-learn/api` on the host webServer. Each
 * handler returns `{ ok: true, ... }` or `{ ok: false, error }`; secrets are
 * masked on the way out and never echoed.
 */
import { existsSync } from 'node:fs'
import type { CapabilityCache, LocalCapability } from './local/capability.js'
import { engineStatus, type SettingsStore } from './settings.js'

export const API_PREFIX = '/plugins/dsh-adaptive-learn/api'

export interface ApiDeps {
  store: SettingsStore
  cache: CapabilityCache
  modelDir: string
  dataDir: string
}

const MAX_BODY = 64 * 1024

function json(res: NodeJS.WritableStream & { writeHead?: unknown; end?: unknown }, status: number, payload: unknown): void {
  const response = res as unknown as {
    writeHead: (code: number, headers: Record<string, string>) => void
    end: (body: string) => void
  }
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(payload))
}

async function readJson(req: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  return JSON.parse(text)
}

function capabilityView(capability: LocalCapability | null): Record<string, unknown> | null {
  if (!capability) return null
  return {
    gpu: {
      available: capability.gpu.available,
      name: capability.gpu.name,
      vramFreeMB: capability.gpu.vramFreeMB,
      vramTotalMB: capability.gpu.vramTotalMB,
      cudaCapability: capability.gpu.cudaCapability,
    },
    localOcrReady: capability.localOcrReady,
    localAsrReady: capability.localAsrReady,
    asrModel: capability.localAsrModelSuggestion,
    probedAt: capability.probedAt,
    stale: capability.stale === true,
  }
}

export function createApiHandler(deps: ApiDeps) {
  return async (req: { method?: string; url?: string }, res: unknown): Promise<void> => {
    const method = (req.method ?? 'GET').toUpperCase()
    const path = new URL(String(req.url ?? '/'), 'http://localhost').pathname
    const endpoint = path.startsWith(API_PREFIX) ? path.slice(API_PREFIX.length).replace(/^\/+/, '') : ''

    try {
      if (endpoint === 'settings' && method === 'GET') {
        const capability = await deps.cache.get().catch(() => null)
        json(res as never, 200, {
          ok: true,
          settings: deps.store.view(),
          capability: capabilityView(capability),
          engines: engineStatus(deps.modelDir, deps.dataDir, existsSync),
        })
        return
      }

      if (endpoint === 'settings' && method === 'POST') {
        const body = await readJson(req as unknown as NodeJS.ReadableStream)
        const applied = deps.store.save(body)
        json(res as never, 200, { ok: true, applied: Object.keys(applied), settings: deps.store.view() })
        return
      }

      if (endpoint === 'probe' && method === 'POST') {
        const capability = await deps.cache.probe(true)
        json(res as never, 200, { ok: true, capability: capabilityView(capability) })
        return
      }

      if (endpoint === '' || endpoint === 'health') {
        json(res as never, 200, { ok: true, plugin: 'dsh-adaptive-learn' })
        return
      }

      json(res as never, 404, { ok: false, error: `unknown endpoint: ${endpoint || '/'}` })
    } catch (error) {
      json(res as never, 400, { ok: false, error: (error as Error)?.message ?? 'bad request' })
    }
  }
}
