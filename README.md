# dsh-adaptive-learn

DSH 的「自适应学习」插件：遇到没有现成材料的问题时，先探测本机能力，再把**轻任务放本地、重任务放云端**，把结论写进**两段式知识库**，回喂原任务，确认后再升入正式知识库。

- 不调用任何其他 DSH 插件：网页抓取、文本提取、HTTP、知识库全部由本包自己实现。
- `dependencies` 为空；本地推理引擎不进运行时依赖，缺了也能正常工作（按需补装，见下文）。
- 启动不校验密钥；没有密钥、没有 GPU 时插件照常加载，需要时返回 `userActionRequired` 让模型转述。

## 安装

```bash
# 从本仓库安装（link 到本地克隆目录）
dsh plugin --profile <profile> add link:<本目录绝对路径>

# 或从 GitHub tarball 安装
dsh plugin --profile <profile> add https://codeload.github.com/ten-feng/dsh-adaptive-learn/tar.gz/refs/heads/main
```

`lib/` 是编译产物，已随仓库提交，装完即可用；改源码后跑 `pnpm build` 重新生成。

## 配置

所有配置都在 profile 的 `cordis.patch.yml` 里（`~/.dsh/profiles/<profile>/cordis.patch.yml`）：

```yaml
- id: adaptive-learn
  name: dsh-adaptive-learn
  config:
    # 云端视觉（OpenAI 兼容，示例为阿里云百炼）
    visionBaseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1
    visionModel: qwen3-vl-plus
    visionApiKey: sk-xxxxxxxx
    # 云端音频（示例为硅基流动）；不填则长音频返回 audio_api_key_missing
    # audioBaseUrl: https://api.siliconflow.cn/v1
    # audioModel: FunAudioLLM/SenseVoiceSmall
    # audioApiKey: sk-xxxxxxxx
```

> ⚠️ patch 的 `config` 是**整体替换**，不是合并——只写要覆盖的字段，其余走 Schema 默认值。
> 模型名以你账号实际可用的为准：百炼可直接 `GET {visionBaseUrl}/models` 核对，
> 例如 `qwen-vl-max` 并非所有账号都有，本机账号可用的是 `qwen3-vl-plus`。
> 改完需要**重启 DSH** 才生效。

密钥字段在 Schema 里声明为 `role('secret')`，插件不会打印它，也不会写进日志。

## 六个工具

| 工具 | 作用 | 说明 |
|---|---|---|
| `self_learn_fetch` | 读网页正文 | 内置 fetch + 正则提取，去脚本/导航/页脚，嗅探 GBK/UTF-8，按 `maxFetchChars` 截断 |
| `self_learn_vision` | 读图片/视频 | 内部自动选本地 OCR 或云端视觉模型；密钥缺失返回 `vision_api_key_missing` + `freeOptions` |
| `self_learn_audio` | 转写音频 | 短音频可本地 faster-whisper，长音频直接云端；不本地重编码 |
| `self_learn_wiki_recall` | 查知识库 | **只查 `pages/`**，staged 草稿不参与召回 |
| `self_learn_wiki_stage` | 写草稿 | 写入 `_knowledge/staged/`，来源必填字段：`type` / `ref` / `engine` |
| `self_learn_wiki_commit` | 升入正式库 | 来源为空且 `wikiCommitRequiresSource=true` 时拒绝 |

## 能力探测

`local/capability.ts` 按下面的顺序探测，**不假设任何显卡型号**：

1. `nvidia-smi --query-gpu=name,memory.total,memory.free,compute_cap --format=csv,noheader,nounits`
2. 失败则 `systeminformation.graphics()`
3. 都失败 → `gpu.available = false`

由此得到 `vramFreeMB`、`cudaCapability`，再计算：

- `localOcrReady = vramFreeMB >= ocrMinVramMB`（默认 2048）
- `localAsrReady = vramFreeMB >= asrMinVramMB`（默认 1024）
- Whisper 尺寸建议：`>=5GB → large-v3-turbo`，`>=3GB → medium`，否则 `small`
- `cudaCapability < 7.0` 时强制 `int8_float32`（避免老卡 FP16 溢出）

