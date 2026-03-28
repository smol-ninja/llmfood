import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSourceMap,
  extractMermaidBlocks,
  extractRemoteUrls,
  fetchAllGithubCode,
  findSourceForUrl,
  parseGithubRef,
  replaceGithubCodeblocks,
  replaceLoadingContent,
  replaceMermaidSvgs,
  resolveSourceContent,
  scanGithubRefs,
} from "../src/resolve.js";

describe("parseGithubRef", () => {
  it("parses a standard blob URL with line range", () => {
    const ref = parseGithubRef(
      "https://github.com/sablier-labs/v2-core/blob/main/src/SablierFlow.sol#L10-L20"
    );
    expect(ref).toEqual({
      fromLine: 9,
      rawUrl: "https://raw.githubusercontent.com/sablier-labs/v2-core/main/src/SablierFlow.sol",
      toLine: 19,
    });
  });

  it("parses a single-line reference", () => {
    const ref = parseGithubRef("https://github.com/org/repo/blob/v2.0.0/file.ts#L5");
    expect(ref).toEqual({
      fromLine: 4,
      rawUrl: "https://raw.githubusercontent.com/org/repo/v2.0.0/file.ts",
      toLine: Number.POSITIVE_INFINITY,
    });
  });

  it("parses a URL with no line range (full file)", () => {
    const ref = parseGithubRef("https://github.com/org/repo/blob/main/src/index.ts");
    expect(ref).toEqual({
      fromLine: 0,
      rawUrl: "https://raw.githubusercontent.com/org/repo/main/src/index.ts",
      toLine: Number.POSITIVE_INFINITY,
    });
  });

  it("parses a deep nested path", () => {
    const ref = parseGithubRef(
      "https://github.com/org/repo/blob/feat/branch/packages/core/src/deep/file.ts#L1-L100"
    );
    expect(ref).toEqual({
      fromLine: 0,
      rawUrl:
        "https://raw.githubusercontent.com/org/repo/feat/branch/packages/core/src/deep/file.ts",
      toLine: 99,
    });
  });

  it("returns undefined for invalid URL", () => {
    expect(parseGithubRef("not-a-url")).toBeUndefined();
  });

  it("returns undefined for non-blob GitHub URL", () => {
    expect(parseGithubRef("https://github.com/org/repo/tree/main")).toBeUndefined();
  });

  it("returns undefined for URL with too few path segments", () => {
    expect(parseGithubRef("https://github.com/org/repo")).toBeUndefined();
  });

  it("handles malformed line hash gracefully", () => {
    const ref = parseGithubRef("https://github.com/org/repo/blob/main/file.ts#Lbad-Lworse");
    expect(ref).toBeDefined();
    expect(ref!.fromLine).toBe(0);
    expect(ref!.toLine).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("scanGithubRefs", () => {
  let tmpDir: string;
  let buildDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmfood-resolve-test-"));
    buildDir = path.join(tmpDir, "build");
    fs.mkdirSync(buildDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  function writePage(urlPath: string, html: string): void {
    const dir = path.join(buildDir, urlPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html);
  }

  it("extracts GitHub URLs from githubLink anchors (href before class)", () => {
    writePage(
      "docs/test",
      `<div class="docusaurus-theme-github-codeblock">
        <pre><code>loading...</code></pre>
        <a href="https://github.com/org/repo/blob/main/file.ts#L1-L5" class="githubLink" target="_blank">View on GitHub</a>
      </div></div></div>`
    );
    const refs = scanGithubRefs(buildDir, ["/docs/test"]);
    expect(refs).toEqual(["https://github.com/org/repo/blob/main/file.ts#L1-L5"]);
  });

  it("extracts GitHub URLs from githubLink anchors (class before href)", () => {
    writePage(
      "docs/test",
      `<div class="docusaurus-theme-github-codeblock">
        <pre><code>loading...</code></pre>
        <a class="githubLink" style="margin: 0" href="https://github.com/org/repo/blob/main/file.ts#L10-L20" target="_blank">GitHub</a>
      </div></div></div>`
    );
    const refs = scanGithubRefs(buildDir, ["/docs/test"]);
    expect(refs).toEqual(["https://github.com/org/repo/blob/main/file.ts#L10-L20"]);
  });

  it("deduplicates URLs referenced on multiple pages", () => {
    const html = `<div class="docusaurus-theme-github-codeblock">
      <a href="https://github.com/org/repo/blob/main/same.ts#L1-L5" class="githubLink">Link</a>
    </div></div></div>`;
    writePage("docs/a", html);
    writePage("docs/b", html);
    const refs = scanGithubRefs(buildDir, ["/docs/a", "/docs/b"]);
    expect(refs).toHaveLength(1);
  });

  it("returns empty array when no patterns found", () => {
    writePage("docs/plain", "<article><p>No code blocks here</p></article>");
    expect(scanGithubRefs(buildDir, ["/docs/plain"])).toEqual([]);
  });

  it("skips missing HTML files", () => {
    expect(scanGithubRefs(buildDir, ["/docs/nonexistent"])).toEqual([]);
  });

  it("finds multiple references on the same page", () => {
    writePage(
      "docs/multi",
      `<div class="docusaurus-theme-github-codeblock">
        <a href="https://github.com/org/repo/blob/main/a.ts#L1-L5" class="githubLink">Link</a>
      </div></div></div>
      <div class="docusaurus-theme-github-codeblock">
        <a href="https://github.com/org/repo/blob/main/b.ts#L10-L20" class="githubLink">Link</a>
      </div></div></div>`
    );
    const refs = scanGithubRefs(buildDir, ["/docs/multi"]);
    expect(refs).toHaveLength(2);
  });
});

describe("replaceGithubCodeblocks", () => {
  it("replaces a github-codeblock wrapper with synthetic code block", () => {
    const html = `<article><div class="docusaurus-theme-github-codeblock">
      <div class="codeBlockContainer"><pre class="prism-code"><code>loading...</code></pre></div>
      <div><a href="https://github.com/org/repo/blob/main/src/file.ts#L1-L5" class="githubLink" target="_blank">View on GitHub</a></div>
    </div></div></div></article>`;

    const resolved = new Map([
      ["https://github.com/org/repo/blob/main/src/file.ts#L1-L5", "const x = 1;\nconsole.log(x);"],
    ]);

    const result = replaceGithubCodeblocks(html, resolved);
    expect(result).toContain('<pre class="prism-code language-typescript">');
    expect(result).toContain("const x = 1;");
    expect(result).not.toContain("loading...");
  });

  it("escapes HTML entities in resolved code", () => {
    const html = `<div class="docusaurus-theme-github-codeblock">
      <pre><code>loading...</code></pre>
      <a href="https://github.com/org/repo/blob/main/file.ts#L1-L2" class="githubLink">Link</a>
    </div></div></div>`;

    const resolved = new Map([
      ["https://github.com/org/repo/blob/main/file.ts#L1-L2", "x < 10 && y > 5"],
    ]);

    const result = replaceGithubCodeblocks(html, resolved);
    expect(result).toContain("x &lt; 10 &amp;&amp; y &gt; 5");
  });

  it("leaves unresolved codeblocks unchanged", () => {
    const html = `<div class="docusaurus-theme-github-codeblock">
      <pre><code>loading...</code></pre>
      <a href="https://github.com/org/repo/blob/main/missing.ts#L1-L5" class="githubLink">Link</a>
    </div></div></div>`;

    const resolved = new Map<string, string>();
    const result = replaceGithubCodeblocks(html, resolved);
    expect(result).toContain("loading...");
  });

  it("handles class-before-href anchor ordering", () => {
    const html = `<div class="docusaurus-theme-github-codeblock">
      <pre><code>loading...</code></pre>
      <a class="githubLink" href="https://github.com/org/repo/blob/main/file.sol#L1-L2" target="_blank">Link</a>
    </div></div></div>`;

    const resolved = new Map([
      ["https://github.com/org/repo/blob/main/file.sol#L1-L2", "pragma solidity;"],
    ]);

    const result = replaceGithubCodeblocks(html, resolved);
    expect(result).toContain("pragma solidity;");
    expect(result).toContain("language-solidity");
    expect(result).not.toContain("loading...");
  });

  it("leaves non-codeblock HTML untouched", () => {
    const html = "<article><p>Hello world</p></article>";
    const resolved = new Map([["https://github.com/org/repo/blob/main/file.ts", "code"]]);
    expect(replaceGithubCodeblocks(html, resolved)).toBe(html);
  });

  it("maps common file extensions to language names", () => {
    const makeHtml = (ext: string) =>
      `<div class="docusaurus-theme-github-codeblock">
        <pre><code>loading...</code></pre>
        <a href="https://github.com/org/repo/blob/main/file.${ext}#L1-L2" class="githubLink">Link</a>
      </div></div></div>`;

    const cases: [string, string][] = [
      ["sol", "solidity"],
      ["ts", "typescript"],
      ["js", "javascript"],
      ["py", "python"],
      ["rs", "rust"],
      ["go", "go"],
    ];

    for (const [ext, lang] of cases) {
      const resolved = new Map([
        [`https://github.com/org/repo/blob/main/file.${ext}#L1-L2`, "code"],
      ]);
      const result = replaceGithubCodeblocks(makeHtml(ext), resolved);
      expect(result).toContain(`language-${lang}`);
    }
  });
});

describe("fetchAllGithubCode", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and resolves code from GitHub", async () => {
    const fileContent = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(fileContent) })
    );

    const urls = ["https://github.com/org/repo/blob/main/file.ts#L2-L4"];
    const resolved = await fetchAllGithubCode(urls);

    expect(resolved.get(urls[0])).toBe("line 2\nline 3\nline 4");
    vi.unstubAllGlobals();
  });

  it("handles fetch failures gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const urls = ["https://github.com/org/repo/blob/main/file.ts#L1-L5"];
    const resolved = await fetchAllGithubCode(urls);

    expect(resolved.size).toBe(0);
    vi.unstubAllGlobals();
  });

  it("handles network errors gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const urls = ["https://github.com/org/repo/blob/main/file.ts#L1-L5"];
    const resolved = await fetchAllGithubCode(urls);

    expect(resolved.size).toBe(0);
    vi.unstubAllGlobals();
  });

  it("warns on invalid GitHub URLs", async () => {
    const urls = ["https://github.com/incomplete"];
    const resolved = await fetchAllGithubCode(urls);

    expect(resolved.size).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("could not parse"));
  });

  it("dedents code with no leading whitespace", async () => {
    const fileContent = "no indent\nalso no indent\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(fileContent) })
    );

    const urls = ["https://github.com/org/repo/blob/main/file.ts#L1-L2"];
    const resolved = await fetchAllGithubCode(urls);

    expect(resolved.get(urls[0])).toBe("no indent\nalso no indent");
    vi.unstubAllGlobals();
  });

  it("dedents fetched code", async () => {
    const fileContent = "    indented line 1\n    indented line 2\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(fileContent) })
    );

    const urls = ["https://github.com/org/repo/blob/main/file.ts#L1-L2"];
    const resolved = await fetchAllGithubCode(urls);

    expect(resolved.get(urls[0])).toBe("indented line 1\nindented line 2");
    vi.unstubAllGlobals();
  });

  it("returns empty map when line range is out of bounds", async () => {
    const fileContent = "line 1\nline 2\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(fileContent) })
    );

    const urls = ["https://github.com/org/repo/blob/main/file.ts#L100-L200"];
    const resolved = await fetchAllGithubCode(urls);

    expect(resolved.size).toBe(0);
    vi.unstubAllGlobals();
  });

  it("fetches full file when no line range specified", async () => {
    const fileContent = "line 1\nline 2\nline 3\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(fileContent) })
    );

    const urls = ["https://github.com/org/repo/blob/main/file.ts"];
    const resolved = await fetchAllGithubCode(urls);

    expect(resolved.get(urls[0])).toBe("line 1\nline 2\nline 3\n");
    vi.unstubAllGlobals();
  });
});

