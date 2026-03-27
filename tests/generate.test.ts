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

  it("discovers pages in nested directories", () => {
    writeHtmlPage("guides/getting-started", "Welcome");
    writeHtmlPage("api/tokens", "Tokens API");

    generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("/guides/getting-started");
    expect(llmsTxt).toContain("/api/tokens");
  });

  it("ignores root index.html", () => {
    fs.writeFileSync(
      path.join(buildDir, "index.html"),
      "<html><body><article><h1>Home</h1><p>Home page</p></article></body></html>"
    );
    writeHtmlPage("guides/intro", "Intro");

    generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).not.toContain("[Home]");
  });

  it("ignores pages matching ignorePatterns", () => {
    writeHtmlPage("guides/intro", "Intro");
    writeHtmlPage("blog/post-1", "Blog post");

    generateLlmsMarkdown(baseConfig({ ignorePatterns: [/\/blog\//] }));

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("/guides/intro");
    expect(llmsTxt).not.toContain("blog");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Markdown conversion and file output
  // ──────────────────────────────────────────────────────────────────────────

  it("writes individual .md files for each page", () => {
    writeHtmlPage("guides/setup", "Setup instructions");

    generateLlmsMarkdown(baseConfig());

    const mdPath = path.join(buildDir, "guides/setup.md");
    expect(fs.existsSync(mdPath)).toBe(true);
    const content = fs.readFileSync(mdPath, "utf-8");
    expect(content).toContain("Setup instructions");
  });

  it("skips pages where HTML file does not exist", () => {
    writeHtmlPage("guides/real", "Real page");

    generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("/guides/real");
  });

  it("skips pages that produce empty markdown", () => {
    const dir = path.join(buildDir, "empty");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      "<html><body><div>No article</div></body></html>"
    );

    writeHtmlPage("guides/valid", "Valid content");

    generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("/guides/valid");
    expect(llmsTxt).not.toContain("/empty");
  });

  it("handles pages that throw errors during processing", () => {
    writeHtmlPage("guides/good", "Good content");
    writeHtmlPage("concepts/bad", "Bad content");

    // Block the output path by creating a directory where the .md file would go
    fs.mkdirSync(path.join(buildDir, "concepts/bad.md"), { recursive: true });

    generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("/guides/good");
    expect(llmsTxt).not.toContain("concepts/bad");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // llms.txt generation
  // ──────────────────────────────────────────────────────────────────────────

  it("includes site title and description in llms.txt", () => {
    writeHtmlPage("guides/intro", "Intro");

    generateLlmsMarkdown(
      baseConfig({
        siteDescription: "Documentation for my project",
        siteTitle: "My Docs",
      })
    );

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("# My Docs");
    expect(llmsTxt).toContain("> Documentation for my project");
  });

  it("includes rootContent in llms.txt", () => {
    writeHtmlPage("guides/intro", "Intro");

    generateLlmsMarkdown(baseConfig({ rootContent: "This is additional root content." }));

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("This is additional root content.");
  });

  it("groups pages by section with default labels", () => {
    writeHtmlPage("guides/intro", "Intro");
    writeHtmlPage("guides/advanced", "Advanced");
    writeHtmlPage("api/tokens", "Tokens");

    generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("## Guides");
    expect(llmsTxt).toContain("## Api");
    expect(llmsTxt).toContain("/guides/intro");
    expect(llmsTxt).toContain("/guides/advanced");
  });

  it("respects sectionOrder for sorting", () => {
    writeHtmlPage("api/tokens", "Tokens");
    writeHtmlPage("guides/intro", "Intro");

    generateLlmsMarkdown(baseConfig({ sectionOrder: ["api", "guides"] }));

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    const apiPos = llmsTxt.indexOf("## Api");
    const guidesPos = llmsTxt.indexOf("## Guides");
    expect(apiPos).toBeLessThan(guidesPos);
  });

  it("uses custom section labels", () => {
    writeHtmlPage("guides/intro", "Intro");

    generateLlmsMarkdown(baseConfig({ sectionLabels: { guides: "User Guides" } }));

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("## User Guides");
  });

  it("uses urlPath as description when page has no title", () => {
    const dir = path.join(buildDir, "guides/notitle");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      "<html><body><article><p>Content without title</p></article></body></html>"
    );

    generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("[/guides/notitle]");
  });

  it("extracts title from h1 and strips HTML tags", () => {
    const dir = path.join(buildDir, "guides/fancy");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      '<html><body><article><h1>Hello <span class="badge">v2</span></h1><p>Content</p></article></body></html>'
    );

    generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("[Hello v2]");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Custom files
  // ──────────────────────────────────────────────────────────────────────────

  it("generates custom llms files with title, description, and matching pages", () => {
    writeHtmlPage("guides/intro", "Intro content");
    writeHtmlPage("api/tokens", "Tokens content");

    generateLlmsMarkdown(
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

  it("generates custom file without title or description", () => {
    writeHtmlPage("guides/intro", "Intro content");

    generateLlmsMarkdown(
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

  it("uses urlPath when page has no title in custom files", () => {
    const dir = path.join(buildDir, "guides/notitle");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      "<html><body><article><p>Content</p></article></body></html>"
    );

    generateLlmsMarkdown(
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

  it("works with no custom files configured", () => {
    writeHtmlPage("guides/intro", "Intro");

    generateLlmsMarkdown(baseConfig());

    expect(fs.existsSync(path.join(buildDir, "llms.txt"))).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Edge cases
  // ──────────────────────────────────────────────────────────────────────────

  it("handles empty build directory", () => {
    generateLlmsMarkdown(baseConfig());

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toBe("");
  });

  it("generates correct URLs with baseUrl", () => {
    writeHtmlPage("guides/intro", "Intro");

    generateLlmsMarkdown(baseConfig({ baseUrl: "https://custom.example.com" }));

    const llmsTxt = fs.readFileSync(path.join(buildDir, "llms.txt"), "utf-8");
    expect(llmsTxt).toContain("https://custom.example.com/guides/intro.md");
  });
});
