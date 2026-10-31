/**
 * Local OCR.
 *
 * The engine is resolved at runtime, never assumed:
 *  1. `node-llama-cpp` + a HunyuanOCR GGUF (primary),
 *  2. `ppu-paddle-ocr` (fallback).
 *
 * Every "can't do it here" outcome is a structured value, so the caller can
 * fall back to the cloud instead of failing the tool call.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface OcrBlock {
  text: string
  box?: [number, number, number, number]
  confidence?: number
}

export type OcrOutcome =
  | { available: true; engine: 'local-hunyuanocr' | 'local-paddleocr'; text: string; blocks: OcrBlock[] }
  | {
      available: false
      reason: 'engine_missing' | 'model_missing' | 'model_downloading' | 'failed' | 'unsupported_source'
      message: string
      progress?: number
    }

export type OcrEngineChoice = 'auto' | 'hunyuanocr' | 'paddleocr'

export interface OcrInput {
  /** Local image path or a data URL. */
  source: string
  sourceType?: 'url' | 'path' | 'base64'
  /** Directory where GGUF/ONNX weights are cached. */
  modelDir: string
  engine?: OcrEngineChoice
  /** Allow the first-run weight download to proceed. */
  allowDownload?: boolean
  /** Test seam: override the llama.cpp worker. */
  runLlama?: (input: {
    source: string
    sourceType?: OcrInput['sourceType']
    modelPath: string
    mmprojPath?: string | null
    modelDir?: string
  }) => Promise<{ text: string; blocks?: OcrBlock[] }>
  /** Test seam: override the paddle worker. */
  runPaddle?: (input: { source: string; sourceType?: OcrInput['sourceType']; modelDir?: string }) => Promise<{
    text: string
    blocks?: OcrBlock[]
  }>
}

const HUNYUAN_HINT = 'hunyuanocr'

export interface HunyuanFiles {
  /** Main GGUF weights. */
  model: string
  /** Vision projector (mmproj) next to the weights. */
  mmproj: string | null
}

/** Find HunyuanOCR weights (and their mmproj) under `modelDir`. */
export async function findHunyuanFiles(modelDir: string): Promise<HunyuanFiles | null> {
  const override = process.env.DSH_ADAPTIVE_OCR_MODEL
  if (override && existsSync(override)) {
    const dir = override.slice(0, Math.max(override.lastIndexOf('\\'), override.lastIndexOf('/')))
    const mmproj = (await readdir(dir).catch(() => [] as string[])).find((file) => /mmproj/i.test(file))
    return { model: override, mmproj: mmproj ? join(dir, mmproj) : null }
  }
  try {
    const entries = await readdir(modelDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.toLowerCase().includes(HUNYUAN_HINT)) continue
      const dir = join(modelDir, entry.name)
      const files = await readdir(dir).catch(() => [] as string[])
      const model = files.find((file) => file.toLowerCase().endsWith('.gguf') && !/mmproj|projector/i.test(file))
      if (!model) continue
      const mmproj = files.find((file) => /mmproj|projector/i.test(file) && file.toLowerCase().endsWith('.gguf'))
      return { model: join(dir, model), mmproj: mmproj ? join(dir, mmproj) : null }
    }
  } catch {
    return null
  }
  return null
}

/** Backwards-compatible helper: just the weights path. */
export async function findHunyuanModel(modelDir: string): Promise<string | null> {
  return (await findHunyuanFiles(modelDir))?.model ?? null
}

/** Locate `llama-mtmd-cli`, the llama.cpp multimodal runner used for HunyuanOCR. */
export async function findLlamaMtmd(modelDir: string): Promise<string | null> {
  const override = process.env.DSH_ADAPTIVE_LLAMA_MTMD
  if (override && existsSync(override)) return override
  const roots = [join(modelDir, 'llamacpp'), join(modelDir, '..', 'llamacpp'), modelDir]
  for (const root of roots) {
    for (const name of ['llama-mtmd-cli.exe', 'llama-mtmd-cli', 'llama-mtmd.exe']) {
      const candidate = join(root, name)
      if (existsSync(candidate)) return candidate
    }
    // Release archives unpack into a nested folder (llama-bXXXX-bin-...).
    try {
      const children = await readdir(root, { withFileTypes: true }).catch(() => [])
      for (const child of children) {
        if (!child.isDirectory()) continue
        const candidate = join(root, child.name, 'llama-mtmd-cli.exe')
        if (existsSync(candidate)) return candidate
      }
    } catch {
      // keep looking
    }
  }
  return null
}


