import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSourceMap,
  extractGithubRefs,
  extractMermaidBlocks,
  extractRemoteUrls,
  findSourceForUrl,
  injectMermaidBlocks,
  inlineImportedSnippets,
  parseGithubRef,
  replaceGithubCodeblocks,
  replaceLoadingContent,
  resolveSourceContent,
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

describe("extractGithubRefs", () => {
  it("extracts URLs from JSX CodeBlock children", () => {
    const source = `<CodeBlock language="solidity" metastring={\`reference title=""\`}>
  {\`https://github.com/org/repo/blob/main/file.sol#L1-L5\`}
</CodeBlock>`;
    expect(extractGithubRefs(source)).toEqual([
      "https://github.com/org/repo/blob/main/file.sol#L1-L5",
    ]);
  });

  it("extracts URLs from fenced reference codeblocks", () => {
    const source = `\`\`\`graphql reference title="Schema"
https://github.com/org/repo/blob/main/schema.graphql
\`\`\``;
    expect(extractGithubRefs(source)).toEqual([
      "https://github.com/org/repo/blob/main/schema.graphql",
    ]);
  });

  it("extracts multiple URLs in order", () => {
    const source = `<CodeBlock language="solidity" metastring={\`reference title=""\`}>
  {\`https://github.com/org/repo/blob/main/a.sol#L1-L2\`}
</CodeBlock>
<CodeBlock language="solidity" metastring={\`reference title=""\`}>
  {\`https://github.com/org/repo/blob/main/b.sol#L3-L4\`}
</CodeBlock>`;
    const refs = extractGithubRefs(source);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toContain("a.sol");
    expect(refs[1]).toContain("b.sol");
  });

  it("returns empty array when no refs found", () => {
    expect(extractGithubRefs("# Just a title\nSome text\n")).toEqual([]);
  });
});

describe("inlineImportedSnippets", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmfood-inline-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it("appends content from imported .mdx files", () => {
    fs.writeFileSync(
      path.join(tmpDir, "_snippet.mdx"),
      `<CodeBlock language="solidity" metastring={\`reference title=""\`}>
  {\`https://github.com/org/repo/blob/main/snippet.sol\`}
</CodeBlock>`
    );

    const source = `import Snippet from "./_snippet.mdx"\n\n<Snippet />`;
    const result = inlineImportedSnippets(source, tmpDir);
    expect(result).toContain("snippet.sol");
  });

  it("handles multiple imports", () => {
    fs.writeFileSync(path.join(tmpDir, "_a.mdx"), "content A");
    fs.writeFileSync(path.join(tmpDir, "_b.mdx"), "content B");

    const source = `import A from "./_a.mdx"\nimport B from "./_b.mdx"`;
    const result = inlineImportedSnippets(source, tmpDir);
    expect(result).toContain("content A");
    expect(result).toContain("content B");
  });

  it("ignores non-relative imports", () => {
    const source = `import Comp from "@site/components/Comp.mdx"`;
    const result = inlineImportedSnippets(source, tmpDir);
    expect(result).toBe(source);
  });

  it("ignores missing snippet files", () => {
    const source = `import Missing from "./missing.mdx"`;
    const result = inlineImportedSnippets(source, tmpDir);
    expect(result).toBe(source);
  });

  it("returns source unchanged when no imports", () => {
    const source = "# Title\nSome content\n";
    expect(inlineImportedSnippets(source, tmpDir)).toBe(source);
  });
});

