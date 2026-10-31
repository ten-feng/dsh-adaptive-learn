/**
 * Two-tier knowledge base.
 *
 *   _knowledge/staged/  drafts written during one task — never recalled
 *   _knowledge/pages/   committed entries — the only recall source
 *
 * An entry is a markdown file with a JSON front-matter block, which keeps the
 * store readable by a human and machine-parseable without a YAML dependency.
 */
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { jsonRender, objectSchema } from './base.js';
export class WikiSourceRequiredError extends Error {
    code = 'WIKI_SOURCE_REQUIRED';
    constructor(title) {
        super(`拒绝提交「${title}」：staged 条目没有任何来源（sources 为空）。请先补充网页/图片/音视频来源再提交。`);
        this.name = 'WikiSourceRequiredError';
    }
}
const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
function slugify(title) {
    const slug = title
        .trim()
        .toLowerCase()
        .replace(/[\s/\\:*?"<>|]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '');
    return slug || `entry-${Date.now()}`;
}
function serialize(entry) {
    const meta = {
        title: entry.title,
        slug: entry.slug,
        sources: entry.sources,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        committedAt: entry.committedAt,
    };
    return `---\n${JSON.stringify(meta, null, 2)}\n---\n\n${entry.content.trim()}\n`;
}
export function parseEntry(text) {
    const match = FRONT.exec(text);
    if (!match)
        return null;
    try {
        const meta = JSON.parse(match[1] ?? '{}');
        if (!meta.title)
            return null;
        return {
            title: meta.title,
            slug: meta.slug ?? slugify(meta.title),
            content: text.slice(match[0].length).trim(),
            sources: Array.isArray(meta.sources) ? meta.sources : [],
            createdAt: meta.createdAt ?? new Date(0).toISOString(),
            updatedAt: meta.updatedAt,
            committedAt: meta.committedAt,
        };
    }
    catch {
        return null;
    }
}
function tokenize(query) {
    const words = query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 0);
    const grams = [];
    for (const word of words) {
        if (/[\u4e00-\u9fff]/.test(word)) {
            if (word.length === 1)
                grams.push(word);
            for (let index = 0; index < word.length - 1; index += 1)
                grams.push(word.slice(index, index + 2));
        }
        else {
            grams.push(word);
        }
    }
    return [...new Set(grams)];
}
export class WikiStore {
    rootDir;
    options;
    pagesDir;
    stagedDir;
    constructor(rootDir, options = {}) {
        this.rootDir = rootDir;
        this.options = options;
        this.pagesDir = join(rootDir, 'pages');
        this.stagedDir = join(rootDir, 'staged');
    }
    /** Nothing is created until the first write. */
    async ensure(tier) {
        const dir = tier === 'pages' ? this.pagesDir : this.stagedDir;
        await mkdir(dir, { recursive: true });
        return dir;
    }
    async entries(tier) {
        const dir = tier === 'pages' ? this.pagesDir : this.stagedDir;
        if (!existsSync(dir))
            return [];
        const files = await readdir(dir).catch(() => []);
        const out = [];
        for (const file of files) {
            if (!file.endsWith('.md'))
                continue;
            const text = await readFile(join(dir, file), 'utf8').catch(() => '');
            const entry = parseEntry(text);
            if (entry)
                out.push(entry);
        }
        return out;
    }
    /** Recall hits only from the committed tier. */
    async recall(query, limit = 5) {
        const tokens = tokenize(query);
        if (tokens.length === 0)
            return [];
        const scored = [];
        for (const entry of await this.entries('pages')) {
            const haystack = `${entry.title}\n${entry.content}`.toLowerCase();
            let score = 0;
            for (const token of tokens) {
                const occurrences = haystack.split(token).length - 1;
                if (occurrences > 0)
                    score += occurrences * (entry.title.toLowerCase().includes(token) ? 3 : 1);
            }
            if (score === 0)
                continue;
            scored.push({
                title: entry.title,
                slug: entry.slug,
                score,
                excerpt: entry.content.slice(0, 400),
                sources: entry.sources,
                updatedAt: entry.committedAt ?? entry.updatedAt ?? entry.createdAt,
            });
        }
        return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    }
    /** Write a draft into the staged tier; pending entries never participate in recall. */
    async stage(input) {
        const dir = await this.ensure('staged');
        const title = (input.title?.trim() || input.content.trim().split(/\r?\n/)[0]?.slice(0, 60) || '未命名条目').trim();
        const existing = await this.entries('staged');
        let slug = slugify(title);
        let counter = 2;
        while (existing.some((entry) => entry.slug === slug) || existsSync(join(dir, `${slug}.md`))) {
            slug = `${slugify(title)}-${counter}`;
            counter += 1;
        }
        const entry = {
            title,
            slug,
            content: input.content.trim(),
            sources: input.sources,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await writeFile(join(dir, `${slug}.md`), serialize(entry), 'utf8');
        return entry;
    }
    /** Find one staged entry by slug first, then by exact title. */
    async findStaged(identifier) {
        const entries = await this.entries('staged');
        const bySlug = entries.find((entry) => entry.slug === identifier);
        if (bySlug)
            return bySlug;
        return entries.find((entry) => entry.title === identifier) ?? null;
    }
    /**
     * Promote a staged entry into the recallable tier.
     * @throws WikiSourceRequiredError when the entry has no sources and the policy demands one.
     */
    async commit(identifier) {
        const entry = await this.findStaged(identifier);
        if (!entry)
            throw new Error(`staged 中找不到条目：${identifier}`);
        if ((this.options.requireSource ?? true) && entry.sources.length === 0) {
            throw new WikiSourceRequiredError(entry.title);
        }
        const pages = await this.ensure('pages');
        const committed = {
            ...entry,
            committedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await writeFile(join(pages, `${entry.slug}.md`), serialize(committed), 'utf8');
        await unlink(join(this.stagedDir, `${entry.slug}.md`)).catch(() => undefined);
        return committed;
    }
    /** Staged entries, for a "what is pending?" listing. */
    async listStaged() {
        return this.entries('staged');
    }
    /** Committed entries, for a "what do we know?" listing. */
    async listPages() {
        return this.entries('pages');
    }
}
const SOURCE_TYPES = ['web', 'image', 'video', 'audio'];
function normalizeSources(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (typeof item === 'string') {
            out.push({ type: 'web', ref: item, engine: 'manual' });
            continue;
        }
        if (!item || typeof item !== 'object')
            continue;
        const record = item;
        const type = SOURCE_TYPES.includes(record.type) ? record.type : 'web';
        const ref = String(record.ref ?? record.url ?? '').trim();
        if (!ref)
            continue;
        out.push({
            type,
            ref,
            engine: String(record.engine ?? 'unknown'),
            title: record.title === undefined ? undefined : String(record.title),
            fetchedAt: record.fetchedAt === undefined ? undefined : String(record.fetchedAt),
        });
    }
    return out;
}
/** The three knowledge-base tools. */
export function createWikiTools(deps) {
    const wikiOf = (exec) => deps.getWiki(exec?.agent?.session);
    return [
        {
            name: 'self_learn_wiki_recall',
            description: '在已确认的知识库（pages）里检索已有结论。只查已提交的页面，不查 staged 草稿。',
            parameters: {
                query: { type: 'string', required: true, description: '要检索的问题或关键词' },
            },
            output: {
                schema: objectSchema({
                    available: { type: 'boolean' },
                    count: { type: 'number' },
                    hits: { type: 'array', items: { type: 'object', additionalProperties: true } },
                }, ['available', 'count']),
                render: jsonRender,
            },
            async execute(args, exec) {
                const wiki = wikiOf(exec);
                const hits = await wiki.recall(String(args.query ?? ''), 5);
                return { available: true, count: hits.length, hits };
            },
        },
        {
            name: 'self_learn_wiki_stage',
            description: '把本次学习的结论和来源写入 staged 草稿。staged 不参与召回；确认有效后再用 self_learn_wiki_commit 升入正式知识库。',
            parameters: {
                content: { type: 'string', required: true, description: '结论正文（可含小标题、要点）' },
                sources: {
                    type: 'array',
                    required: true,
                    description: '来源列表，每项含 type(web/image/video/audio)、ref（URL 或标识）、engine',
                    items: { type: 'object', additionalProperties: true },
                },
                title: { type: 'string', description: '条目标题，缺省取正文首行' },
            },
            output: {
                schema: objectSchema({
                    available: { type: 'boolean' },
                    status: { type: 'string' },
                    title: { type: 'string' },
                    slug: { type: 'string' },
                    path: { type: 'string' },
                    sourceCount: { type: 'number' },
                }, ['available', 'status']),
                render: jsonRender,
            },
            async execute(args, exec) {
                const wiki = wikiOf(exec);
                const sources = normalizeSources(args.sources);
                const entry = await wiki.stage({
                    title: args.title === undefined ? undefined : String(args.title),
                    content: String(args.content ?? ''),
                    sources,
                });
                return {
                    available: true,
                    status: 'staged',
                    title: entry.title,
                    slug: entry.slug,
                    path: join(wiki.stagedDir, `${entry.slug}.md`),
                    sourceCount: entry.sources.length,
                };
            },
        },
        {
            name: 'self_learn_wiki_commit',
            description: '把一条 staged 草稿升入正式知识库（pages）；没有来源的草稿会被拒绝。',
            parameters: {
                title: { type: 'string', required: true, description: 'staged 条目的 slug 或标题' },
            },
            output: {
                schema: objectSchema({
                    available: { type: 'boolean' },
                    status: { type: 'string' },
                    title: { type: 'string' },
                    slug: { type: 'string' },
                    path: { type: 'string' },
                    sourceCount: { type: 'number' },
                    reason: { type: 'string' },
                    message: { type: 'string' },
                }, ['available', 'status']),
                render: jsonRender,
            },
            async execute(args, exec) {
                const wiki = wikiOf(exec);
                const identifier = String(args.title ?? '');
                try {
                    const entry = await wiki.commit(identifier);
                    return {
                        available: true,
                        status: 'committed',
                        title: entry.title,
                        slug: entry.slug,
                        path: join(wiki.pagesDir, `${entry.slug}.md`),
                        sourceCount: entry.sources.length,
                    };
                }
                catch (error) {
                    const sourceRequired = error?.code === 'WIKI_SOURCE_REQUIRED';
                    return {
                        available: false,
                        status: 'rejected',
                        reason: sourceRequired ? 'sources_required' : 'not_found',
                        message: error?.message ?? 'unknown',
                    };
                }
            },
        },
    ];
}
