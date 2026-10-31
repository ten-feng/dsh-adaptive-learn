/**
 * Minimal OpenAI-compatible HTTP client.
 *
 * Contract: transports never throw for an upstream failure — they resolve to a
 * structured error the tool can surface as `available:false`. Secrets are only
 * ever placed in the Authorization header and never logged.
 */
export interface HttpErrorBody {
    available: false;
    reason: 'upstream_error' | 'rate_limited' | 'timeout' | 'network_error';
    status?: number;
    message: string;
    retryAfterMs?: number;
}
export type HttpResult<T> = {
    ok: true;
    data: T;
    status: number;
} | {
    ok: false;
    error: HttpErrorBody;
};
export interface HttpOptions {
    apiKey?: string;
    /** Default 60 s. */
    timeoutMs?: number;
    headers?: Record<string, string>;
    /** Test seam. */
    fetchImpl?: typeof fetch;
}
/** POST a JSON body. */
export declare function postJson<T>(url: string, body: unknown, options?: HttpOptions): Promise<HttpResult<T>>;
/** POST multipart/form-data (the file is passed through untouched). */
export declare function postForm<T>(url: string, form: FormData, options?: HttpOptions): Promise<HttpResult<T>>;
/** Redact anything that looks like a credential before it reaches a log. */
export declare function redactHeaders(headers: Record<string, string>): Record<string, string>;
