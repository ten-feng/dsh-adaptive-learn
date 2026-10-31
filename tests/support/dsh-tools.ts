/**
 * Test double for the host-provided `@deepseek-ai/dsh-tools`.
 *
 * The real package only exists inside a running DSH process; tests exercise the
 * same contract through this stub (identity `defineTool` + a recording registry).
 */
export interface StubToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: unknown; render: (args: unknown, value: unknown) => { type: 'text'; text: string }[] }
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

export function defineTool(options: StubToolDefinition): StubToolDefinition {
  if (!options.name || !options.execute) throw new Error('defineTool: name 与 execute 必填')
  return options
}

/** Minimal registry that mirrors `ctx.tools.register`. */
export class FakeToolRegistry {
  readonly tools = new Map<string, StubToolDefinition>()

  register(definition: StubToolDefinition): () => void {
    this.tools.set(definition.name, definition)
    return () => this.tools.delete(definition.name)
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`unknown tool: ${name}`)
    return tool.execute(args, {})
  }
}
