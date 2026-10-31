/**
 * Local type surface for the host-provided `@deepseek-ai/dsh-tools` package.
 *
 * The real package is a runtime peer dependency injected by DSH; only the shape
 * this plugin touches is declared here so `tsc` can build without pulling the
 * whole DSH tool stack (and its private peers) into this package's install.
 */
declare module '@deepseek-ai/dsh-tools' {
  /** Per-property parameter declaration accepted by `defineTool`. */
  export interface ParameterPropertySpec {
    type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'
    required?: boolean
    description?: string
    enum?: readonly (string | number | boolean)[]
    items?: ParameterPropertySpec
    properties?: Record<string, ParameterPropertySpec>
    additionalProperties?: boolean
    default?: unknown
  }

  export type ParameterSchemaSpec = Record<string, ParameterPropertySpec>

  export interface ToolOutputDefinition {
    schema: unknown
    render(args: unknown, value: unknown): { type: 'text'; text: string }[]
  }

  export interface ToolDefinition {
    name: string
    description: string
    parameters: ParameterSchemaSpec
    output: ToolOutputDefinition
    execute(args: unknown, exec: unknown): Promise<unknown>
  }

  export interface DefineToolOptions {
    name: string
    description: string
    parameters: ParameterSchemaSpec
    output: ToolOutputDefinition
    execute(args: unknown, exec: unknown): Promise<unknown>
  }

  export function defineTool(options: DefineToolOptions): ToolDefinition
  export function validateArgs(spec: ParameterSchemaSpec, args: unknown): string[]
  export class ToolArgsError extends Error {
    readonly violations: string[]
  }
}
