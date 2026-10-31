/**
 * dsh-adaptive-learn — the adaptive learning loop as one self-contained plugin.
 *
 * Detect the host's real capability → tier the task → run light work locally and
 * heavy work in the cloud → write the conclusion into a two-tier knowledge base
 * → reuse it in the original task → promote it once it is confirmed.
 *
 * No other DSH plugin is called: web, vision and audio access all go through
 * this package's own fetch/extraction logic.
 */
import { homedir } from 'node:os'
import { isAbsolute, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { Config, resolveConfig, type AdaptiveLearnConfig } from './config.js'
import { CapabilityCache, type LocalCapability } from './local/capability.js'
import { decideTrigger, type TriggerAction, type TriggerDecision } from './local/classify.js'
import { assertArgs, jsonRender, type LearnTool, type SessionLike, type ToolDeps } from './tools/base.js'
import { createAudioTool } from './tools/learn-audio.js'
import { createFetchTool } from './tools/learn-fetch.js'
import { createVisionTool } from './tools/learn-vision.js'
import { WikiStore, createWikiTools } from './tools/learn-wiki.js'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'adaptive-learn'

/** Tools are the only hard dependency; everything else is read opportunistically. */
export const inject = ['tools']

export { Config }
export type { AdaptiveLearnConfig }

export interface PluginContext {
  tools: { register(definition: unknown): unknown }
  on?: (event: string, listener: (...args: unknown[]) => unknown) => unknown
  effect?: (install: () => unknown, label?: string) => unknown
  /** Cordis service injection, used only for the optional `skills` service. */
  inject?: (dependencies: string[], callback: (scope: Record<string, unknown>) => void) => unknown
  logger?: { info?: (message: string) => void; warn?: (message: string) => void }
  dataDir?: string
  workspace?: { root?: string }
  cwd?: string
  [key: string]: unknown
}

export interface LearnServices {
  config: AdaptiveLearnConfig
  capability: CapabilityCache
  wiki: WikiStore
  modelDir: string
}

const PROTOCOL = `[自适应学习协议]
这个请求可能需要你现在不知道的资料。请按顺序执行，不要凭记忆回答可变事实：
1. 先调用 self_learn_wiki_recall 查已有知识，命中就直接使用。
2. 不够就调用 self_learn_fetch 读网页；只引用你真正打开过的链接。
3. 图片/视频用 self_learn_vision，音频用 self_learn_audio（内部自动选本地或云端，不要预设）。
4. 如果工具返回 vision_api_key_missing / audio_api_key_missing，把 userActionRequired 和 freeOptions 原样转述给用户，不要猜测内容。
5. 把结论和来源用 self_learn_wiki_stage 写进 staged 草稿。
6. 继续完成原任务；确认有效后再调用 self_learn_wiki_commit 升入正式知识库；不通就回到第 2 步，最多 3 轮。
硬性禁止：凭记忆编造可变事实、引用没打开过的链接、查完不写、把本地路径当成已读取的证据、密钥缺失时猜测内容、本地推理失败时假装成功。`

const AUTO_HINT = `[自适应学习] 检测到知识缺口，请进入自学流程：先用 self_learn_wiki_recall 查知识库，再按需 self_learn_fetch / self_learn_vision / self_learn_audio，把结论与来源 self_learn_wiki_stage，然后继续原任务。`

/** Resolve the workspace root without depending on any other plugin. */
export function resolveWorkspaceRoot(ctx: PluginContext): string {
  // Cordis proxies property access and throws for undeclared services, so every
  // optimistic read is guarded: this plugin must load with nothing but `tools`.
  try {
    const root = ctx.workspace?.root
    if (typeof root === 'string' && isAbsolute(root)) return root
  } catch {
    // not injected — fall through
  }
  try {
    const cwd = ctx.cwd
    if (typeof cwd === 'string' && isAbsolute(cwd)) return cwd
  } catch {
    // not injected — fall through
  }
  const fromEnv = process.env.DSH_WORKSPACE
  if (fromEnv && isAbsolute(fromEnv)) return fromEnv
  return process.cwd()
}

/** Resolve the plugin data directory (capability cache, local weights). */
export function resolveDataDir(ctx: PluginContext): string {
  const override = process.env.DSH_ADAPTIVE_DATA_DIR
  if (override) return override
  try {
    const dir = ctx.dataDir
    if (typeof dir === 'string' && dir.length > 0) return dir
  } catch {
    // not injected — fall through
  }
  return join(homedir(), '.dsh', 'adaptive-learn')
}

/** Build the six tools for one runtime. */
export function createLearnTools(deps: ToolDeps): LearnTool[] {
  return [
    createFetchTool(deps),
    createVisionTool(deps),
    createAudioTool(deps),
    ...(createWikiTools({
      getWiki: (session?: SessionLike) => deps.getWiki(session),
      requireSource: deps.config.wikiCommitRequiresSource,
    }) as unknown as LearnTool[]),
  ]
}

/**
 * Resolve the knowledge base root for one session.
 *
 * The session's own cwd wins: one process can serve several workspaces, and the
 * profile directory must never become a knowledge base. Then the workspace
 * registry (session → workspace path), then the environment, then cwd.
 */
export function resolveKnowledgeRoot(
  ctx: PluginContext,
  config: AdaptiveLearnConfig,
  session?: SessionLike,
): string {
  if (isAbsolute(config.knowledgeDir)) return config.knowledgeDir

  const sessionCwd = session?.cwd ?? session?.header?.cwd ?? session?.meta?.cwd
  if (sessionCwd && isAbsolute(sessionCwd)) return join(sessionCwd, config.knowledgeDir)

  const registry = readService(ctx, 'workspaceRegistry') as
    | {
        state?: {
          global?: { defaultWorkspaceId?: string }
          tables?: { workspaces?: Record<string, { path?: string; sessionIds?: string[] }> }
        }
      }
    | undefined
  const workspaces = registry?.state?.tables?.workspaces
  if (workspaces) {
    const sessionId = session?.id
    if (sessionId) {
      for (const workspace of Object.values(workspaces)) {
        if (workspace?.sessionIds?.includes(sessionId) && workspace.path) {
          return join(workspace.path, config.knowledgeDir)
        }
      }
    }
    const fallbackId = registry?.state?.global?.defaultWorkspaceId
    const fallback = fallbackId ? workspaces[fallbackId]?.path : undefined
    if (fallback) return join(fallback, config.knowledgeDir)
  }

  const fromEnv = process.env.DSH_WORKSPACE
  if (fromEnv && isAbsolute(fromEnv)) return join(fromEnv, config.knowledgeDir)
  return join(resolveWorkspaceRoot(ctx), config.knowledgeDir)
}

/** Read a service without declaring it as a hard dependency. */
function readService(ctx: PluginContext, name: string): unknown {
  try {
    const getter = (ctx as { get?: (service: string) => unknown }).get
    if (typeof getter === 'function') return getter.call(ctx, name)
  } catch {
    // service absent — not an error for an optional dependency
  }
  return undefined
}

function runtimeConfig(config: Partial<AdaptiveLearnConfig> | undefined): AdaptiveLearnConfig {
  return resolveConfig(config)
}

/** Text of one user message, for prefix stripping and scoring. */
export function messageText(message: unknown): string {
  const content = (message as { content?: unknown })?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: string; text: string } => (block as { type?: string })?.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

/** Append the protocol text to one message without mutating the frozen original. */
export function withInjectedText(message: unknown, text: string, options: { replaceText?: string } = {}): unknown {
  const record = message as { content?: unknown }
  const content = record?.content
  const blocks = Array.isArray(content) ? content : [{ type: 'text', text: '' }]
  const next = blocks.map((block) => {
    if (options.replaceText === undefined) return block
    const candidate = block as { type?: string; text?: string }
    if (candidate.type !== 'text' || candidate.text !== options.replaceText) return block
    return { ...candidate, text: '' }
  })
  next.push({ type: 'text', text })
  const filtered = next.filter((block) => {
    const candidate = block as { type?: string; text?: string }
    return !(candidate.type === 'text' && candidate.text === '')
  })
  return { ...(record as Record<string, unknown>), content: filtered }
}

export interface PreStepPayload {
  messages?: unknown[]
  agent?: { id?: string }
  turn?: number
  step?: number
}

/** Pure(ish) trigger evaluation for one pre-step batch; returns the actions taken. */
export function evaluatePreStep(
  messages: unknown[],
  config: AdaptiveLearnConfig,
  state: { lastInjectedAt?: number; now?: number },
): { injected: TriggerAction; rewritten: unknown[]; decision: TriggerDecision | null } {
  const userMessages = messages.filter(
    (message) => ((message as { source?: { kind?: string } })?.source?.kind ?? 'user') === 'user',
  )
  if (userMessages.length === 0) return { injected: 'none', rewritten: messages, decision: null }

  const first = userMessages[0]
  const original = messageText(first)
  const decision = decideTrigger({
    text: original,
    mode: config.triggerMode,
    explicitPrefixes: config.explicitPrefixes,
    threshold: config.autoScoreThreshold,
    cooldownMs: config.autoCooldownMinutes * 60_000,
    lastInjectedAt: state.lastInjectedAt,
    now: state.now,
  })
  if (decision.action === 'none') return { injected: 'none', rewritten: messages, decision }

  if (decision.action === 'explicit') {
    const rewritten = messages.map((message) =>
      message === first ? withInjectedText(message, PROTOCOL, { replaceText: original }) : message,
    )
    return { injected: decision.action, rewritten, decision }
  }

  const rewritten = messages.map((message) => (message === first ? withInjectedText(message, AUTO_HINT) : message))
  return { injected: decision.action, rewritten, decision }
}

/** What `apply()` hands back to the host (diagnostics and future settings hooks). */
export interface LearnRuntime {
  config: AdaptiveLearnConfig
  /** Knowledge store for a session's workspace. */
  getWiki(session?: SessionLike): WikiStore
  /** Force a fresh probe now (diagnostics; tools already probe on every call). */
  probeCapability(): Promise<LocalCapability>
  /** Cached capability without forcing a probe. */
  getCapability(): Promise<LocalCapability>
}

/** Absolute path of the shipped skill document (resolved from lib/index.js). */
export function skillFilePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'skill', 'SKILL.md')
}

