/**
 * Runtime settings overlay.
 *
 * The panel edits live values; they are persisted next to the engine cache and
 * re-applied on the next boot (over the schema/patch config, which stays the
 * source of defaults). Saving mutates the in-memory config object the tools
 * already close over, so a key change takes effect without a restart.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const EDITABLE = [
    'visionBaseUrl',
    'visionModel',
    'visionApiKey',
    'audioBaseUrl',
    'audioModel',
    'audioApiKey',
    'routePolicy',
    'allowPrivateUrls',
    'maxFetchChars',
    'maxAudioChars',
];
const NUMERIC = ['maxFetchChars', 'maxAudioChars'];
const NUMERIC_MIN = 500;
const NUMERIC_MAX = 200_000;
/** Keep only known keys with the right primitive types. */
export function sanitizePatch(raw) {
    const source = raw !== null && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const key of EDITABLE) {
        const value = source[key];
        if (value === undefined || value === null)
            continue;
        if (NUMERIC.includes(key)) {
            // 面板里是文本框，接受数字或数字字符串；越界与脏值直接丢弃
            const parsed = typeof value === 'number' ? value : Number(String(value).trim());
            if (!Number.isFinite(parsed))
                continue;
            const clamped = Math.min(NUMERIC_MAX, Math.max(NUMERIC_MIN, Math.round(parsed)));
            out[key] = clamped;
            continue;
        }
        if (typeof value !== 'string')
            continue;
        out[key] = value.trim();
    }
    if (out.routePolicy && !['auto', 'local-first', 'cloud-first'].includes(out.routePolicy))
        delete out.routePolicy;
    if (source.allowPrivateUrls !== undefined)
        out.allowPrivateUrls = source.allowPrivateUrls === true;
    return out;
}
/** Never return a secret in clear text to the browser. */
export function maskSecret(value) {
    if (!value)
        return '';
    if (value.length <= 8)
        return '••••';
    return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
export class SettingsStore {
    file;
    config;
    constructor(file, config) {
        this.file = file;
        this.config = config;
        this.overlay();
    }
    /** Overlay the persisted patch onto the live config object. */
    overlay() {
        for (const [key, value] of Object.entries(this.read())) {
            ;
            this.config[key] = value;
        }
    }
    read() {
        try {
            return sanitizePatch(JSON.parse(readFileSync(this.file, 'utf8')));
        }
        catch {
            return {};
        }
    }
    /** Persist a patch and apply it immediately. */
    save(raw) {
        const patch = sanitizePatch(raw);
        if (Object.keys(patch).length === 0)
            return {};
        const merged = { ...this.read(), ...patch };
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(this.file, JSON.stringify(merged, null, 2), 'utf8');
        for (const [key, value] of Object.entries(patch)) {
            ;
            this.config[key] = value;
        }
        return patch;
    }
    /** The browser-safe view: no clear-text secrets. */
    view() {
        return {
            visionBaseUrl: this.config.visionBaseUrl,
            visionModel: this.config.visionModel,
            visionApiKey: maskSecret(this.config.visionApiKey),
            visionApiKeySet: this.config.visionApiKey.length > 0,
            audioBaseUrl: this.config.audioBaseUrl,
            audioModel: this.config.audioModel,
            audioApiKey: maskSecret(this.config.audioApiKey),
            audioApiKeySet: this.config.audioApiKey.length > 0,
            routePolicy: this.config.routePolicy,
            allowPrivateUrls: this.config.allowPrivateUrls,
            maxFetchChars: this.config.maxFetchChars,
            maxAudioChars: this.config.maxAudioChars,
            triggerMode: this.config.triggerMode,
            autoCooldownMinutes: this.config.autoCooldownMinutes,
            source: this.file,
        };
    }
}
/** Which local engines are installed (checked lazily by the API). */
export function engineStatus(modelDir, dataDir, exists) {
    return {
        paddle: exists(`${modelDir}/paddleocr/PP-OCRv5_mobile_det_infer.onnx`),
        hunyuan: exists(`${modelDir}/hunyuanocr/HunyuanOCR-Q8_0.gguf`),
        llamaCli: exists(`${dataDir}/llamacpp/llama-mtmd-cli.exe`) || exists(`${dataDir}/llamacpp/llama-mtmd-cli`),
        whisper: exists(`${dataDir}/pyenv/Scripts/python.exe`) || exists(`${dataDir}/pyenv/bin/python`),
    };
}
