import * as fs from "node:fs";
import * as path from "node:path";

const CODEBLOCK_JSX_PATTERN = /\{\s*`\s*(https:\/\/github\.com\/[^`\s]+)\s*`\s*\}\s*<\/CodeBlock>/g;
const CODEBLOCK_FENCED_PATTERN =
  /```\w+\s+reference\s+title="[^"]*"\s*\n\s*(https:\/\/github\.com\/\S+)\s*\n```/g;

const MDX_IMPORT_PATTERN = /^import\s+\w+\s+from\s+["']([^"']+\.mdx?)["']/gm;

const DOC_EXTENSION_PATTERN = /\.(mdx?|md)$/;
const FRONTMATTER_ID_PATTERN = /^---\s*\n[\s\S]*?^id:\s*["']([^"'\n]+)["']/m;
const NUMERIC_PREFIX_PATTERN = /^\d+-/;
const FENCED_MERMAID_PATTERN = /```mermaid\n([\s\S]*?)```/g;
const LEADING_WHITESPACE_PATTERN = /^\s+/;
const LOADING_CONTENT_PATTERN =
  /(<(?:div|p|section)[^>]*>)\s*Loading content\.\.\.\s*(<\/(?:div|p|section)>)/g;
const PRIVATE_HOST_PATTERN =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[::1\]|\[::ffff:|\[fc|\[fd|\[fe)/;
const REMOTE_URL_PATTERN = /url=["'](https?:\/\/[^"']+)["']/g;
const REMOTE_JSX_PATTERN = /url=\{([^}]+)\}/g;
const SOURCE_EXTENSIONS = [".md", ".mdx"];
const WRAPPER_PATTERN =
  /(<div[^>]*class=["']?[^"'>]*docusaurus-theme-github-codeblock[^"'>]*["']?[^>]*>)([\s\S]*?)(<\/div>\s*<\/div>\s*<\/div>)/g;

const EXT_TO_LANGUAGE: Record<string, string> = {
  bash: "bash",
  css: "css",
  go: "go",
  html: "html",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  md: "markdown",
  py: "python",
  rs: "rust",
  sh: "bash",
  sol: "solidity",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  yaml: "yaml",
  yml: "yaml",
};

type GithubRef = {
  fromLine: number;
  rawUrl: string;
  toLine: number;
};

export function parseGithubRef(githubUrl: string): GithubRef | undefined {
  let url: URL;
  try {
    url = new URL(githubUrl);
  } catch {
    return undefined;
  }

  const parts = url.pathname.split("/").slice(1);
  if (parts.length < 5 || parts[2] !== "blob") {
    return undefined;
  }

  const [org, repo, , branch, ...pathSeg] = parts;
  const hash = url.hash?.slice(1) ?? "";
  let fromLine = 0;
  let toLine = Number.POSITIVE_INFINITY;

  if (hash) {
    const lineParts = hash.split("-");
    fromLine = Number.parseInt(lineParts[0].slice(1), 10) - 1;
    toLine =
      lineParts.length > 1
        ? Number.parseInt(lineParts[1].slice(1), 10) - 1
        : Number.POSITIVE_INFINITY;
  }

  return {
    fromLine: Number.isNaN(fromLine) ? 0 : fromLine,
    rawUrl: `https://raw.githubusercontent.com/${org}/${repo}/${branch}/${pathSeg.join("/")}`,
    toLine: Number.isNaN(toLine) ? Number.POSITIVE_INFINITY : toLine,
  };
}

function extToLanguage(filePath: string): string {
  const ext = filePath.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? ext;
}

function dedent(lines: string[]): string {
  const indent = lines.reduce((prev, line) => {
    if (line.length === 0) {
      return prev;
    }
    const spaces = line.match(LEADING_WHITESPACE_PATTERN);
    return spaces ? Math.min(prev, spaces[0].length) : 0;
  }, Number.POSITIVE_INFINITY);
  const shift = indent === Number.POSITIVE_INFINITY ? 0 : indent;
  return lines.map((line) => line.slice(shift)).join("\n");
}

async function fetchGithubCode(ref: GithubRef): Promise<string> {
  let res: Response;
  try {
    res = await fetch(ref.rawUrl, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`  Warning: fetch failed for ${ref.rawUrl} (${reason})`);
    return "";
  }

  if (!res.ok) {
    console.warn(`  Warning: failed to fetch ${ref.rawUrl} (HTTP ${res.status})`);
    return "";
  }

  const text = await res.text();
  const lines = text.split("\n");
  const end = ref.toLine === Number.POSITIVE_INFINITY ? undefined : ref.toLine + 1;
  const slice = lines.slice(ref.fromLine, end);

  if (slice.length === 0) {
    return "";
  }

  return dedent(slice);
}

async function withConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const i = index++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        /* v8 ignore next */
        results[i] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

export function inlineImportedSnippets(source: string, sourceDir: string): string {
  const imports: string[] = [];
  for (const match of source.matchAll(MDX_IMPORT_PATTERN)) {
    const importPath = match[1];
    if (!importPath.startsWith(".")) {
      continue;
    }
    const resolved = path.resolve(sourceDir, importPath);
    if (fs.existsSync(resolved)) {
      imports.push(fs.readFileSync(resolved, "utf-8"));
    }
  }
  if (imports.length === 0) {
    return source;
  }
  return `${source}\n${imports.join("\n")}`;
}

export function extractGithubRefs(source: string): string[] {
  const urls: string[] = [];

  for (const match of source.matchAll(CODEBLOCK_JSX_PATTERN)) {
    urls.push(match[1]);
  }
  for (const match of source.matchAll(CODEBLOCK_FENCED_PATTERN)) {
    urls.push(match[1]);
  }

  return urls;
}

export type SourcePageData = {
  githubUrls: string[];
  mermaidBlocks: string[];
  resolvedCode: string[];
  resolvedRemoteContent: string[];
};

function extractFrontmatterId(filePath: string): string | undefined {
  const content = fs.readFileSync(filePath, "utf-8");
  return content.match(FRONTMATTER_ID_PATTERN)?.[1];
}

function sourceMapKey(docsDir: string, fullPath: string): string {
  let relative = path.relative(docsDir, fullPath);
  relative = relative.replace(DOC_EXTENSION_PATTERN, "");
  if (relative.endsWith("/index") || relative === "index") {
    relative = relative.slice(0, -"/index".length) || ".";
  }
  return relative
    .split("/")
    .map((seg) => seg.replace(NUMERIC_PREFIX_PATTERN, ""))
    .join("/");
}

function walkSourceFiles(dir: string, docsDir: string, map: Map<string, string>): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(fullPath, docsDir, map);
      continue;
    }
    if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      continue;
    }
    const key = sourceMapKey(docsDir, fullPath);
    map.set(key, fullPath);

    const id = extractFrontmatterId(fullPath);
    if (id) {
      const parentDir = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
      map.set(parentDir ? `${parentDir}/${id}` : id, fullPath);
    }
  }
}

