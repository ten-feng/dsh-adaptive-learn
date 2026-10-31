/**
 * `self_learn_fetch` — read one web page into readable text.
 *
 * Node's built-in fetch plus a regex extractor: no DOM dependency, no other
 * plugin involved, and the byte/charset sniffing happens before decoding.
 */
import { decodeBody, extractReadable, sniffCharset } from '../extract.js'
import { jsonRender, objectSchema, type LearnTool, type ToolDeps } from './base.js'

export function createFetchTool(deps: ToolDeps): LearnTool {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  return {
    name: 'self_learn_fetch',
    description:
      '读取一个网页并提取可读正文（自动去脚本/导航/页脚，嗅探 GBK/UTF-8，按上限截断）。只用于本次学习流程。',
    parameters: {
      url: { type: 'string', required: true, description: '要读取的 http(s) 页面地址' },
    },
    output: {
      schema: objectSchema(
        {
          available: { type: 'boolean' },
          url: { type: 'string' },
          title: { type: 'string' },
          text: { type: 'string' },
          totalChars: { type: 'number' },
          truncated: { type: 'boolean' },
          charset: { type: 'string' },
          reason: { type: 'string' },
          message: { type: 'string' },
        },
        ['available', 'url'],
      ),
      render: jsonRender,
    },
    async execute(args) {
      const url = String(args.url)
      if (!/^https?:\/\//i.test(url)) {
        return { available: false, url, reason: 'unsupported_url', message: '只支持 http/https 地址。' }
      }

      let response: Response
      try {
        response = await fetchImpl(url, {
          redirect: 'follow',
          headers: { 'user-agent': 'dsh-adaptive-learn/0.1 (+https://deepseek.com)' },
        })
      } catch (error) {
        return {
          available: false,
          url,
          reason: 'fetch_failed',
          message: `抓取失败：${(error as Error)?.message ?? 'unknown'}`,
        }
      }

      if (!response.ok) {
        return { available: false, url, reason: 'http_error', message: `HTTP ${response.status} ${response.statusText}` }
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (contentType && !/text\/|html|xml|json/i.test(contentType)) {
        return {
          available: false,
          url,
          reason: 'unsupported_content',
          message: `该地址返回 ${contentType}，不是文本页面，无法内联提取。`,
        }
      }

      const bytes = new Uint8Array(await response.arrayBuffer())
      const head = new TextDecoder('utf-8').decode(bytes.slice(0, 2048))
      const charset = sniffCharset(head, contentType)
      const html = decodeBody(bytes, charset)
      const page = extractReadable(html, { maxChars: deps.config.maxFetchChars, charset })

      return {
        available: true,
        url,
        title: page.title,
        text: page.text,
        totalChars: page.totalChars,
        truncated: page.truncated,
        charset: page.charset,
      }
    },
  }
}
