import { describe, expect, it } from 'vitest'
import type { LocalCapability } from '../../src/local/capability.js'

/** Build a capability snapshot for routing tests. */
export function capability(overrides: Partial<LocalCapability> = {}): LocalCapability {
  return {
    gpu: {
      available: true,
      vendor: 'nvidia',
      name: 'Test GPU',
      vramTotalMB: 8192,
      vramFreeMB: 6000,
      cudaCapability: 8.6,
      detectionMethod: 'nvidia-smi',
    },
    cpu: { cores: 8, arch: 'x64' },
    memoryFreeMB: 16384,
    localOcrReady: true,
    localAsrReady: true,
    localAsrModelSuggestion: 'large-v3-turbo',
    localAsrComputeType: 'float16',
    probedAt: 1_700_000_000_000,
    ...overrides,
  }
}

/** A capability with no GPU at all (probe failed). */
export function noGpuCapability(): LocalCapability {
  return capability({
    gpu: {
      available: false,
      vendor: 'none',
      name: '',
      vramTotalMB: 0,
      vramFreeMB: 0,
      cudaCapability: null,
      detectionMethod: 'none',
    },
    localOcrReady: false,
    localAsrReady: false,
  })
}