export interface SkillDocument {
  name: string
  description: string
  body: string
  path: string
}

/** Split `---` front-matter from the markdown body. */
export function parseSkillDocument(raw: string, path: string): SkillDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) return { name: 'adaptive-learn', description: '', body: raw, path }
  const front = match[1] ?? ''
  const description = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? ''
  const name = /^name:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? 'adaptive-learn'
  return { name, description, body: match[2] ?? '', path }
}

/** Build the provider object the host's skill catalogue consumes. */
export function createSkillProvider(document: SkillDocument) {
  const entry = (content?: string) => ({
    name: document.name,
    description: document.description,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    provider: 'dsh-adaptive-learn',
    path: document.path,
    resourceBase: { kind: 'directory', path: dirname(document.path) },
    rank: 600,
    locator: document.path,
    ...(content === undefined ? {} : { content }),
  })
  return {
    name: 'dsh-adaptive-learn',
    list: () => Promise.resolve([entry()]),
    get: () => Promise.resolve(entry(document.body)),
  }
}

/**
 * Register SKILL.md with the host skill catalogue, when that service exists.
 *
 * `registerProvider` takes a provider FACTORY (as dsh-music does), not a ready
 * object — passing the object silently registers nothing.
 */
export function installSkill(ctx: PluginContext, file = skillFilePath()): void {
  if (typeof ctx.inject !== 'function') return
  try {
    const document = parseSkillDocument(readFileSync(file, 'utf8'), file)
    ctx.inject(['skills'], (scope) => {
      try {
        const skills = scope.skills as {
          registerProvider?: (factory: () => unknown) => unknown
        } | undefined
        if (!skills?.registerProvider) return
        skills.registerProvider(() => createSkillProvider(document))
      } catch {
        // A malformed provider must not take the plugin down.
      }
    })
  } catch {
    // A missing skill service or unreadable file must never fail the plugin.
  }
}