export function buildSourceMap(docsDir: string): Map<string, string> {
  const map = new Map<string, string>();
  if (fs.existsSync(docsDir)) {
    walkSourceFiles(docsDir, docsDir, map);
  }
  return map;
}

export function findSourceForUrl(
  urlPath: string,
  sourceMap: Map<string, string>
): string | undefined {
  const segments = urlPath.split("/").filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    const candidate = segments.slice(i).join("/");
    const filePath = sourceMap.get(candidate);
    if (filePath) {
      return filePath;
    }
  }
  return undefined;
}

export function extractMermaidBlocks(source: string): string[] {
  const blocks: string[] = [];
  for (const match of source.matchAll(FENCED_MERMAID_PATTERN)) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

function isSafeRemoteUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") {
      return false;
    }
    return !PRIVATE_HOST_PATTERN.test(url.hostname);
  } catch {
    /* v8 ignore next */
    return false;
  }
}

export function extractRemoteUrls(
  source: string,
  resolveRemoteUrl?: (expression: string) => string | undefined
): string[] {
  const urls: string[] = [];

  for (const match of source.matchAll(REMOTE_URL_PATTERN)) {
    const url = match[1];
    if (isSafeRemoteUrl(url)) {
      urls.push(url);
    }
  }

  if (resolveRemoteUrl) {
    for (const match of source.matchAll(REMOTE_JSX_PATTERN)) {
      const resolved = resolveRemoteUrl(match[1]);
      if (resolved && isSafeRemoteUrl(resolved)) {
        urls.push(resolved);
      }
    }
  }

  return urls;
}

