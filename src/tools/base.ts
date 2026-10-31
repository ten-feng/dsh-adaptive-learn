/**
 * Tool plumbing shared by the six learning tools.
 *
 * A tool is described once, host-independent, then registered with the DSH tool
 * registry. `execute` returns only the canonical JSON its `output.schema`
 * declares; degraded business outcomes are values, not exceptions.
 */

export interface ToolParamSpec {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  required?: boolean
  description?: string
  items?: ToolParamSpec
  enum?: readonly string[]
  default?: unknown
}

export type ToolParameters = Record<string, ToolParamSpec>

/** Author-facing value-schema node (the host compiles it to raw JSON Schema). */
export interface JsonSchemaNode {
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  properties?: Record<string, JsonSchemaNode>
  items?: JsonSchemaNode
  additionalProperties?: boolean
  /** Author-facing requiredness annotation (never a JSON-Schema array here). */
  required?: boolean
  description?: string
  enum?: readonly string[]
}

export interface ToolTextBlock {
  type: 'text'
  text: string
}

export interface ToolOutput {
  schema: JsonSchemaNode
  render?: (value: unknown) => ToolTextBlock[]
}

export interface SessionLike {
  id?: string
  /** The session's workspace directory, when the host exposes it directly. */
  cwd?: string
  /** The durable header; DSH stores the creation cwd there. */
  header?: { cwd?: string }
  meta?: { cwd?: string }
}

export interface ToolRunContextLike {
  signal?: AbortSignal
  /** The agent on whose behalf the call runs (set by the host loop). */
  agent?: { session?: SessionLike }
}

export interface LearnTool {
  name: string
  description: string
  parameters: ToolParameters
  output: ToolOutput
  execute(args: Record<string, unknown>, exec?: ToolRunContextLike): Promise<unknown>
}

/** Invalid model arguments: an infrastructure-level contract failure. */
export class ToolArgsError extends Error {
  readonly violations: string[]
  constructor(violations: string[]) {
    super(`工具参数不合法：${violations.join('；')}`)
    this.name = 'ToolArgsError'
    this.violations = violations
  }
}

function typeMatches(type: ToolParamSpec['type'], value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    default:
      return false
  }
}

/**
 * Validate model arguments against a parameter map.
 * @throws ToolArgsError with one violation per offending field.
 */
export function assertArgs(parameters: ToolParameters, args: unknown): Record<string, unknown> {
  const violations: string[] = []
  const record = (args ?? {}) as Record<string, unknown>
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new ToolArgsError(['arguments 必须是对象'])
  }
  for (const [key, spec] of Object.entries(parameters)) {
    const value = record[key]
    if (value === undefined || value === null || value === '') {
      if (spec.required) violations.push(`缺少必填参数 ${key}`)
      continue
    }
    if (!typeMatches(spec.type, value)) {
      violations.push(`参数 ${key} 应为 ${spec.type}`)
      continue
    }
    if (spec.enum && typeof value === 'string' && !spec.enum.includes(value)) {
      violations.push(`参数 ${key} 只能是 ${spec.enum.join('/')}`)
    }
  }
  if (violations.length > 0) throw new ToolArgsError(violations)
  return record
}

/** A model-facing text projection for any canonical value. */
export function jsonRender(value: unknown): ToolTextBlock[] {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

/**
 * Shorthand for an object output schema.
 *
 * The host compiles `output.schema` as an author-facing ValueSchemaSpec, so
 * requiredness is a per-property `required: true` annotation and openness is
 * mandatory — never a JSON-Schema `required: []` array.
 */
export function objectSchema(properties: Record<string, JsonSchemaNode>, required?: string[]): JsonSchemaNode {
  const marked: Record<string, JsonSchemaNode> = {}
  for (const [key, node] of Object.entries(properties)) {
    marked[key] = required?.includes(key) ? { ...node, required: true } : node
  }
  return { type: 'object', properties: marked, additionalProperties: true }
}

/** Everything the six tools share. Optional seams keep the tools testable. */
export interface ToolDeps {
  config: AdaptiveLearnConfig
  /** Fresh-or-cached capability snapshot. */
  capability(): Promise<LocalCapability>
  /**
   * Knowledge store for the calling session's workspace.
   *
   * The root is resolved per call: one process can serve several workspaces,
   * and the profile directory must never become a knowledge base.
   */
  getWiki(session?: SessionLike): WikiStore
  /** Where local model weights live (plugin data dir). */
  modelDir: string
  /** Injected fetch, so tests never touch the network. */
  fetchImpl?: typeof fetch
  ocr?: typeof runLocalOcr
  asr?: typeof runLocalAsr
  now?: () => number
}

import type { AdaptiveLearnConfig } from '../config.js'
import type { LocalCapability } from '../local/capability.js'
import type { runLocalAsr } from '../local/asr.js'
import type { runLocalOcr } from '../local/ocr.js'
import type { WikiStore } from './learn-wiki.js'

