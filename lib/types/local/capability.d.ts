export type GpuDetectionMethod = 'nvidia-smi' | 'systeminformation' | 'none';
export type AsrModelSuggestion = 'small' | 'medium' | 'large-v3-turbo';
export type AsrComputeType = 'int8_float32' | 'float16';
export interface GpuInfo {
    available: boolean;
    vendor: string;
    name: string;
    vramTotalMB: number;
    vramFreeMB: number;
    /** CUDA compute capability of the first device, when nvidia-smi reports it. */
    cudaCapability: number | null;
    detectionMethod: GpuDetectionMethod;
}
export interface CpuInfo {
    cores: number;
    arch: string;
}
export interface LocalCapability {
    gpu: GpuInfo;
    cpu: CpuInfo;
    memoryFreeMB: number;
    localOcrReady: boolean;
    localAsrReady: boolean;
    localAsrModelSuggestion: AsrModelSuggestion;
    /** INT8 is forced on pre-Volta parts (compute capability < 7.0). */
    localAsrComputeType: AsrComputeType;
    probedAt: number;
    /** Set when the latest probe failed and this is the last known good snapshot. */
    stale?: boolean;
}
export interface ProbeOptions {
    /** Test seam: run one command and return stdout. */
    exec?: (command: string, args: string[]) => Promise<string>;
    /** Test seam: graphics fallback (defaults to `systeminformation`). */
    graphics?: () => Promise<GraphicsController[]>;
    /** Test seam: clock. */
    now?: () => number;
    ocrMinVramMB?: number;
    asrMinVramMB?: number;
    /** Force a Whisper size instead of deriving one from VRAM. */
    localAsrModel?: 'auto' | AsrModelSuggestion;
    timeoutMs?: number;
}
export interface GraphicsController {
    vendor?: string;
    model?: string;
    vram?: number | null;
    vramDynamic?: boolean | null;
}
/** Parse one `name, total, free, compute_cap` line (units are stripped by nvidia-smi). */
export declare function parseNvidiaSmi(stdout: string): GpuInfo | null;
/** Suggest the largest Whisper size the free VRAM can plausibly hold. */
export declare function suggestAsrModel(vramFreeMB: number): AsrModelSuggestion;
export declare function computeReadiness(gpu: GpuInfo, config: Pick<ProbeOptions, 'ocrMinVramMB' | 'asrMinVramMB' | 'localAsrModel'>): Pick<LocalCapability, 'localOcrReady' | 'localAsrReady' | 'localAsrModelSuggestion' | 'localAsrComputeType'>;
/** Probe once. Never throws: an unreadable host is reported as "no GPU". */
export declare function probeCapability(options?: ProbeOptions): Promise<LocalCapability>;
export interface CapabilityCacheOptions extends ProbeOptions {
    /** Where the JSON snapshot lives (the plugin data dir). */
    file: string;
    /** Reserved: kept for config compatibility. */
    ttlMs?: number;
    /** Reserved: kept for config compatibility. */
    slowProbeMs?: number;
    /** Reuse the last probe result within this window (default 10 s). */
    dedupeMs?: number;
    /** When the host reports no GPU, skip probing again for this long (default 60 s). */
    noGpuCacheMs?: number;
    /** A last-known-good snapshot is only reused within this age when a probe fails. */
    fallbackMaxAgeMs?: number;
    read?: (file: string) => Promise<string | null>;
    write?: (file: string, data: string) => Promise<void>;
}
/**
 * Capability provider.
 *
 * Tools ask for the capability on every call. Repeated asks within
 * `dedupeMs` reuse the last answer (default 10 s), and a host that reports no
 * GPU at all is not probed again for `noGpuCacheMs` — on such a machine the
 * `systeminformation` fallback is the expensive part, and it will not start
 * returning a GPU one minute later anyway.
 *
 * A probe that *fails* keeps the last good snapshot (≤ 24 h) and marks it
 * `stale` instead of pretending the machine has no GPU. `probe(true)` bypasses
 * both windows for a forced diagnostic refresh.
 */
export declare class CapabilityCache {
    private readonly options;
    private snapshot;
    private loaded;
    private inflight;
    private lastProbeAt;
    constructor(options?: CapabilityCacheOptions);
    private get dedupeMs();
    private get noGpuCacheMs();
    private get fallbackMaxAgeMs();
    private readSnapshot;
    private persist;
    /**
     * Probe the host.
     *
     * Concurrent callers share one run. A result younger than `dedupeMs` is
     * reused, and a "no GPU here" answer is reused for `noGpuCacheMs` so a
     * GPU-less host does not pay the `systeminformation` fallback on every call.
     * `force` skips both windows.
     */
    probe(force?: boolean): Promise<LocalCapability>;
    /** Capability for the current call (probed at most once per `dedupeMs`). */
    get(): Promise<LocalCapability>;
}
