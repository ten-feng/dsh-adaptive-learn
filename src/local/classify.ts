/**
 * Task tiering. Pure functions: no I/O, no model, no network.
 */
import type { LocalCapability } from './capability.js'

export type TaskKind = 'image' | 'audio' | 'video'
export type TaskTier = 'light' | 'heavy'

export interface ClassifyInput {
  kind: TaskKind
  /** Payload size in bytes, when known. */
  sizeBytes?: number
  /** Media duration in seconds, when known. */
  durationSeconds?: number
  /** The user's question about the media, when there is one. */
  question?: string
  /** Channel count reported by the container, when known. */
  channels?: number
  /** Speaker diarisation or transcript alignment can't be done by the light path. */
  needsSpeakerSeparation?: boolean
  /** Probed capability (accepted for symmetry; readiness is the router's job). */
  capability?: LocalCapability | null
  audioLocalMaxMinutes?: number
}

/** Questions that only ask for transcription keep an image on the light path. */
const EXTRACT_ONLY = /(提取|识别|读出|转成文字|文字内容|OCR|ocr|读一下|照着念)/
/** Questions that ask for interpretation force the heavy path. */
const REASONING = /(描述|分析|解释|为什么|怎么操作|如何操作|怎么用|总结|评价|对比|推理|看懂|理解|判断)/
const CLAUSE_SPLIT = /[，。；;,.!?！？\n]/

const AUDIO_LOCAL_MAX_BYTES = 50 * 1024 * 1024

/** Decide whether a task may run on the light (local) path. */
export function classify(input: ClassifyInput): TaskTier {
  if (input.kind === 'video') return 'heavy'

  if (input.kind === 'image') {
    const question = (input.question ?? '').trim()
    if (!question) return 'light'
    if (EXTRACT_ONLY.test(question) && !REASONING.test(question)) return 'light'
    if (REASONING.test(question)) return 'heavy'
    return 'light'
  }

  // Audio
  const maxMinutes = input.audioLocalMaxMinutes ?? 10
  const duration = input.durationSeconds
  if (duration === undefined || !Number.isFinite(duration)) return 'heavy'
  if (duration > maxMinutes * 60) return 'heavy'
  if ((input.sizeBytes ?? 0) > AUDIO_LOCAL_MAX_BYTES) return 'heavy'
  if ((input.channels ?? 1) > 1) return 'heavy'
  if (input.needsSpeakerSeparation) return 'heavy'
  return 'light'
}

/** Cheap structural score of a request; the trigger uses it in auto mode. */
export function structureSignals(text: string): number {
  const clauses = text.split(CLAUSE_SPLIT).filter((part) => part.trim().length > 0)
  const listy = /(^\s*[-*\d]+[.)、]\s)|(\n\s*[-*\d]+[.)、]\s)/m.test(text) || /(步骤|step|首先|然后|最后)/i.test(text)
  return (clauses.length >= 3 ? 1 : 0) + (listy ? 1 : 0)
}

/** Wording that usually means "I don't know this yet". */
const LEARNING_SIGNAL = /(教我|学一下|学习一下|不会|不懂|报错|怎么实现|如何实现|找不到资料|查一下|查查|有没有资料|是什么|为什么不行)/i
/** Negation of the learning intent ("别查了", "不用学"). */
const NEGATION = /(别|不用|先别|不要|无需)(再|去|帮我)?(查|学|搜)/i

export type TriggerAction = 'none' | 'explicit' | 'auto'

export interface TriggerInput {
  text: string
  mode: 'auto' | 'explicit' | 'both'
  explicitPrefixes: string[]
  threshold: number
  cooldownMs: number
  lastInjectedAt?: number
  now?: number
}

export interface TriggerDecision {
  action: TriggerAction
  /** Text with an explicit prefix stripped. */
  text: string
  score: number
  /** Set when the explicit prefix fired. */
  prefix?: string
}

/** Score one user request for a knowledge gap. Pure: no model, no network. */
export function scoreRequest(text: string): number {
  let score = 0
  if (LEARNING_SIGNAL.test(text)) score += 2
  if (NEGATION.test(text)) score -= 2
  score += structureSignals(text)
  return Math.max(0, score)
}

/**
 * Decide whether the self-learning protocol should be injected for one message.
 *
 * Exactly two entry points: an explicit command prefix, or the text score.
 * Attachments never decide anything — a picture or a voice clip is content the
 * model can look at anyway, not a trigger.
 */
export function decideTrigger(input: TriggerInput): TriggerDecision {
  const now = input.now ?? Date.now()
  const text = input.text ?? ''

  if (input.mode !== 'auto') {
    const prefix = input.explicitPrefixes.find((item) => item && text.trimStart().startsWith(item))
    if (prefix) {
      const stripped = text.trimStart().slice(prefix.length).replace(/^\s*[:：]?\s*/, '')
      return { action: 'explicit', text: stripped.length > 0 ? stripped : text, score: 0, prefix }
    }
  }

  if (input.mode === 'explicit') {
    return { action: 'none', text, score: 0 }
  }

  const score = scoreRequest(text)
  if (score < input.threshold) return { action: 'none', text, score }
  if (input.lastInjectedAt !== undefined && now - input.lastInjectedAt < input.cooldownMs) {
    return { action: 'none', text, score }
  }
  return { action: 'auto', text, score }
}
