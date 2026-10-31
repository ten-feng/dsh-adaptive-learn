#!/usr/bin/env node
/**
 * dsh-adaptive-learn — 本地推理引擎安装器
 *
 * 插件本身体积很小，本地引擎按需安装。这个脚本把「装 npm 包 / 下模型 / 建 venv」
 * 三步合成一条命令，装完自动跑一次自检。
 *
 *   node scripts/install-local.mjs --ocr paddle      # 约 200MB，纯 npm，最快见效
 *   node scripts/install-local.mjs --ocr hunyuan     # 再加 1.35GB（GGUF + llama.cpp）
 *   node scripts/install-local.mjs --asr whisper     # 再加 296MB（Python venv）
 *   node scripts/install-local.mjs --all             # 全装
 *   node scripts/install-local.mjs --list            # 只看现状
 *
 * 通用参数：
 *   --profile <name>   要装进哪个 DSH profile（默认 desktop）
 *   --data-dir <path>  插件数据目录（默认 ~/.dsh/adaptive-learn）
 *   --dry              只打印计划，不动手
 *   --no-check         装完不自检
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolvePath(HERE, '..')

const HF_MIRROR = 'https://hf-mirror.com'
const HF_OFFICIAL = 'https://huggingface.co'
const PADDLE_PATHS = {
  detection: 'detection/PP-OCRv5_mobile_det_infer.onnx',
  recognition: 'recognition/PP-OCRv5_mobile_rec_infer.onnx',
  dictionary: 'recognition/ppocrv5_dict.txt',
}
const HUNYUAN_REPO = 'ggml-org/HunyuanOCR-GGUF'
const HUNYUAN_FILES = ['HunyuanOCR-Q8_0.gguf', 'mmproj-HunyuanOCR-Q8_0.gguf']
const LLAMA_TAG = 'b12017'

/** 自检用的小图（420x90，写着「DSH 本地引擎自检」），内联避免额外下载。 */
const SELF_CHECK_PNG = 'data:image/png;base64,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'

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--') && !a.includes('=')))
const value = (name, fallback) => {
  const withEquals = argv.find((a) => a.startsWith(`--${name}=`))
  if (withEquals) return withEquals.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1]
  return fallback
}

const opts = {
  profile: value('profile', 'desktop'),
  dataDir: value('data-dir', process.env.DSH_ADAPTIVE_DATA_DIR || join(homedir(), '.dsh', 'adaptive-learn')),
  dry: flags.has('--dry'),
  noCheck: flags.has('--no-check'),
  list: flags.has('--list'),
  ocr: value('ocr', ''),
  asr: value('asr', ''),
}

if (flags.has('--all')) {
  opts.ocr = 'both'
  opts.asr = 'whisper'
}
if (flags.has('--help') || flags.has('-h')) {
  console.log(
    [
      'dsh-adaptive-learn 本地引擎安装器',
      '',
      '  --ocr paddle|hunyuan|both   安装本地 OCR 引擎',
      '  --asr whisper               安装本地语音转写（Python venv）',
      '  --all                       全部安装',
      '  --list                      只打印当前状态',
      '  --profile <name>            DSH profile（默认 desktop）',
      '  --data-dir <path>           插件数据目录（默认 ~/.dsh/adaptive-learn）',
      '  --dry                       只打印计划',
      '  --no-check                  装完不自检',
    ].join('\n'),
  )
  process.exit(0)
}

const modelsDir = join(opts.dataDir, 'models')
const profileDir = join(homedir(), '.dsh', 'profiles', opts.profile)
const markers = {
  paddle: join(modelsDir, 'paddleocr', 'PP-OCRv5_mobile_det_infer.onnx'),
  hunyuan: join(modelsDir, 'hunyuanocr', HUNYUAN_FILES[0]),
  llamacpp: join(opts.dataDir, 'llamacpp'),
  venv: process.platform === 'win32'
    ? join(opts.dataDir, 'pyenv', 'Scripts', 'python.exe')
    : join(opts.dataDir, 'pyenv', 'bin', 'python'),
}

const log = (message) => console.log(message)
const step = (message) => console.log(`\n== ${message}`)
const ok = (message) => console.log(`   \u2713 ${message}`)
const warn = (message) => console.log(`   ! ${message}`)

