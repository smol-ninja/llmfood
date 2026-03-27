import * as fs from "node:fs";
import * as path from "node:path";

import { htmlToMarkdown } from "./convert.js";
import type { LlmfoodConfig, PageEntry, SkippedPage, SkipReason } from "./types.js";

const H1_PATTERN = /<h1[^>]*>([\s\S]*?)<\/h1>/;
const HTML_TAG_PATTERN = /<[^>]+>/g;
const META_REFRESH_PATTERN =
  /<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["']?\d+;\s*url=([^"'\s>]+)/i;

function discoverPages(buildDir: string): string[] {
  const pages: string[] = [];

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name === "index.html") {
        const relativePath = path.relative(buildDir, path.dirname(fullPath));
        const urlPath = relativePath === "" ? "/" : `/${relativePath}`;
        pages.push(urlPath);
      }
    }
  }

  walk(buildDir);
  return pages;
}

function shouldIgnore(urlPath: string, ignorePatterns: RegExp[]): boolean {
  if (urlPath === "/") {
    return true;
  }

  for (const pattern of ignorePatterns) {
    if (pattern.test(urlPath)) {
      return true;
    }
  }

  return false;
}

function extractTitle(html: string): string {
  const match = html.match(H1_PATTERN);
  return match?.[1]?.replace(HTML_TAG_PATTERN, "").trim() ?? "";
}

function detectRedirect(html: string): string | undefined {
  const match = html.match(META_REFRESH_PATTERN);
  return match?.[1];
}

async function processPage(
  config: LlmfoodConfig,
  urlPath: string
): Promise<PageEntry | SkippedPage> {
  const htmlPath = path.join(config.buildDir, urlPath.slice(1), "index.html");

  if (!fs.existsSync(htmlPath)) {
    /* v8 ignore next */
    return { reason: "no-file", urlPath };
  }

  let html = fs.readFileSync(htmlPath, "utf-8");

  const redirectTarget = detectRedirect(html);
  if (redirectTarget) {
    return { reason: "redirect", redirectTarget, urlPath };
  }

  const title = extractTitle(html);
  const context = { urlPath };
  if (config.postProcessHtml) {
    html = await config.postProcessHtml(html, context);
  }

  let markdown = htmlToMarkdown(html);
  if (!markdown) {
    return { reason: "empty", urlPath };
  }

  if (config.postProcessMarkdown) {
    markdown = await config.postProcessMarkdown(markdown, context);
  }

  const mdPath = path.join(config.buildDir, `${urlPath.slice(1)}.md`);
  const mdDir = path.dirname(mdPath);

  fs.mkdirSync(mdDir, { recursive: true });
  fs.writeFileSync(mdPath, markdown, "utf-8");

  return { markdown, mdPath, title, urlPath };
}

function isPageEntry(result: PageEntry | SkippedPage): result is PageEntry {
  return "markdown" in result;
}

function generateLlmsTxt(config: LlmfoodConfig, pages: PageEntry[]): void {
  const lines: string[] = [];

  if (config.siteTitle) {
    lines.push(`# ${config.siteTitle}`);
    lines.push("");
  }
  if (config.siteDescription) {
    lines.push(`> ${config.siteDescription}`);
    lines.push("");
  }
  if (config.rootContent) {
    lines.push(config.rootContent);
    lines.push("");
  }

  const sections = new Map<string, PageEntry[]>();
  for (const page of pages) {
    const section = page.urlPath.split("/")[1] ?? "other";
    const group = sections.get(section);
    if (group) {
      group.push(page);
    } else {
      sections.set(section, [page]);
    }
  }

  const sectionOrder = config.sectionOrder ?? [];
  const sortedSections = [...sections.entries()].sort((a, b) => {
    const aIdx = sectionOrder.indexOf(a[0]);
    const bIdx = sectionOrder.indexOf(b[0]);
    const aOrder = aIdx === -1 ? sectionOrder.length : aIdx;
    const bOrder = bIdx === -1 ? sectionOrder.length : bIdx;
    return aOrder - bOrder;
  });

  const sectionLabels = config.sectionLabels ?? {};
  for (const [section, sectionPages] of sortedSections) {
    const label = sectionLabels[section] ?? section.charAt(0).toUpperCase() + section.slice(1);
    lines.push(`## ${label}`);
    lines.push("");
    for (const page of sectionPages) {
      const url = `${config.baseUrl}${page.urlPath}.md`;
      const description = page.title || page.urlPath;
      lines.push(`- [${description}](${url})`);
    }
    lines.push("");
  }

  const outputPath = path.join(config.buildDir, "llms.txt");
  fs.writeFileSync(outputPath, lines.join("\n"), "utf-8");
  console.log(`  Generated: ${outputPath}`);
}