/** Cordis plugin entry point. */
export function apply(
  ctx: PluginContext,
  rawConfig?: Partial<AdaptiveLearnConfig>,
  overrides?: Partial<ToolDeps>,
): LearnRuntime {
  const config = runtimeConfig(rawConfig)
  const dataDir = resolveDataDir(ctx)

  const cache = new CapabilityCache({ file: join(dataDir, 'capability.json') })

  // One store per resolved root: a process may serve several workspaces.
  const wikiStores = new Map<string, WikiStore>()
  const getWiki = (session?: SessionLike): WikiStore => {
    const root = resolveKnowledgeRoot(ctx, config, session)
    let store = wikiStores.get(root)
    if (!store) {
      store = new WikiStore(root, { requireSource: config.wikiCommitRequiresSource })
      wikiStores.set(root, store)
    }
    return store
  }

  const deps: ToolDeps = {
    config,
    capability: () => cache.get(),
    getWiki,
    modelDir: join(dataDir, 'models'),
    ...overrides,
  }

  const register = (tool: LearnTool) => {
    const definition = defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      output: {
        schema: tool.output.schema,
        render: (_args: unknown, value: unknown) => (tool.output.render ? tool.output.render(value) : jsonRender(value)),
      },
      execute: async (args: unknown, exec: unknown) => {
        const parsed = assertArgs(tool.parameters, args)
        return tool.execute(parsed, exec as { signal?: AbortSignal; agent?: { session?: { id?: string } } })
      },
    })
    ctx.tools.register(definition)
  }

  for (const tool of createLearnTools(deps)) register(tool)
  installTrigger(ctx, config)
  installSkill(ctx)

  const runtime: LearnRuntime = {
    config,
    getWiki,
    probeCapability: () => cache.probe(true),
    getCapability: () => cache.get(),
  }
  // Best effort: a frozen host context simply keeps the runtime in the return value.
  try {
    ;(ctx as Record<string, unknown>).adaptiveLearn = runtime
  } catch {
    // ignore
  }
  return runtime
}