/** Locate the three PP-OCR model files under `<modelDir>/paddleocr/`. */
export async function findPaddleModels(modelDir: string): Promise<{
  detection: string
  recognition: string
  charactersDictionary: string
} | null> {
  const roots = [join(modelDir, 'paddleocr'), modelDir]
  for (const root of roots) {
    try {
      const files = await readdir(root).catch(() => [] as string[])
      const find = (pattern: RegExp) => files.find((file) => pattern.test(file))
      const detection = find(/det.*\.onnx$/i)
      const recognition = find(/rec.*\.onnx$/i)
      const dict = find(/dict.*\.txt$/i)
      if (detection && recognition && dict) {
        return {
          detection: join(root, detection),
          recognition: join(root, recognition),
          charactersDictionary: join(root, dict),
        }
      }
    } catch {
      // try the next root
    }
  }
  const override = process.env.DSH_ADAPTIVE_PADDLE_MODEL_DIR
  if (override) {
    try {
      const files = await readdir(override)
      const detection = files.find((file) => /det.*\.onnx$/i.test(file))
      const recognition = files.find((file) => /rec.*\.onnx$/i.test(file))
      const dict = files.find((file) => /dict.*\.txt$/i.test(file))
      if (detection && recognition && dict) {
        return {
          detection: join(override, detection),
          recognition: join(override, recognition),
          charactersDictionary: join(override, dict),
        }
      }
    } catch {
      return null
    }
  }
  return null
}

/** Read the image as bytes; the onnx pipeline takes ArrayBuffer, not a data URI. */
async function loadImageBytes(source: string, sourceType: OcrInput['sourceType']): Promise<ArrayBuffer> {
  if (sourceType === 'base64' || source.startsWith('data:')) {
    const base64 = source.replace(/^data:[^,]*,/, '')
    return new Uint8Array(Buffer.from(base64, 'base64')).buffer as ArrayBuffer
  }
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`下载图片失败：HTTP ${response.status}`)
    return await response.arrayBuffer()
  }
  const bytes = await readFile(source)
  return new Uint8Array(bytes).buffer as ArrayBuffer
}

/** Copy any non-path source into a temp file the CLI can open. */
async function materializeImage(source: string, sourceType: OcrInput['sourceType']): Promise<string> {
  if (sourceType === 'base64' || source.startsWith('data:')) {
    const base64 = source.replace(/^data:[^,]*,/, '')
    const dir = await mkdtemp(join(tmpdir(), 'dsh-learn-ocr-'))
    const target = join(dir, 'input.png')
    await writeFile(target, Buffer.from(base64, 'base64'))
    return target
  }
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`下载图片失败：HTTP ${response.status}`)
    const dir = await mkdtemp(join(tmpdir(), 'dsh-learn-ocr-'))
    const target = join(dir, 'input.png')
    await writeFile(target, Buffer.from(await response.arrayBuffer()))
    return target
  }
  return source
}

function execFileAsync(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr: String(stderr ?? '') }))
        return
      }
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

/**
 * HunyuanOCR through `llama-mtmd-cli` (llama.cpp's multimodal runner).
 *
 * node-llama-cpp has no vision/mmproj surface, so the GGUF is run by the
 * llama.cpp CLI when it is present. Missing CLI/weights are a structured
 * "unavailable", never a crash.
 */
async function runLlamaOcr(input: {
  source: string
  sourceType?: OcrInput['sourceType']
  modelPath: string
  mmprojPath?: string | null
  binary?: string | null
  modelDir?: string
}): Promise<{ text: string; blocks?: OcrBlock[] }> {
  const binary = input.binary ?? (await findLlamaMtmd(input.modelDir ?? '.'))
  if (!binary) throw new Error('未找到 llama-mtmd-cli（llama.cpp 多模态命令行），无法运行 HunyuanOCR GGUF')
  if (!input.mmprojPath) throw new Error('HunyuanOCR 缺少 mmproj 视觉投影文件')

  const imagePath = await materializeImage(input.source, input.sourceType)
  const prompt = process.env.DSH_ADAPTIVE_OCR_PROMPT ?? '提取图片中的所有文字，按行输出，不要解释。'
  const args = [
    '-m',
    input.modelPath,
    '--mmproj',
    input.mmprojPath,
    '--image',
    imagePath,
    '-p',
    prompt,
    '--temp',
    '0',
    '-n',
    '1024',
    '-ngl',
    '99',
    '--no-warmup',
  ]

  const { stdout, stderr } = await execFileAsync(binary, args, 180_000)
  const text = cleanMtmdOutput(stdout, prompt) || cleanMtmdOutput(stderr, prompt)
  if (!text) throw new Error('llama-mtmd-cli 没有输出可解析的文本')
  return { text, blocks: [{ text }] }
}

