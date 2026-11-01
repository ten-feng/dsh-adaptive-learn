/**
 * `self_learn_fetch` — read one web page into readable text.
 *
 * Node's built-in fetch plus a regex extractor: no DOM dependency, no other
 * plugin involved, and the byte/charset sniffing happens before decoding.
 */
import { decodeBody, extractReadable, sniffCharset } from '../extract.js';
import { jsonRender, objectSchema } from './base.js';
/** 私有/保留地址判定：只做字面量检查，够挡住误用与诱导访问。 */
export function isPrivateAddress(hostname) {
    const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!host)
        return true;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
        return true;
    }
    if (host === '0.0.0.0' || host === '::' || host === '::1')
        return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        const [a, b] = host.split('.').map(Number);
        if (a === 0 || a === 10 || a === 127)
            return true;
        if (a === 169 && b === 254)
            return true;
        if (a === 172 && b >= 16 && b <= 31)
            return true;
        if (a === 192 && b === 168)
            return true;
        if (a === 100 && b >= 64 && b <= 127)
            return true; // CGNAT
        if (a >= 224)
            return true; // 组播/保留
        return false;
    }
    const v6 = host.startsWith('::ffff:') ? host.slice(7) : host;
    if (v6 !== host)
        return isPrivateAddress(v6);
    if (/^(fc|fd)/.test(host))
        return true; // 唯一本地地址
    if (/^fe[89ab]/.test(host))
        return true; // 链路本地
    return false;
}
function assertFetchable(target, allowPrivate) {
    const parsed = new URL(target);
    if (!/^https?:$/.test(parsed.protocol)) {
        throw Object.assign(new Error(`不支持的协议：${parsed.protocol}`), { code: 'unsupported_url' });
    }
    if (!allowPrivate && isPrivateAddress(parsed.hostname)) {
        throw Object.assign(new Error(`拒绝访问私有地址：${parsed.hostname}`), { code: 'blocked_private_address' });
    }
    return parsed;
}
/** 手动跟随重定向，每一跳都重新校验，避免公网 302 到内网。 */
async function fetchWithGuard(url, fetchImpl, allowPrivate) {
    let current = url;
    for (let hop = 0; hop < 5; hop += 1) {
        assertFetchable(current, allowPrivate);
        const response = await fetchImpl(current, {
            redirect: 'manual',
            headers: { 'user-agent': 'dsh-adaptive-learn/0.1 (+https://deepseek.com)' },
        });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location)
                return { response, finalUrl: current };
            current = new URL(location, current).toString();
            continue;
        }
        return { response, finalUrl: current };
    }
    throw Object.assign(new Error('重定向超过 5 次'), { code: 'too_many_redirects' });
}
export function createFetchTool(deps) {
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    return {
        name: 'self_learn_fetch',
        description: '读取一个网页并提取可读正文（自动去脚本/导航/页脚，嗅探 GBK/UTF-8，按上限截断）。只用于本次学习流程。',
        parameters: {
            url: { type: 'string', required: true, description: '要读取的 http(s) 页面地址' },
        },
        output: {
            schema: objectSchema({
                available: { type: 'boolean' },
                url: { type: 'string' },
                title: { type: 'string' },
                text: { type: 'string' },
                totalChars: { type: 'number' },
                truncated: { type: 'boolean' },
                charset: { type: 'string' },
                reason: { type: 'string' },
                message: { type: 'string' },
            }, ['available', 'url']),
            render: jsonRender,
        },
        async execute(args) {
            const url = String(args.url);
            if (!/^https?:\/\//i.test(url)) {
                return { available: false, url, reason: 'unsupported_url', message: '只支持 http/https 地址。' };
            }
            let response;
            let finalUrl = url;
            try {
                const result = await fetchWithGuard(url, fetchImpl, deps.config.allowPrivateUrls === true);
                response = result.response;
                finalUrl = result.finalUrl;
            }
            catch (error) {
                const code = error?.code;
                if (code === 'blocked_private_address') {
                    return {
                        available: false,
                        url,
                        reason: 'blocked_private_address',
                        message: `拒绝访问内网/回环地址（${error.message}）。如确需访问，请在插件配置里把 allowPrivateUrls 设为 true。`,
                    };
                }
                if (code === 'unsupported_url') {
                    return { available: false, url, reason: 'unsupported_url', message: error.message };
                }
                return {
                    available: false,
                    url,
                    reason: 'fetch_failed',
                    message: `抓取失败：${error?.message ?? 'unknown'}`,
                };
            }
            if (!response.ok) {
                return {
                    available: false,
                    url: finalUrl,
                    reason: 'http_error',
                    message: `HTTP ${response.status} ${response.statusText}`,
                };
            }
            const contentType = response.headers.get('content-type') ?? '';
            if (contentType && !/text\/|html|xml|json/i.test(contentType)) {
                return {
                    available: false,
                    url: finalUrl,
                    reason: 'unsupported_content',
                    message: `该地址返回 ${contentType}，不是文本页面，无法内联提取。`,
                };
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            const head = new TextDecoder('utf-8').decode(bytes.slice(0, 2048));
            const charset = sniffCharset(head, contentType);
            const html = decodeBody(bytes, charset);
            const page = extractReadable(html, { maxChars: deps.config.maxFetchChars, charset });
            return {
                available: true,
                url: finalUrl,
                title: page.title,
                text: page.text,
                totalChars: page.totalChars,
                truncated: page.truncated,
                charset: page.charset,
            };
        },
    };
}