const lastInjected = new Map<string, number>()

/** Re-apply one trigger decision to the batch the downstream waterfall returned. */
export function applyDecision(messages: unknown[], decision: TriggerDecision): unknown[] {
  const index = messages.findIndex(
    (message) => ((message as { source?: { kind?: string } })?.source?.kind ?? 'user') === 'user',
  )
  if (index < 0) return messages
  const target = messages[index]
  if (decision.action === 'explicit') {
    return messages.map((message, position) =>
      position === index ? withInjectedText(message, PROTOCOL, { replaceText: messageText(target) }) : message,
    )
  }
  return messages.map((message, position) => (position === index ? withInjectedText(message, AUTO_HINT) : message))
}

/** Register the `agent/pre-step` trigger. Zero interference when nothing fires. */
export function installTrigger(ctx: PluginContext, config: AdaptiveLearnConfig): void {
  if (typeof ctx.on !== 'function') return
  const listener = async (
    payload: PreStepPayload,
    next: () => Promise<{ kind: 'enter'; messages: unknown[] } | { kind: 'reject' }>,
  ) => {
    const key = String(payload?.agent?.id ?? 'default')
    try {
      const decision = evaluatePreStep(payload?.messages ?? [], config, {
        now: Date.now(),
        lastInjectedAt: lastInjected.get(key),
      }).decision
      if (!decision || decision.action === 'none') return next()
      const downstream = await next()
      if (downstream?.kind !== 'enter' || !Array.isArray(downstream.messages)) return downstream
      lastInjected.set(key, Date.now())
      return { kind: 'enter', messages: applyDecision(downstream.messages, decision) }
    } catch (error) {
      try {
        ctx.logger?.warn?.(`dsh-adaptive-learn: pre-step 触发失败，已跳过：${(error as Error)?.message ?? 'unknown'}`)
      } catch {
        // logging is optional
      }
      return next()
    }
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => (ctx.on as (event: string, fn: unknown) => unknown)('agent/pre-step', listener as unknown as (...args: unknown[]) => unknown),
      'dsh-adaptive-learn: pre-step',
    )
  } else {
    (ctx.on as (event: string, fn: unknown) => unknown)('agent/pre-step', listener as unknown as (...args: unknown[]) => unknown)
  }
}

export default { name, inject, apply, Config }