function run(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
      windowsHide: true,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => resolvePromise({ code: -1, stdout, stderr: error.message }))
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }))
  })
}

/** pnpm：优先 PATH，其次 DSH 自带的运行时（Windows 安装包布局）。 */
async function resolvePnpm() {
  const candidate = process.env.DSH_PNPM_BIN
  if (candidate && existsSync(candidate)) return { command: process.execPath, args: [candidate] }

  const probe = await run('pnpm', ['--version'])
  if (probe.code === 0) return { command: 'pnpm', args: [] }

  if (process.platform === 'win32') {
    const base = join(
      process.env.LOCALAPPDATA || '',
      'Programs',
      'DeepSeek Harness',
      'resources',
      'runtime',
      'primary-runtime',
      'dependencies',
    )
    const pnpm = join(base, 'pnpm', 'bin', 'pnpm.mjs')
    const node = join(base, 'node', 'bin', 'node.exe')
    if (existsSync(pnpm)) return { command: existsSync(node) ? node : process.execPath, args: [pnpm] }
  }
  return null
}

async function download(url, dest, label, options = {}) {
  if (existsSync(dest) && !options.force) {
    ok(`${label} 已存在，跳过`)
    return true
  }
  if (opts.dry) {
    log(`   [dry] 会下载 ${label} ← ${url}`)
    return true
  }
  await mkdir(dirname(dest), { recursive: true })
  const partial = `${dest}.part`
  try {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    const total = Number(response.headers.get('content-length') || 0)
    const { createWriteStream } = await import('node:fs')
    const stream = createWriteStream(partial)
    const reader = response.body.getReader()
    let received = 0
    let lastTick = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      if (!stream.write(value)) await new Promise((r) => stream.once('drain', r))
      const now = Date.now()
      if (now - lastTick > 2000) {
        lastTick = now
        const pct = total ? ` (${((received / total) * 100).toFixed(0)}%)` : ''
        process.stdout.write(`\r   下载 ${label}: ${(received / 1048576).toFixed(1)}MB${pct}   `)
      }
    }
    await new Promise((r) => stream.end(r))
    if (total && received < total) throw new Error(`下载不完整：${received}/${total} 字节`)
    await import('node:fs').then((fs) => fs.renameSync(partial, dest))
    process.stdout.write('\r')
    ok(`${label} ← ${(received / 1048576).toFixed(1)}MB`)
    return true
  } catch (error) {
    await rm(partial, { force: true })
    if (options.fallbackUrl) {
      warn(`镜像失败（${error.message}），改用官方源`)
      return download(options.fallbackUrl, dest, label, { ...options, force: true, fallbackUrl: undefined })
    }
    warn(`${label} 下载失败：${error.message}`)
    return false
  }
}