export function injectMermaidBlocks(html: string, mermaidBlocks: string[]): string {
  if (mermaidBlocks.length === 0) {
    return html;
  }

  const injection = mermaidBlocks
    .map((block) => {
      const escaped = block.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<pre class="prism-code language-mermaid"><code>${escaped}</code></pre>`;
    })
    .join("\n");

  const closeTag = "</article>";
  const idx = html.lastIndexOf(closeTag);
  if (idx === -1) {
    return html;
  }
  return `${html.slice(0, idx)}${injection}${html.slice(idx)}`;
}

export function replaceLoadingContent(html: string, remoteContents: string[]): string {
  if (remoteContents.length === 0) {
    return html;
  }

  let contentIndex = 0;
  return html.replace(LOADING_CONTENT_PATTERN, (match, openTag: string, closeTag: string) => {
    if (contentIndex >= remoteContents.length) {
      return match;
    }
    return `${openTag}${remoteContents[contentIndex++]}${closeTag}`;
  });
}

async function fetchUrls(urls: Set<string>): Promise<Map<string, string>> {
  const fetched = new Map<string, string>();
  const tasks = [...urls].map((url) => async () => {
    const ref = parseGithubRef(url) ?? {
      fromLine: 0,
      rawUrl: url,
      toLine: Number.POSITIVE_INFINITY,
    };
    const content = await fetchGithubCode(ref);
    if (content) {
      fetched.set(url, content);
    }
  });
  await withConcurrencyLimit(tasks, 6);
  return fetched;
}

function distributeResolved(
  pageUrls: Map<string, string[]>,
  fetched: Map<string, string>
): Map<string, string[]> {
  const distributed = new Map<string, string[]>();
  for (const [urlPath, urls] of pageUrls) {
    distributed.set(
      urlPath,
      urls.map((url) => fetched.get(url)).filter((c): c is string => c !== undefined)
    );
  }
  return distributed;
}

export async function resolveSourceContent(
  docsDir: string,
  urlPaths: string[],
  resolveRemoteUrl?: (expression: string) => string | undefined
): Promise<Map<string, SourcePageData>> {
  const sourceMap = buildSourceMap(docsDir);
  const result = new Map<string, SourcePageData>();
  const allFetchUrls = new Set<string>();
  const pageGithubUrls = new Map<string, string[]>();
  const pageRemoteUrls = new Map<string, string[]>();

  for (const urlPath of urlPaths) {
    const sourcePath = findSourceForUrl(urlPath, sourceMap);
    if (!sourcePath) {
      continue;
    }

    const rawSource = fs.readFileSync(sourcePath, "utf-8");
    const source = inlineImportedSnippets(rawSource, path.dirname(sourcePath));
    const mermaidBlocks = extractMermaidBlocks(source);
    const githubUrls = extractGithubRefs(source);
    const remoteUrls = extractRemoteUrls(source, resolveRemoteUrl);

    if (mermaidBlocks.length === 0 && githubUrls.length === 0 && remoteUrls.length === 0) {
      continue;
    }

    for (const url of githubUrls) {
      allFetchUrls.add(url);
    }
    for (const url of remoteUrls) {
      allFetchUrls.add(url);
    }
    pageGithubUrls.set(urlPath, githubUrls);
    pageRemoteUrls.set(urlPath, remoteUrls);
    result.set(urlPath, {
      githubUrls,
      mermaidBlocks,
      resolvedCode: [],
      resolvedRemoteContent: [],
    });
  }

  if (allFetchUrls.size > 0) {
    const fetched = await fetchUrls(allFetchUrls);
    const resolvedCodeMap = distributeResolved(pageGithubUrls, fetched);
    const resolvedRemoteMap = distributeResolved(pageRemoteUrls, fetched);

    for (const [urlPath, data] of result) {
      data.resolvedCode = resolvedCodeMap.get(urlPath) ?? [];
      data.resolvedRemoteContent = resolvedRemoteMap.get(urlPath) ?? [];
    }
  }

  return result;
}

export function replaceGithubCodeblocks(
  html: string,
  resolvedCode: string[],
  githubUrls: string[]
): string {
  if (resolvedCode.length === 0) {
    return html;
  }

  let codeIndex = 0;
  return html.replace(WRAPPER_PATTERN, (match) => {
    if (codeIndex >= resolvedCode.length) {
      return match;
    }

    const code = resolvedCode[codeIndex];
    const url = githubUrls[codeIndex];
    codeIndex++;

    const ref = url ? parseGithubRef(url) : undefined;
    const lang = ref ? extToLanguage(ref.rawUrl) : "";
    const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<pre class="prism-code language-${lang}"><code>${escaped}</code></pre>`;
  });
}