**每次学习调用都会判断一次硬件**，但不重复付代价：

- 10 秒内重复调用直接复用上一次探测结果（`nvidia-smi` 本机 45~70ms，十来秒一次可忽略）
- 探测到"这台机器没有 GPU"时，60 秒内不再重试 —— 无卡机器上 `systeminformation` 回退才是最贵的一段
- 需要立刻刷新（诊断用）可调 `apply()` 返回的 `probeCapability()`，它绕过两个窗口强制重探
- 探测失败（驱动忙/超时）沿用最近 24 小时内的上一份快照并标 `stale: true`，**不会**误判成"没有 GPU"

快照写回 `~/.dsh/adaptive-learn/capability.json`（可用 `DSH_ADAPTIVE_DATA_DIR` 覆盖），作诊断与兜底。

## 任务分级与路由

`local/classify.ts` 是纯函数：

- 图片：只问「提取/识别/读出」→ `light`；问「描述/分析/解释/为什么/怎么操作」→ `heavy`
- 音频：`≤ audioLocalMaxMinutes`（默认 10）且 `≤ 50MB`、单声道、不需要说话人分离 → `light`，否则 `heavy`
- 视频：一律 `heavy`

`local/router.ts`：

| 策略 | 行为 |
|---|---|
| `local-first` | 本地就绪且 `light` → 本地；否则云端 |
| `cloud-first` | 一律云端 |
| `auto`（默认） | `light` 且本地就绪 → 本地；`light` 但本地未就绪 → 云端（无密钥则 `unavailable`）；`heavy` → 云端；**云端缺密钥但本地能处理 `light` 时直接用本地，不向用户索要密钥** |

## 本地模型

本机跑通的两条链路（实测环境：RTX 2060 SUPER 8GB / i5-10400F / Win11）：

| 用途 | 引擎 | 权重 | 实测 |
|---|---|---|---|
| OCR | `llama-mtmd-cli`（llama.cpp）+ HunyuanOCR GGUF Q8 | `HunyuanOCR-Q8_0.gguf` 551MB + `mmproj-HunyuanOCR-Q8_0.gguf` 699MB | 2.5s，中文全对 |
| OCR 备选 | `ppu-paddle-ocr` + onnxruntime-node | PP-OCRv5 mobile det 4.5MB + rec 15.8MB + 字典 | 1.3s，中文全对 |
| ASR | Python + `faster-whisper` | small（CTranslate2）484MB | 5.6s / 7 秒音频，中文基本全对 |

**为什么 OCR 不是 node-llama-cpp**：`node-llama-cpp@3.22` 没有 vision/mmproj 接口
（`dist/` 里搜不到 `mmproj`/`mtmd`），GGUF 视觉模型跑不起来。插件因此改为调用
llama.cpp 官方 `llama-mtmd-cli`：它是独立二进制，属于**运行时探测**的能力，不是本包依赖。

### 一键安装（推荐）

本地推理引擎**不随插件安装**：塞进依赖会让每次 `dsh plugin add` 下载近 900MB 原生二进制，
而且 pnpm 会因后置脚本报 `ERR_PNPM_IGNORED_BUILDS`，让 DSH 把一次成功的安装标成失败。
需要本地推理时跑安装器，它按需只装你要的那部分：

```bash
node scripts/install-local.mjs --list            # 只看当前状态
node scripts/install-local.mjs --ocr paddle      # 约 200MB，纯 npm，最快见效
node scripts/install-local.mjs --ocr hunyuan     # 再加 1.35GB（GGUF + llama.cpp，有 N 卡才有意义）
node scripts/install-local.mjs --asr whisper     # 再加 296MB（Python venv）
node scripts/install-local.mjs --all             # 全装
```

