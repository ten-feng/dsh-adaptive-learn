/**
 * `self_learn_vision` — read one image or video.
 *
 * The route is decided inside the tool: light screenshots go to a local OCR
 * engine when the host can run one, everything else to the configured
 * OpenAI-compatible vision endpoint. A missing key becomes an actionable value
 * (`vision_api_key_missing` + `freeOptions`), never a guess about the content.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { classify } from '../local/classify.js'
import { routeTask, shouldFallbackToCloud } from '../local/router.js'
import { runLocalOcr, type OcrBlock } from '../local/ocr.js'
import { postJson } from '../http.js'
import { jsonRender, objectSchema, type LearnTool, type ToolDeps } from './base.js'

const FREE_VISION_OPTIONS = [
  'AMD Radeon 开发者云（本插件默认 visionBaseUrl，注册后有免费额度）',
  '阿里云百炼（通义千问 VL 系列，新用户免费额度）',
  '硅基流动 SiliconFlow（多种开源 VLM，注册送额度）',
]

const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi|m4v|flv)(\?|#|$)/i

export function createVisionTool(deps: ToolDeps): LearnTool {
  return {
    name: 'self_learn_vision',
    description:
      '理解一张图片或一段视频。内部自动选择本地 OCR 或云端视觉模型：纯文字截图/票据优先本地，复杂图表与视频走云端。',
    parameters: {
      source: { type: 'string', required: true, description: '图片/视频 URL，或本地文件路径' },
      sourceType: { type: 'string', enum: ['url', 'path', 'base64'], description: 'source 的类型，默认 url' },
      question: { type: 'string', description: '你想从这张图里得到什么；只写“提取文字”会走本地' },
    },
    output: {
      schema: objectSchema(
        {
          available: { type: 'boolean' },
          route: { type: 'string' },
          engine: { type: 'string' },
          tier: { type: 'string' },
          text: { type: 'string' },
          blocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
          model: { type: 'string' },
          reason: { type: 'string' },
          message: { type: 'string' },
          userActionRequired: { type: 'string' },
          freeOptions: { type: 'array', items: { type: 'string' } },
        },
        ['available'],
      ),
      render: jsonRender,
    },
    async execute(args, exec) {
      const source = String(args.source)
      const sourceType = (args.sourceType as string | undefined) ?? (/^https?:\/\//i.test(source) ? 'url' : 'path')
      const question = args.question === undefined ? undefined : String(args.question)
      const kind = VIDEO_EXT.test(source) ? 'video' : 'image'
      const tier = classify({ kind, question })

      // A local path that does not exist is a caller mistake, not a key problem:
      // report it before asking anyone for credentials.
      if (sourceType === 'path' && !/^https?:\/\//i.test(source) && !existsSync(source)) {
        return {
          available: false,
          route: 'unavailable',
          tier,
          reason: 'source_unreadable',
          message: `本地文件不存在或不可读：${source}`,
        }
      }

      const capability = await deps.capability()
      const decision = routeTask({
        kind,
        tier,
        policy: deps.config.routePolicy,
        capability,
        localEnabled: deps.config.localEnabled,
        hasCloudKey: Boolean(deps.config.visionApiKey),
        localOcrEngine: deps.config.localOcrEngine,
      })

      const routeInput = {
        kind,
        tier,
        policy: deps.config.routePolicy,
        capability,
        localEnabled: deps.config.localEnabled,
        hasCloudKey: Boolean(deps.config.visionApiKey),
      } as const

      let localFailure: string | undefined

      if (decision.route === 'unavailable') {
        return {
          available: false,
          route: 'unavailable',
          tier,
          reason: 'no_engine_available',
          message: decision.reason,
          userActionRequired: decision.userActionRequired,
          freeOptions: FREE_VISION_OPTIONS,
        }
      }

      if (decision.route === 'local') {
        if (kind === 'video') {
          // Videos are always heavy; reaching here means a misconfiguration.
          return { available: false, route: 'unavailable', tier, reason: 'video_local_unsupported', message: '视频不本地处理。' }
        }
        const local = await (deps.ocr ?? runLocalOcr)({
          source,
          sourceType: sourceType as 'url' | 'path' | 'base64',
          modelDir: deps.modelDir,
          engine: deps.config.localOcrEngine,
        })
        if (local.available) {
          return {
            available: true,
            route: 'local',
            engine: local.engine,
            tier,
            text: local.text,
            blocks: local.blocks as OcrBlock[],
          }
        }
        if (!shouldFallbackToCloud(routeInput, local.reason)) {
          return {
            available: false,
            route: 'local',
            engine: deps.config.localOcrEngine,
            tier,
            reason: local.reason,
            message: local.message,
            userActionRequired: `本地 OCR 不可用（${local.message}），且未配置云端视觉密钥。`,
            freeOptions: FREE_VISION_OPTIONS,
          }
        }
        localFailure = `本地 ${local.reason}：${local.message}`
        // fall through to cloud
      }

      if (!deps.config.visionApiKey) {
        return {
          available: false,
          route: 'cloud',
          tier,
          reason: 'vision_api_key_missing',
          message: '需要云端视觉模型，但插件里还没有填写密钥。',
          userActionRequired:
            '请到「设置 → 插件 → dsh-adaptive-learn」填写 visionApiKey（OpenAI 兼容的视觉接口密钥），或提供可本地处理的内容。',
          freeOptions: FREE_VISION_OPTIONS,
        }
      }

      const content: Record<string, unknown>[] = []
      if (question) content.push({ type: 'text', text: question })

      // Cloud providers take a URL or an inline data URI — never a Windows path.
      let mediaUrl = source
      if (!/^https?:\/\//i.test(source) && !source.startsWith('data:')) {
        if (kind === 'video') {
          return {
            available: false,
            route: 'cloud',
            tier,
            reason: 'video_source_requires_url',
            message: '本地视频不能直接上传到云端视觉接口。请改用视频 URL，或抽取几帧关键画面作为图片发来。',
          }
        }
        if (!deps.config.visionApiKey) {
          // Unreachable in practice (checked above), kept as a defensive guard.
          return {
            available: false,
            route: 'cloud',
            tier,
            reason: 'vision_api_key_missing',
            message: '需要云端视觉模型，但插件里还没有填写密钥。',
            userActionRequired:
              '请到「设置 → 插件 → dsh-adaptive-learn」填写 visionApiKey（OpenAI 兼容的视觉接口密钥），或提供可本地处理的内容。',
            freeOptions: FREE_VISION_OPTIONS,
          }
        }
        const bytes = await readFile(source)
        if (bytes.byteLength > 20 * 1024 * 1024) {
          return {
            available: false,
            route: 'cloud',
            tier,
            reason: 'source_too_large',
            message: `本地图片 ${Math.round(bytes.byteLength / 1024 / 1024)}MB，超过云端内联上限 20MB，请改用图片 URL。`,
          }
        }
        const mime = /\.png$/i.test(source) ? 'image/png' : /\.webp$/i.test(source) ? 'image/webp' : 'image/jpeg'
        mediaUrl = `data:${mime};base64,${bytes.toString('base64')}`
      }
      content.push({ type: 'image_url', image_url: { url: mediaUrl } })

      const result = await postJson<{ choices?: { message?: { content?: string } }[] }>(
        `${deps.config.visionBaseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          model: deps.config.visionModel,
          messages: [{ role: 'user', content }],
          max_tokens: 1024,
        },
        { apiKey: deps.config.visionApiKey, fetchImpl: deps.fetchImpl, timeoutMs: 120_000 },
      )

      if (!result.ok) {
        return {
          available: false,
          route: 'unavailable',
          tier,
          reason: localFailure ? 'all_engines_failed' : 'vision_api_error',
          message: [localFailure, `云端失败：${result.error.message}`].filter(Boolean).join('；'),
          userActionRequired: localFailure
            ? `本地 OCR 与云端视觉都失败了。可以检查 visionApiKey/visionBaseUrl，或稍后重试。`
            : undefined,
        }
      }
      const text = result.data.choices?.[0]?.message?.content ?? ''
      void exec
      return {
        available: true,
        route: 'cloud',
        engine: `cloud:${deps.config.visionModel}`,
        model: deps.config.visionModel,
        tier,
        text,
      }
    },
  }
}