describe("replaceGithubCodeblocks", () => {
  it("replaces wrapper divs with resolved code in order", () => {
    const html =
      '<div class="docusaurus-theme-github-codeblock"><div><pre><code>loading...</code></pre></div></div></div>' +
      '<div class="docusaurus-theme-github-codeblock"><div><pre><code>loading...</code></pre></div></div></div>';

    const urls = [
      "https://github.com/org/repo/blob/main/a.sol#L1-L2",
      "https://github.com/org/repo/blob/main/b.ts#L3-L4",
    ];

    const result = replaceGithubCodeblocks(html, ["code a", "code b"], urls);
    expect(result).toContain("code a");
    expect(result).toContain("code b");
    expect(result).toContain("language-solidity");
    expect(result).toContain("language-typescript");
    expect(result).not.toContain("loading...");
  });

  it("escapes HTML entities in resolved code", () => {
    const html =
      '<div class="docusaurus-theme-github-codeblock"><div><pre><code>loading...</code></pre></div></div></div>';
    const urls = ["https://github.com/org/repo/blob/main/file.ts#L1-L2"];
    const result = replaceGithubCodeblocks(html, ["x < 10 && y > 5"], urls);
    expect(result).toContain("x &lt; 10 &amp;&amp; y &gt; 5");
  });

  it("returns unchanged when no code provided", () => {
    const html =
      '<div class="docusaurus-theme-github-codeblock"><div><pre><code>loading...</code></pre></div></div></div>';
    expect(replaceGithubCodeblocks(html, [], [])).toBe(html);
  });

  it("leaves non-codeblock HTML untouched", () => {
    const html = "<article><p>Hello world</p></article>";
    expect(
      replaceGithubCodeblocks(html, ["code"], ["https://github.com/org/repo/blob/main/f.ts"])
    ).toBe(html);
  });

  it("preserves extra wrappers when code runs out", () => {
    const html =
      '<div class="docusaurus-theme-github-codeblock"><div><pre><code>loading...</code></pre></div></div></div>' +
      '<div class="docusaurus-theme-github-codeblock"><div><pre><code>loading...</code></pre></div></div></div>';
    const urls = ["https://github.com/org/repo/blob/main/only.sol"];
    const result = replaceGithubCodeblocks(html, ["only one"], urls);
    expect(result).toContain("only one");
    expect(result).toContain("loading...");
  });

  it("handles unquoted class on wrapper div", () => {
    const html =
      "<div class=docusaurus-theme-github-codeblock><div><pre><code>loading...</code></pre></div></div></div>";
    const urls = ["https://github.com/org/repo/blob/main/file.sol"];
    const result = replaceGithubCodeblocks(html, ["contract Foo {}"], urls);
    expect(result).toContain("contract Foo {}");
    expect(result).not.toContain("loading...");
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

  it("strips numeric prefixes from path segments", () => {
    writeSource("guides/lockup/04-gas-benchmarks.mdx", "# Gas Benchmarks");
    const map = buildSourceMap(docsDir);
    expect(map.has("guides/lockup/gas-benchmarks")).toBe(true);
    expect(map.has("guides/lockup/04-gas-benchmarks")).toBe(false);
  });

  it("strips numeric prefixes from all segments", () => {
    writeSource("01-guides/02-lockup/03-examples.md", "# Examples");
    const map = buildSourceMap(docsDir);
    expect(map.has("guides/lockup/examples")).toBe(true);
  });

  it("does not strip non-prefix numbers", () => {
    writeSource("guides/erc20-setup.mdx", "# ERC20");
    const map = buildSourceMap(docsDir);
    expect(map.has("guides/erc20-setup")).toBe(true);
  });

  it("maps by frontmatter id when it differs from filename", () => {
    writeSource(
      "guides/flow/examples/02-calculate-rps.mdx",
      '---\nid: "flow-calculate-rps"\n---\n\n# Calculate RPS\n'
    );
    const map = buildSourceMap(docsDir);
    expect(map.has("guides/flow/examples/calculate-rps")).toBe(true);
    expect(map.has("guides/flow/examples/flow-calculate-rps")).toBe(true);
  });

  it("maps root-level file by frontmatter id", () => {
    writeSource("03-fee.md", '---\nid: "fees"\n---\n\n# Fees\n');
    const map = buildSourceMap(docsDir);
    expect(map.has("fee")).toBe(true);
    expect(map.has("fees")).toBe(true);
  });

  it("does not add id entry when frontmatter has no id", () => {
    writeSource("guides/plain.md", '---\ntitle: "Plain"\n---\n\n# Plain\n');
    const map = buildSourceMap(docsDir);
    expect(map.has("guides/plain")).toBe(true);
    expect(map.size).toBe(1);
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

  it("resolves JSX expressions via resolveRemoteUrl", () => {
    const source = '<RemoteGFMContent url={getBenchmarkURL("results/lockup/batch.md")} />';
    const resolver = (expr: string) => {
      const match = expr.match(/getBenchmarkURL\("([^"]+)"\)/);
      if (match) {
        return `https://raw.githubusercontent.com/org/benchmarks/main/${match[1]}`;
      }
      return undefined;
    };
    const urls = extractRemoteUrls(source, resolver);
    expect(urls).toEqual([
      "https://raw.githubusercontent.com/org/benchmarks/main/results/lockup/batch.md",
    ]);
  });

  it("skips JSX expressions when no resolver provided", () => {
    const source = '<RemoteGFMContent url={getBenchmarkURL("results/file.md")} />';
    expect(extractRemoteUrls(source)).toEqual([]);
  });

  it("skips JSX expressions that resolve to unsafe URLs", () => {
    const source = '<C url={getUrl("file.md")} />';
    const resolver = () => "http://insecure.com/file.md";
    expect(extractRemoteUrls(source, resolver)).toEqual([]);
  });

  it("skips JSX expressions that resolve to undefined", () => {
    const source = '<C url={unknownFn("file.md")} />';
    const resolver = () => undefined;
    expect(extractRemoteUrls(source, resolver)).toEqual([]);
  });
});

describe("injectMermaidBlocks", () => {
  it("injects mermaid code blocks before </article>", () => {
    const html = "<article><p>Content</p></article>";
    const result = injectMermaidBlocks(html, ["graph TD\n  A --> B"]);
    expect(result).toContain("language-mermaid");
    expect(result).toContain("graph TD");
    expect(result).toContain("</article>");
  });

  it("returns unchanged HTML when no mermaid blocks", () => {
    const html = "<article><p>Content</p></article>";
    expect(injectMermaidBlocks(html, [])).toBe(html);
  });

  it("returns unchanged HTML when no article tag", () => {
    const html = "<div><p>Content</p></div>";
    expect(injectMermaidBlocks(html, ["graph TD"])).toBe(html);
  });

  it("injects multiple mermaid blocks", () => {
    const html = "<article><p>Content</p></article>";
    const result = injectMermaidBlocks(html, ["graph A", "graph B"]);
    expect(result).toContain("graph A");
    expect(result).toContain("graph B");
  });

  it("escapes HTML entities in mermaid source", () => {
    const html = "<article><p>Content</p></article>";
    const result = injectMermaidBlocks(html, ["A -->|x < 10| B"]);
    expect(result).toContain("&lt;");
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

  it("extracts and fetches GitHub code references from source", async () => {
    writeSource(
      "examples.mdx",
      `<CodeBlock language="solidity" metastring={\`reference title=""\`}>
  {\`https://github.com/org/repo/blob/main/file.sol#L1-L5\`}
</CodeBlock>`
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("line 1\nline 2\nline 3\nline 4\nline 5\n"),
      })
    );

    const result = await resolveSourceContent(docsDir, ["/docs/examples"]);
    const data = result.get("/docs/examples");
    expect(data?.resolvedCode).toHaveLength(1);
    expect(data?.resolvedCode[0]).toContain("line 1");
    expect(data?.githubUrls).toEqual(["https://github.com/org/repo/blob/main/file.sol#L1-L5"]);

    vi.unstubAllGlobals();
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

  it("handles fetch failures for github code references", async () => {
    writeSource(
      "failing.mdx",
      `<CodeBlock language="solidity" metastring={\`reference title=""\`}>
  {\`https://github.com/org/repo/blob/main/missing.sol#L1-L5\`}
</CodeBlock>`
    );

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const result = await resolveSourceContent(docsDir, ["/docs/failing"]);
    const data = result.get("/docs/failing");
    expect(data?.resolvedCode).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it("handles network errors during fetch", async () => {
    writeSource(
      "network.mdx",
      `<CodeBlock language="solidity" metastring={\`reference title=""\`}>
  {\`https://github.com/org/repo/blob/main/file.sol#L1-L2\`}
</CodeBlock>`
    );

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const result = await resolveSourceContent(docsDir, ["/docs/network"]);
    const data = result.get("/docs/network");
    expect(data?.resolvedCode).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it("handles out-of-bounds line ranges", async () => {
    writeSource(
      "oob.mdx",
      `<CodeBlock language="solidity" metastring={\`reference title=""\`}>
  {\`https://github.com/org/repo/blob/main/file.sol#L100-L200\`}
</CodeBlock>`
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("line 1\nline 2\n"),
      })
    );

    const result = await resolveSourceContent(docsDir, ["/docs/oob"]);
    const data = result.get("/docs/oob");
    expect(data?.resolvedCode).toHaveLength(0);

    vi.unstubAllGlobals();
  });
});
