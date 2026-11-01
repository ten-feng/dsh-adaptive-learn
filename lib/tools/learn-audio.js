/**
 * `self_learn_audio` — transcribe one audio file.
 *
 * Short audio (≤ audioLocalMaxMinutes, ≤ 50 MB) may run on the local
 * faster-whisper engine; longer audio goes straight to the cloud endpoint.
 * The bytes are never re-encoded locally — only written to a temp file when the
 * local engine needs a path.
 */
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { classify } from '../local/classify.js';
import { routeTask, shouldFallbackToCloud } from '../local/router.js';
import { runLocalAsr } from '../local/asr.js';
import { postForm } from '../http.js';
import { jsonRender, objectSchema } from './base.js';
const FREE_AUDIO_OPTIONS = [
    '硅基流动 SiliconFlow（SenseVoiceSmall 等，注册送额度）',
    'Groq（whisper-large-v3 的免费/低价档）',
];
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 60 * 60;
/**
 * Read a WAV header (no decoding) so short clips get an exact duration.
 *
 * Walks the RIFF chunks instead of assuming a 44-byte header: SAPI and other
 * writers emit an 18-byte `fmt ` chunk, which shifts the `data` size field.
 */
export function wavDurationSeconds(bytes) {
    if (bytes.byteLength < 12)
        return null;
    const riff = String.fromCharCode(...bytes.subarray(0, 4));
    const wave = String.fromCharCode(...bytes.subarray(8, 12));
    if (riff !== 'RIFF' || wave !== 'WAVE')
        return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    let byteRate = 0;
    while (offset + 8 <= bytes.byteLength) {
        const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
        const size = view.getUint32(offset + 4, true);
        const body = offset + 8;
        if (id === 'fmt ' && body + 12 <= bytes.byteLength) {
            byteRate = view.getUint32(body + 8, true);
        }
        else if (id === 'data') {
            if (!byteRate)
                return null;
            const actual = Math.min(size, bytes.byteLength - body);
            return actual / byteRate;
        }
        offset = body + size + (size % 2);
    }
    return null;
}
/** Fall back to a 128 kbps estimate when the container has no cheap header. */
export function estimateDurationSeconds(sizeBytes) {
    return (sizeBytes * 8) / 128_000;
}
/**
 * Cap the transcript before it reaches the model.
 *
 * A one-hour recording can be tens of thousands of characters; unlike
 * `self_learn_fetch` there was no ceiling here, so long audio could crowd out
 * the rest of the conversation. Truncation is reported, never silent.
 */
