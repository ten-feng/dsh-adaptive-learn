/**
 * Ambient types for the optional local-inference dependencies.
 *
 * They live in `optionalDependencies` and are imported lazily, so a host that
 * never installed them must still typecheck and run. Only the members this
 * plugin touches are described; anything else stays opaque.
 */
declare module 'systeminformation' {
  export interface GraphicsController {
    vendor?: string
    model?: string
    vram?: number | null
    vramDynamic?: boolean | null
  }
  export function graphics(): Promise<{ controllers?: GraphicsController[] }>
  const _default: { graphics: typeof graphics }
  export default _default
}

declare module 'node-llama-cpp' {
  export function getLlama(options?: Record<string, unknown>): Promise<unknown>
  export function loadModel(options: { modelPath: string }): Promise<unknown>
  const _default: Record<string, unknown>
  export default _default
}

declare module 'ppu-paddle-ocr' {
  export class PaddleOcrService {
    constructor(options?: Record<string, unknown>)
    recognize(source: string): Promise<unknown>
  }
  const _default: { PaddleOcrService: typeof PaddleOcrService }
  export default _default
}

declare module 'onnxruntime-node' {
  const _default: Record<string, unknown>
  export default _default
}
