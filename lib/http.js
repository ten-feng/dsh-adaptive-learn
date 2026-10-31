/**
 * Minimal OpenAI-compatible HTTP client.
 *
 * Contract: transports never throw for an upstream failure — they resolve to a
 * structured error the tool can surface as `available:false`. Secrets are only
 * ever placed in the Authorization header and never logged.
 */
const DEFAULT_TIMEOUT_MS = 60_000;
function parseRetryAfter(value) {
    if (!value)
        return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds))
        return Math.max(0, Math.round(seconds * 1000));
    const at = Date.parse(value);
    if (Number.isFinite(at))
        return Math.max(0, at - Date.now());
    return undefined;
}
async function request(url, init, options) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        if (response.status === 429) {
            return {
                ok: false,
                error: {
                    available: false,
                    reason: 'rate_limited',
                    status: 429,
                    message: '上游限流（429），请稍后重试或降低调用频率。',
                    retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
                },
            };
        }
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            return {
                ok: false,
                error: {
                    available: false,
                    reason: 'upstream_error',
                    status: response.status,
                    message: `上游返回 ${response.status}：${body.slice(0, 400)}`,
                },
            };
        }
        const data = (await response.json());
        return { ok: true, data, status: response.status };
    }
    catch (error) {
        const aborted = error?.name === 'AbortError';
        return {
            ok: false,
            error: {
                available: false,
                reason: aborted ? 'timeout' : 'network_error',
                message: aborted ? `请求超时（${timeoutMs} ms）。` : `网络错误：${error?.message ?? 'unknown'}`,
            },
        };
    }
    finally {
        clearTimeout(timer);
    }
}
function authHeaders(options, extra) {
    const headers = { ...(options.headers ?? {}), ...(extra ?? {}) };
    if (options.apiKey)
        headers.authorization = `Bearer ${options.apiKey}`;
    return headers;
}
/** POST a JSON body. */
export function postJson(url, body, options = {}) {
    return request(url, {
        method: 'POST',
        headers: authHeaders(options, { 'content-type': 'application/json' }),
        body: JSON.stringify(body),
    }, options);
}
/** POST multipart/form-data (the file is passed through untouched). */
export function postForm(url, form, options = {}) {
    return request(url, { method: 'POST', headers: authHeaders(options), body: form }, options);
}
/** Redact anything that looks like a credential before it reaches a log. */
export function redactHeaders(headers) {
    const out = {};
    for (const [key, value] of Object.entries(headers)) {
        out[key] = /authorization|api[-_]?key|cookie/i.test(key) ? '***' : value;
    }
    return out;
}
