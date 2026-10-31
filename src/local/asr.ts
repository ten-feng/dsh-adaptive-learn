/**
 * Local ASR.
 *
 * faster-whisper runs through Python (INT8 on CPU/GPU via CTranslate2). When the
 * bridge is absent we say so, and the router falls back to the cloud endpoint.
 * Audio is never transcoded locally: the file is handed to the engine as-is.
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'

export type AsrOutcome =
  | { available: true; engine: string; text: string; language?: string }
  | {
      available: false
      reason: 'engine_missing' | 'model_downloading' | 'failed' | 'too_long'
      message: string
      progress?: number
    }

export interface AsrInput {
  audioPath: string
  /** Whisper size, already resolved from VRAM. */
  model: 'small' | 'medium' | 'large-v3-turbo'
  /** `int8` compute type derived from the device. */
  computeType: 'int8_float32' | 'float16'
  /** Root of the model cache. */
  modelDir: string
  language?: string
  /** Test seam. */
  runBridge?: (input: AsrInput) => Promise<AsrOutcome>
  pythonPath?: string
}

const MODEL_DIR_MAP: Record<AsrInput['model'], string> = {
  small: 'small',
  medium: 'medium',
  'large-v3-turbo': 'large-v3-turbo',
}

const BRIDGE_SOURCE = String.raw`
import json, sys, os
paths = json.loads(sys.argv[1])
try:
    from faster_whisper import WhisperModel
except Exception as exc:
    print(json.dumps({"ok": False, "reason": "engine_missing", "message": "faster_whisper 未安装: %s" % exc}))
    sys.exit(0)

def resolve_model(name, root):
    import os
    def cached(candidate):
        return os.path.isdir(os.path.join(root, "models--Systran--faster-whisper-" + candidate))
    if cached(name):
        return name
    # Prefer a model that is already on disk over a silent multi-GB download.
    for alt in ["small", "medium", "large-v3-turbo"]:
        if cached(alt):
            return alt
    return name

def load(device):
    compute = paths["compute"] if device == "cuda" else "int8"
    model_name = resolve_model(paths["model"], paths["dir"])
    return model_name, WhisperModel(model_name, device=device, compute_type=compute, download_root=paths["dir"])

requested = paths.get("device") or os.environ.get("DSH_ADAPTIVE_ASR_DEVICE") or "auto"
tried = []
result = None
for device in ([requested] if requested != "auto" else ["cuda", "cpu"]):
    try:
        model_name, model = load(device)
        segments, info = model.transcribe(paths["audio"], language=paths.get("language") or None, vad_filter=True)
        text = "".join(segment.text for segment in segments).strip()
        result = {"ok": True, "text": text, "language": getattr(info, "language", None), "device": device, "model": model_name}
        tried.append(device + ":ok")
        break
    except Exception as exc:
        message = str(exc)
        # A CUDA runtime that is missing its DLLs is expected on a driver-only
        # machine: fall through to the CPU pass instead of failing the call.
        tried.append("%s:%s" % (device, message[:160]))

if result is not None:
    print(json.dumps(result))
    sys.exit(0)

message = " | ".join(tried)
reason = "model_downloading" if ("download" in message.lower() or "connection" in message.lower()) else "failed"
print(json.dumps({"ok": False, "reason": reason, "message": message}))
`

function runPython(pythonPath: string, args: string[], timeoutMs = 120_000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(pythonPath, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ stdout: '', stderr: error.message, code: -1 })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code: code ?? -1 })
    })
  })
}

function candidatePythons(input: AsrInput): string[] {
  const fromEnv = process.env.DSH_ADAPTIVE_ASR_PYTHON
  const fromInput = input.pythonPath
  // A venv created next to the model cache is picked up without configuration.
  const bundled = process.platform === 'win32'
    ? join(input.modelDir, '..', 'pyenv', 'Scripts', 'python.exe')
    : join(input.modelDir, '..', 'pyenv', 'bin', 'python')
  return [...new Set([fromInput, fromEnv, bundled, 'python', 'python3'].filter((item): item is string => !!item))]
}

/** Transcribe with faster-whisper, or explain why that is impossible here. */
export async function runLocalAsr(input: AsrInput): Promise<AsrOutcome> {
  if (input.runBridge) return input.runBridge(input)

  const payload = JSON.stringify({
    audio: input.audioPath,
    model: MODEL_DIR_MAP[input.model],
    compute: input.computeType,
    dir: input.modelDir,
    language: input.language ?? '',
  })

  let lastError = ''
  for (const python of candidatePythons(input)) {
    const result = await runPython(python, ['-c', BRIDGE_SOURCE, payload])
    if (result.code === -1 && /ENOENT|not found|无法找到/i.test(result.stderr)) {
      lastError = result.stderr
      continue
    }
    const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop()
    if (!line) {
      lastError = result.stderr || `python 退出码 ${result.code}`
      continue
    }
    try {
      const parsed = JSON.parse(line) as
        | { ok: true; text: string; language?: string | null; model?: string; device?: string }
        | {
            ok: false
            reason: 'engine_missing' | 'model_downloading' | 'failed' | 'too_long'
            message: string
          }
      if (parsed.ok) {
        return {
          available: true,
          // The bridge may pick an already-cached size instead of downloading one.
          engine: `local-faster-whisper-${parsed.model ?? input.model}`,
          text: parsed.text,
          language: parsed.language ?? undefined,
        }
      }
      return {
        available: false,
        reason: parsed.reason === 'model_downloading' ? 'model_downloading' : 'failed',
        message: parsed.message,
        progress: parsed.reason === 'model_downloading' ? 0 : undefined,
      }
    } catch {
      lastError = line
    }
  }

  return {
    available: false,
    reason: 'engine_missing',
    message: `未找到可用的 faster-whisper 运行环境（python）：${lastError || 'python 不可用'}`,
  }
}