async function extract(archive, dest) {
  if (opts.dry) {
    log(`   [dry] 会解压 ${archive} → ${dest}`)
    return true
  }
  await mkdir(dest, { recursive: true })
  if (process.platform === 'win32' && archive.endsWith('.zip')) {
    const result = await run('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dest}' -Force`,
    ])
    return result.code === 0
  }
  const flag = archive.endsWith('.zip') ? '-xf' : '-xzf'
  const result = await run('tar', [flag, archive, '-C', dest])
  return result.code === 0
}

function llamaAsset() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'win32') return `llama-${LLAMA_TAG}-bin-win-vulkan-${arch}.zip`
  if (process.platform === 'darwin') return `llama-${LLAMA_TAG}-bin-macos-${arch}.tar.gz`
  return `llama-${LLAMA_TAG}-bin-ubuntu-vulkan-${arch}.tar.gz`
}

async function installPaddleNpm() {
  const pnpm = await resolvePnpm()
  if (!pnpm) {
    warn('找不到 pnpm。请手动在 profile 目录执行：pnpm add ppu-paddle-ocr onnxruntime-node')
    return false
  }
  if (!existsSync(profileDir)) {
    warn(`profile 不存在：${profileDir}（先用 DSH 打开一次该 profile）`)
    return false
  }
  if (opts.dry) {
    log(`   [dry] 会在 ${profileDir} 执行 pnpm add ppu-paddle-ocr onnxruntime-node`)
    return true
  }
  step(`安装 npm 包到 ${opts.profile} profile`)
  const result = await run(pnpm.command, [...pnpm.args, 'add', 'ppu-paddle-ocr', 'onnxruntime-node'], {
    cwd: profileDir,
    inherit: true,
  })
  const installed = existsSync(join(profileDir, 'node_modules', 'ppu-paddle-ocr'))
  if (result.code !== 0 && !installed) {
    warn('pnpm 安装失败，见上面的输出')
    return false
  }
  if (result.code !== 0) {
    // onnxruntime-node 的 postinstall 被 pnpm 拦截会返回非 0，但文件已就位，功能不受影响。
    warn('pnpm 返回非 0（多为忽略构建脚本），已确认包文件就位，继续')
  }
  return true
}

async function installPaddleModels() {
  step('下载 PaddleOCR 模型')
  const dir = join(modelsDir, 'paddleocr')
  const files = [
    [PADDLE_PATHS.detection, 'PP-OCRv5_mobile_det_infer.onnx'],
    [PADDLE_PATHS.recognition, 'PP-OCRv5_mobile_rec_infer.onnx'],
    [PADDLE_PATHS.dictionary, 'ppocrv5_dict.txt'],
  ]
  let all = true
  for (const [remote, local] of files) {
    const url = `${HF_MIRROR}/snowfluke/ppu-paddle-ocr-models/resolve/main/${remote}`
    const fallbackUrl = `${HF_OFFICIAL}/snowfluke/ppu-paddle-ocr-models/resolve/main/${remote}`
    all = (await download(url, join(dir, local), local, { fallbackUrl })) && all
  }
  return all
}

async function installHunyuan() {
  step('下载 HunyuanOCR 权重（约 1.25GB）')
  const dir = join(modelsDir, 'hunyuanocr')
  for (const file of HUNYUAN_FILES) {
    const encoded = encodeURIComponent(file)
    const url = `${HF_MIRROR}/${HUNYUAN_REPO}/resolve/main/${encoded}`
    const fallbackUrl = `${HF_OFFICIAL}/${HUNYUAN_REPO}/resolve/main/${encoded}`
    await download(url, join(dir, file), file, { fallbackUrl })
  }

  step('下载 llama.cpp 多模态 CLI')
  const asset = llamaAsset()
  const target = markers.llamacpp
  const existing = join(target, 'llama-mtmd-cli.exe')
  if (existsSync(existing)) {
    ok('llama-mtmd-cli 已存在，跳过')
  } else {
    const archive = join(target, asset)
    const url = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${asset}`
    const downloaded = await download(url, archive, asset)
    if (downloaded) {
      await extract(archive, target)
      await rm(archive, { force: true })
      ok(`已解压到 ${target}`)
    }
  }
  return existsSync(join(dir, HUNYUAN_FILES[0]))
}

async function resolvePython() {
  const candidates = [process.env.DSH_ADAPTIVE_PYTHON, 'python', 'python3'].filter(Boolean)
  for (const python of candidates) {
    const probe = await run(python, ['-V'])
    if (probe.code === 0) return python
  }
  return null
}

async function installWhisper() {
  step('准备 faster-whisper 环境')
  if (existsSync(markers.venv)) {
    ok(`venv 已存在：${markers.venv}`)
  } else {
    const python = await resolvePython()
    if (!python) {
      warn('找不到 python。请先安装 Python 3.9+，或用 DSH_ADAPTIVE_PYTHON 指定解释器。')
      return false
    }
    if (opts.dry) {
      log(`   [dry] 会用 ${python} 在 ${join(opts.dataDir, 'pyenv')} 建 venv`)
      return true
    }
    const venvDir = join(opts.dataDir, 'pyenv')
    const created = await run(python, ['-m', 'venv', venvDir], { inherit: true })
    if (created.code !== 0) {
      warn('创建 venv 失败')
      return false
    }
    ok(`venv: ${venvDir}`)
  }

  if (opts.dry) {
    log('   [dry] 会安装 faster-whisper / huggingface-hub<1.0 / av==16.0.1')
    return true
  }
  const pip = await run(markers.venv, ['-c', 'import faster_whisper'], {})
  if (pip.code === 0) {
    ok('faster-whisper 已安装')
    return true
  }
  step('安装 faster-whisper（版本已按兼容性钉住）')
  const install = await run(
    markers.venv,
    [
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '-i',
      process.env.PIP_INDEX_URL || 'https://pypi.tuna.tsinghua.edu.cn/simple',
      'faster-whisper',
      'huggingface-hub<1.0',
      'av==16.0.1',
    ],
    { inherit: true },
  )
  if (install.code !== 0) {
    warn('pip 安装失败，见上面的输出')
    return false
  }
  return true
}

async function selfCheckOcr() {
  step('自检：本地 OCR')
  const { runLocalOcr } = await import('../lib/local/ocr.js')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ocr-check-'))
  const file = join(dir, 'selfcheck.png')
  try {
    const base64 = SELF_CHECK_PNG.replace(/^data:image\/png;base64,/, '')
    await writeFile(file, Buffer.from(base64, 'base64'))
    const result = await runLocalOcr({ source: file, sourceType: 'path', modelDir: modelsDir, engine: 'auto' })
    if (result.available && /自检|DSH/i.test(result.text)) {
      ok(`OCR 可用（${result.engine}）：${result.text.replace(/\s+/g, ' ').trim()}`)
      return true
    }
    warn(`OCR 未通过：${result.reason ?? 'unknown'} ${result.message ?? ''}`.trim())
    return false
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function selfCheckWhisper() {
  step('自检：faster-whisper 运行环境')
  if (!existsSync(markers.venv)) {
    warn('venv 不存在')
    return false
  }
  const result = await run(markers.venv, ['-c', 'import faster_whisper, av; print(faster_whisper.__version__, av.__version__)'])
  if (result.code === 0) {
    ok(`faster-whisper / av ${result.stdout.trim()}（首次转写会下载模型）`)
    return true
  }
  warn(`导入失败：${result.stderr.trim().split('\n').pop()}`)
  return false
}

function printStatus() {
  const rows = [
    ['PaddleOCR 模型', existsSync(markers.paddle)],
    ['HunyuanOCR 权重', existsSync(markers.hunyuan)],
    ['llama-mtmd-cli', existsSync(join(markers.llamacpp, 'llama-mtmd-cli.exe')) || existsSync(join(markers.llamacpp, 'llama-mtmd-cli'))],
    ['faster-whisper venv', existsSync(markers.venv)],
  ]
  step(`当前状态（${opts.dataDir}）`)
  for (const [name, present] of rows) console.log(`   ${present ? '\u2713' : '\u00b7'} ${name}`)
}

async function main() {
  if (!opts.ocr && !opts.asr) {
    printStatus()
    log('\n要装什么：--ocr paddle | --ocr hunyuan | --ocr both | --asr whisper | --all')
    return 0
  }

  log(`dsh-adaptive-learn 本地引擎安装器`)
  log(`   profile : ${opts.profile}`)
  log(`   数据目录 : ${opts.dataDir}`)
  if (opts.dry) log('   模式     : dry-run（不下载、不写入）')

  const wantedOcr = opts.ocr === 'both' ? ['paddle', 'hunyuan'] : opts.ocr ? [opts.ocr] : []
  if (!['', 'paddle', 'hunyuan', 'both'].includes(opts.ocr)) {
    warn(`--ocr 只接受 paddle / hunyuan / both，收到 "${opts.ocr}"`)
    return 2
  }

  let ocrReady = false
  if (wantedOcr.includes('paddle')) {
    const npmOk = await installPaddleNpm()
    const modelsOk = await installPaddleModels()
    ocrReady = npmOk && modelsOk
  }
  if (wantedOcr.includes('hunyuan')) {
    const hunyuanOk = await installHunyuan()
    ocrReady = ocrReady || hunyuanOk
  }

  let asrReady = false
  if (opts.asr === 'whisper') asrReady = await installWhisper()

  if (opts.noCheck || opts.dry) {
    printStatus()
    return 0
  }

  let checksPass = true
  if (ocrReady) checksPass = (await selfCheckOcr()) && checksPass
  if (asrReady) checksPass = (await selfCheckWhisper()) && checksPass

  printStatus()
  log('')
  if (checksPass) {
    log('完成。重启 DSH 后即可使用本地推理（无需在设置里填密钥）。')
    return 0
  }
  log('部分组件未就绪，见上面的提示；插件仍可正常工作，只是对应任务会走云端。')
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('安装器异常：', error)
    process.exit(1)
  })