export function capText(text, maxChars) {
    const limit = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 8000;
    const totalChars = text.length;
    if (totalChars <= limit)
        return { text, totalChars, truncated: false };
    return { text: text.slice(0, limit), totalChars, truncated: true };
}
async function loadAudio(source, sourceType, fetchImpl) {
    if (sourceType === 'path' || (!/^https?:\/\//i.test(source) && !source.startsWith('data:'))) {
        try {
            const info = await stat(source);
            return { bytes: new Uint8Array(await readFile(source)), name: basename(source), sizeBytes: info.size };
        }
        catch (error) {
            return { error: `读取本地音频失败：${error?.message ?? 'unknown'}` };
        }
    }
    try {
        const response = await fetchImpl(source);
        if (!response.ok)
            return { error: `下载音频失败：HTTP ${response.status}` };
        const buffer = new Uint8Array(await response.arrayBuffer());
        const name = basename(new URL(source).pathname) || 'audio.bin';
        return { bytes: buffer, name, sizeBytes: buffer.byteLength };
    }
    catch (error) {
        return { error: `下载音频失败：${error?.message ?? 'unknown'}` };
    }
}
export function createAudioTool(deps) {
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    return {
        name: 'self_learn_audio',
        description: '转写一段音频。短音频（≤10 分钟、≤50MB）可走本地 faster-whisper，长音频直接走云端；不本地重编码。',
        parameters: {
            source: { type: 'string', required: true, description: '音频 URL 或本地文件路径' },
            sourceType: { type: 'string', enum: ['url', 'path'], description: 'source 的类型，默认按地址自动判断' },
            language: { type: 'string', description: '语言代码，例如 zh、en；不填则自动识别' },
        },
        output: {
            schema: objectSchema({
                available: { type: 'boolean' },
                route: { type: 'string' },
                engine: { type: 'string' },
                tier: { type: 'string' },
                text: { type: 'string' },
                totalChars: { type: 'number' },
                truncated: { type: 'boolean' },
                language: { type: 'string' },
                model: { type: 'string' },
                durationSeconds: { type: 'number' },
                sizeBytes: { type: 'number' },
                reason: { type: 'string' },
                message: { type: 'string' },
                userActionRequired: { type: 'string' },
                freeOptions: { type: 'array', items: { type: 'string' } },
            }, ['available']),
            render: jsonRender,
        },
        async execute(args) {
            const source = String(args.source);
            const sourceType = args.sourceType ?? (/^https?:\/\//i.test(source) ? 'url' : 'path');
            const language = args.language === undefined ? undefined : String(args.language);
            const loaded = await loadAudio(source, sourceType, fetchImpl);
            if ('error' in loaded) {
                return { available: false, route: 'unavailable', reason: 'audio_unreadable', message: loaded.error };
            }
            if (loaded.sizeBytes > MAX_AUDIO_BYTES) {
                return {
                    available: false,
                    route: 'cloud',
                    reason: 'audio_too_large',
                    sizeBytes: loaded.sizeBytes,
                    message: `音频 ${Math.round(loaded.sizeBytes / 1024 / 1024)}MB 超过 ${MAX_AUDIO_BYTES / 1024 / 1024}MB 上限，请先裁剪片段。`,
                };
            }
            const exact = wavDurationSeconds(loaded.bytes);
            const durationSeconds = exact ?? estimateDurationSeconds(loaded.sizeBytes);
            if (durationSeconds > MAX_AUDIO_SECONDS) {
                return {
                    available: false,
                    route: 'cloud',
                    reason: 'audio_too_long',
                    durationSeconds,
                    message: `音频约 ${Math.round(durationSeconds / 60)} 分钟，超过 1 小时上限，请拆成多段。`,
                };
            }
            const tier = classify({
                kind: 'audio',
                durationSeconds,
                sizeBytes: loaded.sizeBytes,
                audioLocalMaxMinutes: deps.config.audioLocalMaxMinutes,
            });
            const capability = await deps.capability();
            const decision = routeTask({
                kind: 'audio',
                tier,
                policy: deps.config.routePolicy,
                capability,
                localEnabled: deps.config.localEnabled,
                hasCloudKey: Boolean(deps.config.audioApiKey),
            });
            const routeInput = {
                kind: 'audio',
                tier,
                policy: deps.config.routePolicy,
                capability,
                localEnabled: deps.config.localEnabled,
                hasCloudKey: Boolean(deps.config.audioApiKey),
            };
            let localFailure;
            if (decision.route === 'unavailable') {
                return {
                    available: false,
                    route: 'unavailable',
                    tier,
                    durationSeconds,
                    reason: 'no_engine_available',
                    message: decision.reason,
                    userActionRequired: decision.userActionRequired,
                    freeOptions: FREE_AUDIO_OPTIONS,
                };
            }
            if (decision.route === 'local') {
                const dir = await mkdtemp(join(tmpdir(), 'dsh-learn-audio-'));
                const target = join(dir, loaded.name || `audio${extname(loaded.name) || '.bin'}`);
                await writeFile(target, loaded.bytes);
                const local = await (deps.asr ?? runLocalAsr)({
                    audioPath: target,
                    model: capability.localAsrModelSuggestion,
                    computeType: capability.localAsrComputeType,
                    modelDir: deps.modelDir,
                    language,
                });
                if (local.available) {
                    return {
                        available: true,
                        route: 'local',
                        engine: local.engine,
                        tier,
                        ...capText(local.text, deps.config.maxAudioChars),
                        language: local.language,
                        durationSeconds,
                        sizeBytes: loaded.sizeBytes,
                    };
                }
                if (!shouldFallbackToCloud(routeInput, local.reason)) {
                    return {
                        available: false,
                        route: 'local',
                        tier,
                        durationSeconds,
                        reason: local.reason,
                        message: local.message,
                        userActionRequired: `本地转写不可用（${local.message}），且未配置云端音频密钥。`,
                        freeOptions: FREE_AUDIO_OPTIONS,
                    };
                }
                localFailure = `本地 ${local.reason}：${local.message}`;
            }
            if (!deps.config.audioApiKey) {
                return {
                    available: false,
                    route: 'cloud',
                    tier,
                    durationSeconds,
                    reason: 'audio_api_key_missing',
                    message: '需要云端转写，但插件里还没有填写密钥。',
                    userActionRequired: '请到「设置 → 插件 → dsh-adaptive-learn」填写 audioApiKey（OpenAI 兼容的音频转写接口密钥）。',
                    freeOptions: FREE_AUDIO_OPTIONS,
                };
            }
            const form = new FormData();
            form.append('file', new Blob([loaded.bytes.buffer]), loaded.name || 'audio.bin');
            form.append('model', deps.config.audioModel);
            if (language)
                form.append('language', language);
            form.append('response_format', 'json');
            const result = await postForm(`${deps.config.audioBaseUrl.replace(/\/$/, '')}/audio/transcriptions`, form, { apiKey: deps.config.audioApiKey, fetchImpl: deps.fetchImpl, timeoutMs: 180_000 });
            if (!result.ok) {
                return {
                    available: false,
                    route: 'unavailable',
                    tier,
                    durationSeconds,
                    reason: localFailure ? 'all_engines_failed' : result.error.reason === 'rate_limited' ? 'rate_limited' : 'audio_api_error',
                    message: [localFailure, `云端失败：${result.error.message}`].filter(Boolean).join('；'),
                };
            }
            return {
                available: true,
                route: 'cloud',
                engine: `cloud:${deps.config.audioModel}`,
                model: deps.config.audioModel,
                tier,
                durationSeconds,
                sizeBytes: loaded.sizeBytes,
                ...capText(result.data.text ?? '', deps.config.maxAudioChars),
                language,
            };
        },
    };
}