| 参数 | 说明 |
|---|---|
| `--ocr paddle` / `hunyuan` / `both` | 本地 OCR 引擎 |
| `--asr whisper` | 本地语音转写（auto 找 python 建 venv） |
| `--profile <name>` | 装进哪个 DSH profile，默认 `desktop` |
| `--data-dir <path>` | 插件数据目录，默认 `~/.dsh/adaptive-learn` |
| `--dry` / `--no-check` | 只看计划 / 装完不自检 |

脚本做的事：① 往 profile 里 `pnpm add` 引擎包并容忍 `IGNORED_BUILDS`；
② 从 `hf-mirror.com` 拉模型（失败自动回退官方源）；③ 建 venv 并**钉住** `av==16.0.1`、`huggingface-hub<1.0`；
④ 用内置的一张测试图真的跑一次 OCR，通过才返回 0。

```
== 自检：本地 OCR
   ✓ OCR 可用（local-paddleocr）：DSH 本地引擎自检
```

### 手动安装（脚本不可用时）

```bash
cd ~/.dsh/profiles/<profile>
pnpm add ppu-paddle-ocr onnxruntime-node        # 模型下载到 <数据目录>/models/paddleocr/
python -m venv <数据目录>/pyenv                 # faster-whisper
<数据目录>/pyenv/Scripts/python.exe -m pip install faster-whisper "huggingface-hub<1.0" "av==16.0.1"
```

HunyuanOCR 还需要手动放两样东西：`https://github.com/ggml-org/llama.cpp/releases` 的
win 构建解压到 `<数据目录>/llamacpp/`，GGUF 权重（`ggml-org/HunyuanOCR-GGUF`）放
`<数据目录>/models/hunyuanocr/`。

不装这些也能用：插件会返回 `engine_missing` / `model_downloading`，并按配置降级到云端。

> 版本坑：`av>=19` 删掉了 `metadata_errors` 参数，faster-whisper 1.2.1 会直接抛
> `open() got an unexpected keyword argument 'metadata_errors'`；`huggingface-hub>=1.0`
> 的下载接口也与它不兼容。两个都必须按上面的版本钉住。
> 国内网络还需要 `HF_ENDPOINT=https://hf-mirror.com` 与 `HF_HUB_DISABLE_XET=1`
> （xet 走 `cas-server.xethub.hf.co`，镜像不代理，会 401）。

### 环境变量

| 变量 | 作用 |
|---|---|
| `DSH_ADAPTIVE_DATA_DIR` | 插件数据目录（默认 `~/.dsh/adaptive-learn`） |
| `DSH_ADAPTIVE_LLAMA_MTMD` | `llama-mtmd-cli` 可执行文件路径 |
| `DSH_ADAPTIVE_OCR_MODEL` | 指定 HunyuanOCR 主权重 GGUF |
| `DSH_ADAPTIVE_OCR_PROMPT` | 覆盖 OCR 提示词 |
| `DSH_ADAPTIVE_PADDLE_MODEL_DIR` | PaddleOCR 模型目录 |
| `DSH_ADAPTIVE_ASR_PYTHON` | faster-whisper 的 Python（缺省会自动找 `<数据目录>/pyenv`） |
| `DSH_ADAPTIVE_ASR_DEVICE` | `cuda` / `cpu`；`auto` 先试 CUDA 再退 CPU |
| `HF_ENDPOINT` / `HF_HUB_DISABLE_XET` | Whisper 权重下载走镜像 |

显存不足会直接跳过本地路径（不会 OOM）。权重位置：`<数据目录>/models/`。
显存 ≥5GB 时建议 `large-v3-turbo`，但如果磁盘上只有 `small`，转写会**优先用已缓存的模型**，
不会为了"建议值"再拉 1.6GB。首次下载由 faster-whisper 自己完成，因此这条路径只会返回
`engine_missing` 或明确错误，不会伪造进度。

### 实测输出

```json
{
  "vision": { "route": "local", "engine": "local-hunyuanocr", "tier": "light",
    "text": "自适应学习插件本地 OCR 测试\n订单号: DSH-20261031-0042\n金额 1280.50 元,状态: 已支付" },
  "audio": { "route": "local", "engine": "local-faster-whisper-small", "tier": "light",
    "text": "今天天气晴朗,适合出门散步。请把这段画转成文字。", "language": "zh" }
}
```