/** Strip llama.cpp logging and the echoed prompt from CLI output. */
export function cleanMtmdOutput(raw: string, prompt: string): string {
  const lines = raw.split(/\r?\n/)
  const kept: string[] = []
  for (const line of lines) {
    if (/^(llama|ggml|mtmd|build|system_info|load|main|clip|encoding|decoding)\b/i.test(line)) continue
    if (/^[\w./:-]+:\d+:\s/.test(line)) continue
    if (/^\s*(<\|im_start\|>|<\|im_end\|>|\/image|\[img\])/i.test(line)) continue
    if (line.trim() === prompt.trim()) continue
    kept.push(line)
  }
  return kept
    .join('\n')
    .replace(/<\|im_end\|>/g, '')
    // The model likes to announce what it is about to do; that is not content.
    .replace(/^\s*(以下是|如下是)?(图片|图中|图像)(中)?的?(文字|文本)[^：:。\n]{0,12}[：:。]?\s*$/gim, '')
    .replace(/^\s*(以下|下面)是[^\n]{0,20}[：:]\s*$/gim, '')
    .replace(/^\s*(assistant|user)\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function runPaddleOcr(input: {
  source: string
  sourceType?: OcrInput['sourceType']
  modelDir?: string
}): Promise<{ text: string; blocks?: OcrBlock[] }> {
  // Imported lazily: the package is optional and only loaded for a local run.
  const paddle = (await import('ppu-paddle-ocr')) as unknown as {
    PaddleOcrService?: new (options?: { model?: unknown; session?: unknown }) => {
      initialize(): Promise<void>
      recognize(image: ArrayBuffer, options?: unknown): Promise<{
        text: string
        lines?: { text?: string; confidence?: number; box?: [number, number, number, number] }[][]
      }>
      destroy(): Promise<void>
    }
  }
  const Service = paddle.PaddleOcrService
  if (!Service) throw new Error('ppu-paddle-ocr 未导出 PaddleOcrService')

  const model = input.modelDir ? await findPaddleModels(input.modelDir) : null
  const service = new Service(model ? { model } : undefined)
  await service.initialize()
  try {
    const bytes = await loadImageBytes(input.source, input.sourceType)
    const result = await service.recognize(bytes)
    const lines = (result.lines ?? []).flat()
    const blocks: OcrBlock[] = lines.map((item) => ({
      text: String(item.text ?? ''),
      confidence: item.confidence,
      box: item.box,
    }))
    return { text: String(result.text ?? '').trim(), blocks }
  } finally {
    await service.destroy().catch(() => undefined)
  }
}

/** Run local OCR, returning a structured outcome instead of throwing. */
export async function runLocalOcr(input: OcrInput): Promise<OcrOutcome> {
  const engine = input.engine ?? 'auto'

  if (engine === 'auto' || engine === 'hunyuanocr') {
    const files = await findHunyuanFiles(input.modelDir)
    if (!files) {
      if (engine === 'hunyuanocr') {
        return {
          available: false,
          reason: 'model_downloading',
          progress: 0,
          message: '本地 HunyuanOCR 权重尚未下载，首次使用会下载数百 MB，缓存后续可离线使用。',
        }
      }
    } else {
      try {
        const runner = input.runLlama ?? runLlamaOcr
        const result = await runner({
          source: input.source,
          sourceType: input.sourceType,
          modelPath: files.model,
          mmprojPath: files.mmproj,
          modelDir: input.modelDir,
        })
        return {
          available: true,
          engine: 'local-hunyuanocr',
          text: result.text,
          blocks: result.blocks ?? [{ text: result.text }],
        }
      } catch (error) {
        if (engine === 'hunyuanocr') {
          return { available: false, reason: 'failed', message: `本地 OCR 失败：${(error as Error)?.message ?? 'unknown'}` }
        }
        // fall through to paddle
      }
    }
  }

  try {
    const runner = input.runPaddle ?? runPaddleOcr
    const result = await runner({ source: input.source, sourceType: input.sourceType, modelDir: input.modelDir })
    return {
      available: true,
      engine: 'local-paddleocr',
      text: result.text,
      blocks: result.blocks ?? [{ text: result.text }],
    }
  } catch (error) {
    const message = (error as Error)?.message ?? 'unknown'
    const missing = /Cannot find (module|package)|ERR_MODULE_NOT_FOUND/i.test(message)
    return {
      available: false,
      reason: missing ? 'engine_missing' : 'failed',
      message: missing ? `本地 OCR 引擎未安装：${message}` : `本地 OCR 失败：${message}`,
    }
  }
}
