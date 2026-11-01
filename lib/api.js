/**
 * Tiny JSON API for the settings panel.
 *
 * Mounted under `/plugins/dsh-adaptive-learn/api` on the host webServer. Each
 * handler returns `{ ok: true, ... }` or `{ ok: false, error }`; secrets are
 * masked on the way out and never echoed.
 */
import { existsSync } from 'node:fs';
import { engineStatus } from './settings.js';
export const API_PREFIX = '/plugins/dsh-adaptive-learn/api';
const MAX_BODY = 64 * 1024;
function json(res, status, payload) {
    const response = res;
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(payload));
}
async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY)
            throw new Error('body too large');
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text)
        return {};
    return JSON.parse(text);
}
function capabilityView(capability) {
    if (!capability)
        return null;
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
    };
}
export function createApiHandler(deps) {
    return async (req, res) => {
        const method = (req.method ?? 'GET').toUpperCase();
        const path = new URL(String(req.url ?? '/'), 'http://localhost').pathname;
        const endpoint = path.startsWith(API_PREFIX) ? path.slice(API_PREFIX.length).replace(/^\/+/, '') : '';
        try {
            if (endpoint === 'settings' && method === 'GET') {
                const capability = await deps.cache.get().catch(() => null);
                json(res, 200, {
                    ok: true,
                    settings: deps.store.view(),
                    capability: capabilityView(capability),
                    engines: engineStatus(deps.modelDir, deps.dataDir, existsSync),
                });
                return;
            }
            if (endpoint === 'settings' && method === 'POST') {
                const body = await readJson(req);
                const applied = deps.store.save(body);
                json(res, 200, { ok: true, applied: Object.keys(applied), settings: deps.store.view() });
                return;
            }
            if (endpoint === 'probe' && method === 'POST') {
                const capability = await deps.cache.probe(true);
                json(res, 200, { ok: true, capability: capabilityView(capability) });
                return;
            }
            if (endpoint === '' || endpoint === 'health') {
                json(res, 200, { ok: true, plugin: 'dsh-adaptive-learn' });
                return;
            }
            json(res, 404, { ok: false, error: `unknown endpoint: ${endpoint || '/'}` });
        }
        catch (error) {
            json(res, 400, { ok: false, error: error?.message ?? 'bad request' });
        }
    };
}
