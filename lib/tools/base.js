/**
 * Tool plumbing shared by the six learning tools.
 *
 * A tool is described once, host-independent, then registered with the DSH tool
 * registry. `execute` returns only the canonical JSON its `output.schema`
 * declares; degraded business outcomes are values, not exceptions.
 */
/** Invalid model arguments: an infrastructure-level contract failure. */
export class ToolArgsError extends Error {
    violations;
    constructor(violations) {
        super(`工具参数不合法：${violations.join('；')}`);
        this.name = 'ToolArgsError';
        this.violations = violations;
    }
}
function typeMatches(type, value) {
    switch (type) {
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'array':
            return Array.isArray(value);
        case 'object':
            return typeof value === 'object' && value !== null && !Array.isArray(value);
        default:
            return false;
    }
}
/**
 * Validate model arguments against a parameter map.
 * @throws ToolArgsError with one violation per offending field.
 */
export function assertArgs(parameters, args) {
    const violations = [];
    const record = (args ?? {});
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        throw new ToolArgsError(['arguments 必须是对象']);
    }
    for (const [key, spec] of Object.entries(parameters)) {
        const value = record[key];
        if (value === undefined || value === null || value === '') {
            if (spec.required)
                violations.push(`缺少必填参数 ${key}`);
            continue;
        }
        if (!typeMatches(spec.type, value)) {
            violations.push(`参数 ${key} 应为 ${spec.type}`);
            continue;
        }
        if (spec.enum && typeof value === 'string' && !spec.enum.includes(value)) {
            violations.push(`参数 ${key} 只能是 ${spec.enum.join('/')}`);
        }
    }
    if (violations.length > 0)
        throw new ToolArgsError(violations);
    return record;
}
/** A model-facing text projection for any canonical value. */
export function jsonRender(value) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}
/**
 * Shorthand for an object output schema.
 *
 * The host compiles `output.schema` as an author-facing ValueSchemaSpec, so
 * requiredness is a per-property `required: true` annotation and openness is
 * mandatory — never a JSON-Schema `required: []` array.
 */
export function objectSchema(properties, required) {
    const marked = {};
    for (const [key, node] of Object.entries(properties)) {
        marked[key] = required?.includes(key) ? { ...node, required: true } : node;
    }
    return { type: 'object', properties: marked, additionalProperties: true };
}
