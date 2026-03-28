import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateLlmsMarkdown } from "../src/generate.js";
import type { LlmfoodConfig } from "../src/types.js";

let tmpDir: string;
let buildDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmfood-test-"));
  buildDir = path.join(tmpDir, "build");
  fs.mkdirSync(buildDir, { recursive: true });

  vi.spyOn(console, "log").mockImplementation(vi.fn());
  vi.spyOn(console, "warn").mockImplementation(vi.fn());
});

afterEach(() => {
  fs.rmSync(tmpDir, { force: true, recursive: true });
  vi.restoreAllMocks();
});

function writeHtmlPage(urlPath: string, body: string): void {
  const dir = path.join(buildDir, urlPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<html><body><article><h1>${urlPath}</h1><p>${body}</p></article></body></html>`
  );
}

function writeRedirectPage(urlPath: string, target: string): void {
  const dir = path.join(buildDir, urlPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<html><head><meta http-equiv="refresh" content="0;url=${target}"></head><body></body></html>`
  );
}

function baseConfig(overrides?: Partial<LlmfoodConfig>): LlmfoodConfig {
  return {
    baseUrl: "https://docs.example.com",
    buildDir,
    ...overrides,
  };
}

describe("generateLlmsMarkdown", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Page discovery
  // ──────────────────────────────────────────────────────────────────────────

  it("discovers pages in nested directories", async () => {
    writeHtmlPage("guides/getting-started", "Welcome");
    writeHtmlPage("api/tokens", "Tokens API");

    await generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("/guides/getting-started");
    expect(llmsTxt).toContain("/api/tokens");
  });

  it("ignores root index.html", async () => {
    fs.writeFileSync(
      path.join(buildDir, "index.html"),
      "<html><body><article><h1>Home</h1><p>Home page</p></article></body></html>"
    );
    writeHtmlPage("guides/intro", "Intro");

    await generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).not.toContain("[Home]");
  });

  it("ignores pages matching ignorePatterns", async () => {
    writeHtmlPage("guides/intro", "Intro");
    writeHtmlPage("blog/post-1", "Blog post");

    await generateLlmsMarkdown(baseConfig({ ignorePatterns: [/\/blog\//] }));

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("/guides/intro");
    expect(llmsTxt).not.toContain("blog");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Markdown conversion and file output
  // ──────────────────────────────────────────────────────────────────────────

  it("writes individual .md files for each page", async () => {
    writeHtmlPage("guides/setup", "Setup instructions");

    await generateLlmsMarkdown(baseConfig());

    const mdPath = path.join(buildDir, "guides/setup.md");
    expect(fs.existsSync(mdPath)).toBe(true);
    const content = fs.readFileSync(mdPath, "utf-8");
    expect(content).toContain("Setup instructions");
  });

  it("skips pages where HTML file does not exist", async () => {
    writeHtmlPage("guides/real", "Real page");

    await generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("/guides/real");
  });

  it("skips pages that produce empty markdown", async () => {
    const dir = path.join(buildDir, "empty");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      "<html><body><div>No article</div></body></html>"
    );

    writeHtmlPage("guides/valid", "Valid content");

    await generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("/guides/valid");
    expect(llmsTxt).not.toContain("/empty");
  });

  it("handles pages that throw errors during processing", async () => {
    writeHtmlPage("guides/good", "Good content");
    writeHtmlPage("concepts/bad", "Bad content");

    // Block the output path by creating a directory where the .md file would go
    fs.mkdirSync(path.join(buildDir, "concepts/bad.md"), { recursive: true });

    await generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("/guides/good");
    expect(llmsTxt).not.toContain("concepts/bad");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // llms.txt generation
  // ──────────────────────────────────────────────────────────────────────────

  it("includes site title and description in llms.txt", async () => {
    writeHtmlPage("guides/intro", "Intro");

    await generateLlmsMarkdown(
      baseConfig({
        siteDescription: "Documentation for my project",
        siteTitle: "My Docs",
      })
    );

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("# My Docs");
    expect(llmsTxt).toContain("> Documentation for my project");
  });

  it("includes rootContent in llms.txt", async () => {
    writeHtmlPage("guides/intro", "Intro");

    await generateLlmsMarkdown(baseConfig({ rootContent: "This is additional root content." }));

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("This is additional root content.");
  });

  it("groups pages by section with default labels", async () => {
    writeHtmlPage("guides/intro", "Intro");
    writeHtmlPage("guides/advanced", "Advanced");
    writeHtmlPage("api/tokens", "Tokens");

    await generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("## Guides");
    expect(llmsTxt).toContain("## Api");
    expect(llmsTxt).toContain("/guides/intro");
    expect(llmsTxt).toContain("/guides/advanced");
  });

  it("respects sectionOrder for sorting", async () => {
    writeHtmlPage("api/tokens", "Tokens");
    writeHtmlPage("guides/intro", "Intro");

    await generateLlmsMarkdown(baseConfig({ sectionOrder: ["api", "guides"] }));

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    const apiPos = llmsTxt.indexOf("## Api");
    const guidesPos = llmsTxt.indexOf("## Guides");
    expect(apiPos).toBeLessThan(guidesPos);
  });

  it("uses custom section labels", async () => {
    writeHtmlPage("guides/intro", "Intro");

    await generateLlmsMarkdown(baseConfig({ sectionLabels: { guides: "User Guides" } }));

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("## User Guides");
  });

  it("uses urlPath as description when page has no title", async () => {
    const dir = path.join(buildDir, "guides/notitle");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      "<html><body><article><p>Content without title</p></article></body></html>"
    );

    await generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("[/guides/notitle]");
  });

  it("extracts title from h1 and strips HTML tags", async () => {
    const dir = path.join(buildDir, "guides/fancy");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      '<html><body><article><h1>Hello <span class="badge">v2</span></h1><p>Content</p></article></body></html>'
    );

    await generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("[Hello v2]");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Custom files
  // ──────────────────────────────────────────────────────────────────────────

  it("generates custom llms files with title, description, and matching pages", async () => {
    writeHtmlPage("guides/intro", "Intro content");
    writeHtmlPage("api/tokens", "Tokens content");

    await generateLlmsMarkdown(
      baseConfig({
        customFiles: [
          {
            description: "Only guide pages",
            filename: "llms-guides.txt",
            includePatterns: [/\/guides\//],
            title: "Guides Only",
          },
        ],
      })
    );

    const customFile = fs.readFileSync(path.join(buildDir, "llms-guides.txt"), "utf-8");
    expect(customFile).toContain("# Guides Only");
    expect(customFile).toContain("> Only guide pages");
    expect(customFile).toContain("Intro content");
    expect(customFile).not.toContain("Tokens content");
  });

  it("generates custom file without title or description", async () => {
    writeHtmlPage("guides/intro", "Intro content");

    await generateLlmsMarkdown(
      baseConfig({
        customFiles: [
          {
            filename: "llms-all.txt",
            includePatterns: [/.*/],
          },
        ],
      })
    );

    const customFile = fs.readFileSync(path.join(buildDir, "llms-all.txt"), "utf-8");
    expect(customFile).not.toMatch(/^# [A-Z]/);
    expect(customFile).not.toMatch(/^> /m);
    expect(customFile).toContain("Intro content");
  });

  it("uses urlPath when page has no title in custom files", async () => {
    const dir = path.join(buildDir, "guides/notitle");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      "<html><body><article><p>Content</p></article></body></html>"
    );

    await generateLlmsMarkdown(
      baseConfig({
        customFiles: [
          {
            filename: "llms-all.txt",
            includePatterns: [/.*/],
          },
        ],
      })
    );

    const customFile = fs.readFileSync(path.join(buildDir, "llms-all.txt"), "utf-8");
    expect(customFile).toContain("## /guides/notitle");
  });

  it("works with no custom files configured", async () => {
    writeHtmlPage("guides/intro", "Intro");

    await generateLlmsMarkdown(baseConfig());

    expect(fs.existsSync(path.join(buildDir, "llms.txt"))).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Edge cases
  // ──────────────────────────────────────────────────────────────────────────

  it("handles empty build directory", async () => {
    await generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toBe("");
  });

  it("generates correct URLs with baseUrl", async () => {
    writeHtmlPage("guides/intro", "Intro");

    await generateLlmsMarkdown(baseConfig({ baseUrl: "https://custom.example.com" }));

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("https://custom.example.com/guides/intro.md");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Skip reporting
  // ──────────────────────────────────────────────────────────────────────────

  it("reports skipped redirect pages", async () => {
    writeHtmlPage("guides/intro", "Intro");
    writeRedirectPage("old/page", "/guides/intro");
    writeRedirectPage("old/other", "/guides/intro");

    await generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("/guides/intro");
    expect(llmsTxt).not.toContain("/old/page");
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Skipped 2 pages (2 redirects)")
    );
  });

  it("reports multiple skip reasons in summary", async () => {
    writeHtmlPage("guides/valid", "Valid content");
    writeRedirectPage("old/redirect", "/guides/valid");

    const emptyDir = path.join(buildDir, "empty/page");
    fs.mkdirSync(emptyDir, { recursive: true });
    fs.writeFileSync(
      path.join(emptyDir, "index.html"),
      "<html><body><div>No article</div></body></html>"
    );

    await generateLlmsMarkdown(baseConfig());

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Skipped 2 pages"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("1 redirects"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("1 empty content"));
  });

  it("logs individual skipped pages in verbose mode", async () => {
    writeHtmlPage("guides/valid", "Valid content");
    writeRedirectPage("old/page", "/guides/valid");

    await generateLlmsMarkdown(baseConfig({ verbose: true }));

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("/old/page (redirect → /guides/valid)")
    );
  });

  it("does not log skip details when not verbose", async () => {
    writeRedirectPage("old/page", "/guides/intro");

    await generateLlmsMarkdown(baseConfig({ verbose: false }));

    const detailCalls = vi
      .mocked(console.log)
      .mock.calls.filter(
        (args) => typeof args[0] === "string" && args[0].includes("/old/page (redirect")
      );
    expect(detailCalls).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Post-processing hooks
  // ──────────────────────────────────────────────────────────────────────────

  it("applies postProcessHtml before conversion", async () => {
    writeHtmlPage("guides/intro", "loading...");

    await generateLlmsMarkdown(
      baseConfig({
        postProcessHtml: (html) => html.replace("loading...", "Resolved content"),
      })
    );

    const mdPath = path.join(buildDir, "guides/intro.md");
    const content = fs.readFileSync(mdPath, "utf-8");
    expect(content).toContain("Resolved content");
    expect(content).not.toContain("loading...");
  });

  it("applies postProcessMarkdown after conversion", async () => {
    writeHtmlPage("guides/intro", "Some content");

    await generateLlmsMarkdown(
      baseConfig({
        postProcessMarkdown: (md) => `${md}\n\n<!-- processed -->`,
      })
    );

    const mdPath = path.join(buildDir, "guides/intro.md");
    const content = fs.readFileSync(mdPath, "utf-8");
    expect(content).toContain("<!-- processed -->");
  });

  it("passes urlPath in hook context", async () => {
    writeHtmlPage("guides/intro", "Content");

    const paths: string[] = [];
    await generateLlmsMarkdown(
      baseConfig({
        postProcessHtml: (html, ctx) => {
          paths.push(ctx.urlPath);
          return html;
        },
      })
    );

    expect(paths).toContain("/guides/intro");
  });

  it("supports async postProcessHtml", async () => {
    writeHtmlPage("guides/intro", "placeholder");

    await generateLlmsMarkdown(
      baseConfig({
        postProcessHtml: async (html) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return html.replace("placeholder", "async resolved");
        },
      })
    );

    const mdPath = path.join(buildDir, "guides/intro.md");
    const content = fs.readFileSync(mdPath, "utf-8");
    expect(content).toContain("async resolved");
  });

  it("supports async postProcessMarkdown", async () => {
    writeHtmlPage("guides/intro", "Content");

    await generateLlmsMarkdown(
      baseConfig({
        postProcessMarkdown: async (md) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return `${md}\n\n<!-- async -->`;
        },
      })
    );

    const mdPath = path.join(buildDir, "guides/intro.md");
    const content = fs.readFileSync(mdPath, "utf-8");
    expect(content).toContain("<!-- async -->");
  });
});

describe("GitHub codeblock resolution", () => {
  function writeGithubCodeblockPage(urlPath: string, githubUrl: string): void {
    const dir = path.join(buildDir, urlPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      `<html><body><article>
        <h1>Test</h1>
        <div class="docusaurus-theme-github-codeblock">
          <div class="codeBlockContainer"><div class="codeBlockContent">
            <pre class="prism-code language-typescript"><code>loading...</code></pre>
          </div></div>
          <div style="text-align:right">
            <a href="${githubUrl}" class="githubLink" target="_blank">View on GitHub</a>
          </div>
        </div></div></div>
      </article></body></html>`
    );
  }

  it("resolves github codeblocks in the output markdown", async () => {
    const githubUrl = "https://github.com/org/repo/blob/main/src/example.ts#L2-L4";
    writeGithubCodeblockPage("guides/code", githubUrl);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("line 1\nline 2\nline 3\nline 4\nline 5\n"),
      })
    );

    await generateLlmsMarkdown(baseConfig());

    const mdPath = path.join(buildDir, "guides/code.md");
    const content = fs.readFileSync(mdPath, "utf-8");
    expect(content).toContain("line 2");
    expect(content).toContain("line 3");
    expect(content).toContain("line 4");
    expect(content).not.toContain("loading...");

    vi.unstubAllGlobals();
  });

  it("does not call fetch when no github codeblocks are present", async () => {
    writeHtmlPage("guides/plain", "No code blocks here");

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await generateLlmsMarkdown(baseConfig());

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("source file scanning", () => {
  let docsDir: string;

  beforeEach(() => {
    docsDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
  });

  function writeSourceFile(relativePath: string, content: string): void {
    const fullPath = path.join(docsDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  function writeMermaidPage(urlPath: string): void {
    const dir = path.join(buildDir, urlPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      `<html><body><article>
        <h1>Diagram</h1>
        <svg id="mermaid-123" xmlns="http://www.w3.org/2000/svg"><g><text>chart</text></g></svg>
      </article></body></html>`
    );
  }

  it("replaces mermaid SVGs with source code blocks", async () => {
    writeMermaidPage("docs/diagrams");
    writeSourceFile("diagrams.md", "# Diagrams\n\n```mermaid\ngraph TD\n  A --> B\n```\n");

    await generateLlmsMarkdown(baseConfig({ docsDir }));

    const mdPath = path.join(buildDir, "docs/diagrams.md");
    const content = fs.readFileSync(mdPath, "utf-8");
    expect(content).toContain("graph TD");
    expect(content).toContain("A --> B");
  });

  it("resolves remote content from source URLs", async () => {
    const dir = path.join(buildDir, "docs/benchmarks");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      `<html><body><article>
        <h1>Benchmarks</h1>
        <div>Loading content...</div>
      </article></body></html>`
    );
    writeSourceFile(
      "benchmarks.md",
      '<RemoteGFMContent url="https://raw.githubusercontent.com/org/repo/main/bench.md" />'
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("| Method | Gas |\n|--------|-----|\n| foo | 100 |\n"),
      })
    );

    await generateLlmsMarkdown(baseConfig({ docsDir }));

    const mdPath = path.join(buildDir, "docs/benchmarks.md");
    const content = fs.readFileSync(mdPath, "utf-8");
    expect(content).toContain("foo");
    expect(content).not.toContain("Loading content...");

    vi.unstubAllGlobals();
  });
});