复跑：`node scripts/smoke-local.mjs`（需要 `output/smoke/` 下的两张 fixture）。

## 降级规则

1. 探测失败 → 全部走云端。
2. 本地推理失败且云端密钥存在 → 自动降级云端；两侧都失败才返回 `available:false` 并说明两段原因。
3. 云端密钥缺失但本地能处理 `light` → 直接用本地，不索要密钥。
4. 显存不足 → 跳过本地，不尝试加载模型。
5. 模型首次下载 → `model_downloading`，不是失败。

## 免费方案（额度会变，以官网为准）

- 视觉：AMD Radeon 开发者云（插件默认 `visionBaseUrl`）、阿里云百炼（通义千问 VL）、硅基流动
- 音频：硅基流动（SenseVoiceSmall）、Groq（whisper-large-v3）

切换方式：在插件设置里改 `visionBaseUrl` / `visionModel` / `visionApiKey` 与
`audioBaseUrl` / `audioModel` / `audioApiKey`，视觉与音频端点互相独立。

## 音频限制

- 单个文件上限 50MB、1 小时；超过直接返回 `audio_too_large` / `audio_too_long`，请先裁剪。
- 不本地重转码：文件原样交给引擎；本地引擎需要路径时只写临时文件。
- 时长优先读 WAV 头，其他格式按 128kbps 估算；因此超高码率的长音频可能被提前判为 `heavy`。

## 触发

只有两个入口，`agent/pre-step` 按顺序判断：

1. **命令**：`explicitPrefixes`（默认 `/learn`）开头 → 剥离前缀，注入自学协议；不参与评分，也不受冷却限制。
2. **评分**：`triggerMode` 含 `auto` 时对消息文本做纯函数打分（只处理 `source.kind === 'user'`）；
   自学信号 +2、否定抑制 −2、结构信号 +1；超过 `autoScoreThreshold`（默认 2）且不在冷却期（默认 3 分钟）才注入。

**附件不触发任何东西**：图片、视频、音频都不再绕过评分，也不单独注入指令。
带图的消息只按它自己的文字评分——纯图片、"好的谢谢"这类零干预；"这个报错我不会"照常触发。

> 这样做的理由：一张截图或一段录音本身不是知识缺口，按附件类型注入会把对话刷满；
> 真正需要看图/听音频时，模型在正常回答或 `/learn` 流程里自己调 `self_learn_vision` / `self_learn_audio` 即可。

评分不调用模型、不发网络请求；闲聊和纯附件消息零干预。

## 知识库

```
_knowledge/
├── staged/   草稿：不参与召回
└── pages/    正式：唯一召回来源
```

条目是带 JSON front-matter 的 markdown，可人读也可机读；`sources` 记录 `type`/`ref`/`engine`，
commit 时原样保留，召回结果里能看到结论来自哪个引擎。

## 开发

```bash
pnpm install --config.optional=false   # 本地推理依赖按需再装
pnpm build                             # tsc -> lib/
pnpm test                              # vitest run tests（19 条）
```

> `.npmrc` 与 `pnpm-workspace.yaml` 关掉了 peer 自动安装：`@deepseek-ai/cordis` /
> `@deepseek-ai/dsh-tools` 由 DSH 宿主在运行时注入，其中部分传递 peer 没有公开发布，
> 本地装不上也没必要装。`verifyDepsBeforeRun: false` 让 `pnpm build/test` 不再先跑一次安装。

安装到某个 profile：

```bash
dsh plugin --profile web add link:$(pwd)
dsh --profile web --dump-config | grep adaptive-learn
```

`peerDependencies` 里 `@deepseek-ai/dsh-tools` 写的是 `*`：宿主版本（0.2.x）高于 npm 上
公开发布的 `0.0.1-rc.1`，写死小版本会被 DSH 的兼容性闸门拦下。

## 配置项

见 `src/config.ts`。密钥字段使用 `Schema.string().role('secret')`，不会写进日志，也不会被本包打印。