describe("buildSourceMap", () => {
  let tmpDir: string;
  let docsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmfood-source-test-"));
    docsDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  function writeSource(relativePath: string, content: string): void {
    const fullPath = path.join(docsDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  it("maps .md files to path stems", () => {
    writeSource("guides/intro.md", "# Intro");
    const map = buildSourceMap(docsDir);
    expect(map.has("guides/intro")).toBe(true);
  });

  it("maps .mdx files to path stems", () => {
    writeSource("guides/advanced.mdx", "# Advanced");
    const map = buildSourceMap(docsDir);
    expect(map.has("guides/advanced")).toBe(true);
  });

  it("maps index files to directory stem", () => {
    writeSource("guides/index.md", "# Guides");
    const map = buildSourceMap(docsDir);
    expect(map.has("guides")).toBe(true);
  });

  it("maps root index to empty key", () => {
    writeSource("index.md", "# Root");
    const map = buildSourceMap(docsDir);
    expect(map.has(".")).toBe(true);
  });

  it("ignores non-markdown files", () => {
    writeSource("config.json", '{"key": "value"}');
    writeSource("guide.md", "# Guide");
    const map = buildSourceMap(docsDir);
    expect(map.has("guide")).toBe(true);
    expect(map.has("config")).toBe(false);
  });

  it("returns empty map for nonexistent dir", () => {
    expect(buildSourceMap("/nonexistent")).toEqual(new Map());
  });
});

describe("findSourceForUrl", () => {
  it("matches by stripping URL prefix segments", () => {
    const sourceMap = new Map([["guides/intro", "/docs/guides/intro.md"]]);
    expect(findSourceForUrl("/docs/guides/intro", sourceMap)).toBe("/docs/guides/intro.md");
  });

  it("matches with different prefix depth", () => {
    const sourceMap = new Map([["intro", "/docs/intro.md"]]);
    expect(findSourceForUrl("/docs/intro", sourceMap)).toBe("/docs/intro.md");
  });

  it("returns undefined when no match", () => {
    const sourceMap = new Map([["guides/intro", "/docs/guides/intro.md"]]);
    expect(findSourceForUrl("/docs/other", sourceMap)).toBeUndefined();
  });
});

describe("extractMermaidBlocks", () => {
  it("extracts mermaid code blocks from MDX", () => {
    const source = "# Title\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nSome text\n";
    const blocks = extractMermaidBlocks(source);
    expect(blocks).toEqual(["graph TD\n  A --> B"]);
  });

  it("extracts multiple mermaid blocks", () => {
    const source =
      "```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: Hi\n```\n";
    const blocks = extractMermaidBlocks(source);
    expect(blocks).toHaveLength(2);
  });

  it("returns empty array when no mermaid blocks", () => {
    expect(extractMermaidBlocks("# Just text\n```ts\ncode\n```\n")).toEqual([]);
  });
});

describe("extractRemoteUrls", () => {
  it("extracts URLs from JSX url props", () => {
    const source =
      '<RemoteGFMContent url="https://raw.githubusercontent.com/org/repo/main/file.md" />';
    expect(extractRemoteUrls(source)).toEqual([
      "https://raw.githubusercontent.com/org/repo/main/file.md",
    ]);
  });

  it("handles single-quoted URLs", () => {
    const source = "<RemoteContent url='https://example.com/data.md' />";
    expect(extractRemoteUrls(source)).toEqual(["https://example.com/data.md"]);
  });

  it("returns empty array when no URLs", () => {
    expect(extractRemoteUrls("# Just markdown\n")).toEqual([]);
  });

  it("rejects HTTP URLs", () => {
    const source = '<RemoteContent url="http://example.com/data.md" />';
    expect(extractRemoteUrls(source)).toEqual([]);
  });

  it("rejects private/loopback addresses", () => {
    const cases = [
      '<C url="https://localhost/secret" />',
      '<C url="https://127.0.0.1/secret" />',
      '<C url="https://10.0.0.1/internal" />',
      '<C url="https://192.168.1.1/internal" />',
      '<C url="https://169.254.169.254/latest/meta-data/" />',
    ];
    for (const source of cases) {
      expect(extractRemoteUrls(source)).toEqual([]);
    }
  });
});

describe("replaceMermaidSvgs", () => {
  it("replaces mermaid SVGs with fenced code blocks", () => {
    const html =
      '<article><svg id="mermaid-123" xmlns="http://www.w3.org/2000/svg"><g></g></svg></article>';
    const result = replaceMermaidSvgs(html, ["graph TD\n  A --> B"]);
    expect(result).toContain("language-mermaid");
    expect(result).toContain("graph TD");
    expect(result).not.toContain("<svg");
  });

  it("matches SVGs with aria-roledescription", () => {
    const html =
      '<svg aria-roledescription="flowchart" xmlns="http://www.w3.org/2000/svg"><g></g></svg>';
    const result = replaceMermaidSvgs(html, ["flowchart LR\n  A --> B"]);
    expect(result).toContain("flowchart LR");
  });

  it("returns unchanged HTML when no mermaid blocks", () => {
    const html = '<svg id="mermaid-1"><g></g></svg>';
    expect(replaceMermaidSvgs(html, [])).toBe(html);
  });

  it("returns empty string for overflow SVGs", () => {
    const html = '<svg id="mermaid-1"><g></g></svg><svg id="mermaid-2"><g></g></svg>';
    const result = replaceMermaidSvgs(html, ["only one"]);
    expect(result).toContain("only one");
    expect(result).not.toContain("mermaid-2");
  });

  it("replaces multiple SVGs in order", () => {
    const html = '<svg id="mermaid-1"><g></g></svg><p>gap</p><svg id="mermaid-2"><g></g></svg>';
    const result = replaceMermaidSvgs(html, ["graph A", "graph B"]);
    expect(result).toContain("graph A");
    expect(result).toContain("graph B");
  });
});

describe("replaceLoadingContent", () => {
  it("replaces 'Loading content...' in divs", () => {
    const html = "<div>Loading content...</div>";
    const result = replaceLoadingContent(html, ["<p>Resolved content</p>"]);
    expect(result).toContain("Resolved content");
    expect(result).not.toContain("Loading content...");
  });

  it("replaces in paragraph tags", () => {
    const html = "<p> Loading content... </p>";
    const result = replaceLoadingContent(html, ["Real data"]);
    expect(result).toContain("Real data");
  });

  it("returns unchanged HTML when no content provided", () => {
    const html = "<div>Loading content...</div>";
    expect(replaceLoadingContent(html, [])).toBe(html);
  });

  it("returns original match for overflow placeholders", () => {
    const html = "<div>Loading content...</div><div>Loading content...</div>";
    const result = replaceLoadingContent(html, ["Only one"]);
    expect(result).toContain("Only one");
    expect(result).toContain("Loading content...");
  });

  it("replaces multiple loading placeholders in order", () => {
    const html = "<div>Loading content...</div><p>gap</p><div>Loading content...</div>";
    const result = replaceLoadingContent(html, ["First", "Second"]);
    expect(result).toContain("First");
    expect(result).toContain("Second");
  });
});

describe("resolveSourceContent", () => {
  let tmpDir: string;
  let docsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmfood-resolve-source-"));
    docsDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    vi.spyOn(console, "warn").mockImplementation(vi.fn());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
    vi.restoreAllMocks();
  });

  function writeSource(relativePath: string, content: string): void {
    const fullPath = path.join(docsDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  it("skips pages with no matching source file", async () => {
    const result = await resolveSourceContent(docsDir, ["/docs/nonexistent"]);
    expect(result.size).toBe(0);
  });

  it("skips source files with no mermaid or remote content", async () => {
    writeSource("plain.md", "# Just a plain doc\nNo special content here.\n");
    const result = await resolveSourceContent(docsDir, ["/docs/plain"]);
    expect(result.size).toBe(0);
  });

  it("extracts mermaid blocks from source files", async () => {
    writeSource("diagrams.md", "# Diagrams\n\n```mermaid\ngraph TD\n  A --> B\n```\n");
    const result = await resolveSourceContent(docsDir, ["/docs/diagrams"]);
    expect(result.get("/docs/diagrams")?.mermaidBlocks).toEqual(["graph TD\n  A --> B"]);
  });

  it("fetches and resolves remote content URLs", async () => {
    writeSource(
      "benchmarks.md",
      '<RemoteGFMContent url="https://raw.githubusercontent.com/org/repo/main/bench.md" />'
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("| Col | Data |\n|-----|------|\n| a | 1 |\n"),
      })
    );

    const result = await resolveSourceContent(docsDir, ["/docs/benchmarks"]);
    const data = result.get("/docs/benchmarks");
    expect(data?.resolvedRemoteContent).toHaveLength(1);
    expect(data?.resolvedRemoteContent[0]).toContain("Col");

    vi.unstubAllGlobals();
  });
});
