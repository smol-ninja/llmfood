import * as fs from "node:fs";
import * as path from "node:path";

const GITHUB_URL_PATTERN = /href=["']?(https:\/\/github\.com\/[^\s"'>]+)["']?/g;

const DOC_EXTENSION_PATTERN = /\.(mdx?|md)$/;
const NUMERIC_PREFIX_PATTERN = /^\d+-/;
const FENCED_MERMAID_PATTERN = /```mermaid\n([\s\S]*?)```/g;
const LEADING_WHITESPACE_PATTERN = /^\s+/;
const LOADING_CONTENT_PATTERN =
  /(<(?:div|p|section)[^>]*>)\s*Loading content\.\.\.\s*(<\/(?:div|p|section)>)/g;
const PRIVATE_HOST_PATTERN =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/;
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

export function scanGithubRefs(buildDir: string, urlPaths: string[]): string[] {
  const urls = new Set<string>();

  for (const urlPath of urlPaths) {
    const htmlPath = path.join(buildDir, urlPath.slice(1), "index.html");
    if (!fs.existsSync(htmlPath)) {
      continue;
    }

    const html = fs.readFileSync(htmlPath, "utf-8");
    WRAPPER_PATTERN.lastIndex = 0;
    for (const wrapperMatch of html.matchAll(WRAPPER_PATTERN)) {
      const inner = wrapperMatch[2];
      GITHUB_URL_PATTERN.lastIndex = 0;
      for (const linkMatch of inner.matchAll(GITHUB_URL_PATTERN)) {
        urls.add(linkMatch[1]);
      }
    }
  }

  return [...urls];
}

export async function fetchAllGithubCode(urls: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();

  const tasks = urls.map((url) => async () => {
    const ref = parseGithubRef(url);
    if (!ref) {
      console.warn(`  Warning: could not parse GitHub reference: ${url}`);
      return;
    }

    const code = await fetchGithubCode(ref);
    if (code) {
      resolved.set(url, code);
    }
  });

  await withConcurrencyLimit(tasks, 6);
  return resolved;
}

export type SourcePageData = {
  mermaidBlocks: string[];
  resolvedRemoteContent: string[];
};

export function buildSourceMap(docsDir: string): Map<string, string> {
  const map = new Map<string, string>();

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        let relative = path.relative(docsDir, fullPath);
        relative = relative.replace(DOC_EXTENSION_PATTERN, "");
        if (relative.endsWith("/index") || relative === "index") {
          relative = relative.slice(0, -"/index".length) || ".";
        }
        const stripped = relative
          .split("/")
          .map((seg) => seg.replace(NUMERIC_PREFIX_PATTERN, ""))
          .join("/");
        map.set(stripped, fullPath);
      }
    }
  }

  if (fs.existsSync(docsDir)) {
    walk(docsDir);
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
  FENCED_MERMAID_PATTERN.lastIndex = 0;
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

  REMOTE_URL_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(REMOTE_URL_PATTERN)) {
    const url = match[1];
    if (isSafeRemoteUrl(url)) {
      urls.push(url);
    }
  }

  if (resolveRemoteUrl) {
    REMOTE_JSX_PATTERN.lastIndex = 0;
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
  LOADING_CONTENT_PATTERN.lastIndex = 0;
  return html.replace(LOADING_CONTENT_PATTERN, (match, openTag: string, closeTag: string) => {
    if (contentIndex >= remoteContents.length) {
      return match;
    }
    return `${openTag}${remoteContents[contentIndex++]}${closeTag}`;
  });
}

export async function resolveSourceContent(
  docsDir: string,
  urlPaths: string[],
  resolveRemoteUrl?: (expression: string) => string | undefined
): Promise<Map<string, SourcePageData>> {
  const sourceMap = buildSourceMap(docsDir);
  const result = new Map<string, SourcePageData>();
  const allRemoteUrls = new Set<string>();
  const pageRemoteUrls = new Map<string, string[]>();

  for (const urlPath of urlPaths) {
    const sourcePath = findSourceForUrl(urlPath, sourceMap);
    if (!sourcePath) {
      continue;
    }

    const source = fs.readFileSync(sourcePath, "utf-8");
    const mermaidBlocks = extractMermaidBlocks(source);
    const remoteUrls = extractRemoteUrls(source, resolveRemoteUrl);

    if (mermaidBlocks.length === 0 && remoteUrls.length === 0) {
      continue;
    }

    for (const url of remoteUrls) {
      allRemoteUrls.add(url);
    }
    pageRemoteUrls.set(urlPath, remoteUrls);
    result.set(urlPath, { mermaidBlocks, resolvedRemoteContent: [] });
  }

  if (allRemoteUrls.size > 0) {
    const fetchedContent = new Map<string, string>();
    const tasks = [...allRemoteUrls].map((url) => async () => {
      const ref: GithubRef = { fromLine: 0, rawUrl: url, toLine: Number.POSITIVE_INFINITY };
      const content = await fetchGithubCode(ref);
      if (content) {
        fetchedContent.set(url, content);
      }
    });
    await withConcurrencyLimit(tasks, 6);

    for (const [urlPath, urls] of pageRemoteUrls) {
      const data = result.get(urlPath);
      if (data) {
        data.resolvedRemoteContent = urls
          .map((url) => fetchedContent.get(url))
          .filter((c): c is string => c !== undefined);
      }
    }
  }

  return result;
}

export function replaceGithubCodeblocks(html: string, resolved: Map<string, string>): string {
  WRAPPER_PATTERN.lastIndex = 0;
  return html.replace(WRAPPER_PATTERN, (match, _open, inner: string) => {
    GITHUB_URL_PATTERN.lastIndex = 0;
    const linkMatch = GITHUB_URL_PATTERN.exec(inner);
    if (!linkMatch) {
      return match;
    }

    const githubUrl = linkMatch[1];
    const code = resolved.get(githubUrl);
    if (!code) {
      return match;
    }

    const ref = parseGithubRef(githubUrl);
    const lang = ref ? extToLanguage(ref.rawUrl) : "";
    const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<pre class="prism-code language-${lang}"><code>${escaped}</code></pre>`;
  });
}
