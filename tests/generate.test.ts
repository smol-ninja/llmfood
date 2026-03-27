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
