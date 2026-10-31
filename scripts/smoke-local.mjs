/**
 * Local-inference smoke test: real OCR and real ASR, through the same tool
 * objects the plugin registers with the host.
 *
 *   node scripts/smoke-local.mjs
 *
 * Fixtures come from output/smoke/. Relevant env:
 *   DSH_ADAPTIVE_DATA_DIR, DSH_ADAPTIVE_LLAMA_MTMD, DSH_ADAPTIVE_ASR_PYTHON,
 *   DSH_ADAPTIVE_PADDLE_MODEL_DIR, HF_ENDPOINT, HF_HUB_DISABLE_XET
 */
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeCapability } from '../lib/local/capability.js'
import { createVisionTool } from '../lib/tools/learn-vision.js'
import { createAudioTool } from '../lib/tools/learn-audio.js'
import { resolveConfig } from '../lib/config.js'
import { WikiStore } from '../lib/tools/learn-wiki.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.env.DSH_ADAPTIVE_DATA_DIR ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'adaptive-learn')
const modelDir = join(dataDir, 'models')
const image = join(root, 'output', 'smoke', 'ocr-sample.png')
const audio = join(root, 'output', 'smoke', 'asr-sample.wav')

const capability = await probeCapability({ ocrMinVramMB: 2048, asrMinVramMB: 1024 })
const config = resolveConfig({
  visionApiKey: '',
  audioApiKey: '',
  routePolicy: 'auto',
  localEnabled: true,
  knowledgeDir: mkdtempSync(join(tmpdir(), 'dsh-learn-kb-')),
})
const deps = {
  config,
  capability: async () => capability,
  getWiki: () => new WikiStore(config.knowledgeDir),
  modelDir,
}

const out = {
  capability: {
    gpu: capability.gpu,
    localOcrReady: capability.localOcrReady,
    localAsrReady: capability.localAsrReady,
    asrModel: capability.localAsrModelSuggestion,
    compute: capability.localAsrComputeType,
  },
}

if (existsSync(image)) {
  const vision = createVisionTool(deps)
  const started = Date.now()
  out.vision = await vision.execute({ source: image, sourceType: 'path', question: '提取文字' }, {})
  out.visionBytes = statSync(image).size
  out.visionMs = Date.now() - started
}

if (existsSync(audio)) {
  const tool = createAudioTool(deps)
  const started = Date.now()
  out.audio = await tool.execute({ source: audio, sourceType: 'path', language: 'zh' }, {})
  out.audioBytes = statSync(audio).size
  out.audioMs = Date.now() - started
}

console.log(JSON.stringify(out, null, 2))