function generateCustomLlmsFiles(config: LlmfoodConfig, pages: PageEntry[]): void {
  const customFiles = config.customFiles ?? [];

  for (const fileConfig of customFiles) {
    const matchingPages = pages.filter((page) =>
      fileConfig.includePatterns.some((pattern) => pattern.test(page.urlPath))
    );

    const lines: string[] = [];

    if (fileConfig.title) {
      lines.push(`# ${fileConfig.title}`);
      lines.push("");
    }
    if (fileConfig.description) {
      lines.push(`> ${fileConfig.description}`);
      lines.push("");
    }

    for (const page of matchingPages) {
      lines.push(`## ${page.title || page.urlPath}`);
      lines.push("");
      lines.push(`Source: ${config.baseUrl}${page.urlPath}`);
      lines.push("");
      lines.push(page.markdown);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    const outputPath = path.join(config.buildDir, fileConfig.filename);
    fs.writeFileSync(outputPath, lines.join("\n"), "utf-8");
    console.log(`  Generated: ${outputPath}`);
  }
}

function logSkipSummary(skipped: SkippedPage[], verbose: boolean): void {
  if (skipped.length === 0) {
    return;
  }

  const grouped = new Map<SkipReason, SkippedPage[]>();
  for (const entry of skipped) {
    const group = grouped.get(entry.reason);
    if (group) {
      group.push(entry);
    } else {
      grouped.set(entry.reason, [entry]);
    }
  }

  const labels: Record<SkipReason, string> = {
    empty: "empty content",
    error: "processing errors",
    "no-file": "missing files",
    redirect: "redirects",
  };

  const parts = [...grouped.entries()].map(
    ([reason, pages]) => `${pages.length} ${labels[reason]}`
  );
  console.log(`  Skipped ${skipped.length} pages (${parts.join(", ")})`);

  if (verbose) {
    for (const entry of skipped) {
      const suffix =
        entry.reason === "redirect" && entry.redirectTarget ? ` → ${entry.redirectTarget}` : "";
      console.log(`    ${entry.urlPath} (${entry.reason}${suffix})`);
    }
  }
}

export async function generateLlmsMarkdown(config: LlmfoodConfig): Promise<void> {
  console.log("\nDiscovering pages...");

  const ignorePatterns = config.ignorePatterns ?? [];
  const urlPaths = discoverPages(config.buildDir).filter((p) => !shouldIgnore(p, ignorePatterns));
  console.log(`  Found ${urlPaths.length} pages to convert\n`);

  console.log("Converting HTML to Markdown...");
  const pages: PageEntry[] = [];
  const skipped: SkippedPage[] = [];

  for (const p of urlPaths) {
    try {
      const result = await processPage(config, p);
      if (isPageEntry(result)) {
        pages.push(result);
      } else {
        skipped.push(result);
      }
    } catch (e) {
      console.warn(`  Warning: ${p}: ${e}`);
      skipped.push({ reason: "error", urlPath: p });
    }
  }

  console.log(`  Converted ${pages.length} pages`);
  logSkipSummary(skipped, config.verbose ?? false);
  console.log();

  console.log("Generating llms.txt files...");
  generateLlmsTxt(config, pages);
  generateCustomLlmsFiles(config, pages);
}
