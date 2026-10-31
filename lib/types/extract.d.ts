/**
 * Dependency-free readable-text extraction.
 *
 * Deliberately regex based: no DOM library, no jsdom. Good enough to hand a
 * model the prose of a documentation page, and honest about what it dropped.
 */
export interface ExtractOptions {
    maxChars?: number;
    /** Charset taken from the Content-Type header, when present. */
    charset?: string;
}
export interface ExtractedPage {
    title: string;
    text: string;
    /** Total characters seen before truncation. */
    totalChars: number;
    truncated: boolean;
    charset: string;
}
/** Decode the handful of entities that actually appear in prose. */
export declare function decodeEntities(text: string): string;
/** Sniff `<meta charset>` / `charset=` out of the first bytes of a document. */
export declare function sniffCharset(head: string, contentType?: string): string;
/** Decode bytes with the given charset, falling back to UTF-8. */
export declare function decodeBody(bytes: Uint8Array, charset: string): string;
/** Extract readable prose, truncating to `maxChars`. */
export declare function extractReadable(html: string, options?: ExtractOptions): ExtractedPage;
