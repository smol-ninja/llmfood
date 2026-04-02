# llmfood

[![CI](https://github.com/smol-ninja/llmfood/actions/workflows/ci.yml/badge.svg)](https://github.com/smol-ninja/llmfood/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/llmfood.svg)](https://www.npmjs.com/package/llmfood)

Generate LLM-friendly Markdown from [Docusaurus](https://docusaurus.io/) HTML builds, implementing the
[llms.txt](https://llmstxt.org/) convention.

## Overview

llmfood converts a Docusaurus static HTML build into clean Markdown files optimized for LLM consumption. It:

1. **Discovers** all pages in a Docusaurus build directory
2. **Resolves** client-side content that doesn't exist in static HTML (GitHub code references, remote content, mermaid
   diagrams)
3. **Converts** each HTML page to Markdown, stripping Docusaurus chrome (breadcrumbs, pagination, TOC, footers)
4. **Generates `llms.txt`** — a structured index linking to all converted `.md` files
5. **Generates custom files** — aggregated Markdown files matching URL patterns (e.g., `llms-full.txt`)

## Installation

```bash
npm install llmfood
# or
bun add llmfood
```

## Usage

### Docusaurus Plugin (recommended)

Add llmfood as a Docusaurus plugin for zero-config integration. It runs automatically after `docusaurus build`:

```javascript
// docusaurus.config.js
module.exports = {
  plugins: [
    [
      "llmfood/docusaurus",
      {
        sectionOrder: ["guides", "api", "concepts"],
        sectionLabels: { guides: "Guides", api: "API Reference" },
        customFiles: [
          {
            filename: "llms-full.txt",
            title: "Full Documentation",
            description: "Complete documentation in a single file",
            includePatterns: [/.*/],
          },
        ],
      },
    ],
  ],
};
```

The plugin automatically derives `baseUrl`, `buildDir`, `siteTitle`, and `siteDescription` from your Docusaurus config.
It also sets `docsDir` to `{siteDir}/docs` by default, enabling source file scanning for mermaid diagrams and remote
content resolution.

### Standalone

```typescript
import { generateLlmsMarkdown } from "llmfood";

await generateLlmsMarkdown({
  baseUrl: "https://docs.example.com",
  buildDir: "./build",
  siteTitle: "My Docs",
  siteDescription: "Documentation for my project",
  docsDir: "./docs", // optional: enables source file scanning
  sectionOrder: ["guides", "api", "concepts"],
  sectionLabels: { guides: "Guides", api: "API Reference" },
  ignorePatterns: [/\/blog\//],
  customFiles: [
    {
      filename: "llms-full.txt",
      title: "Full Documentation",
      description: "Complete documentation in a single file",
      includePatterns: [/.*/],
    },
  ],
});
```

### Standalone HTML to Markdown

You can also use the converter directly:

```typescript
import { htmlToMarkdown } from "llmfood";

const markdown = htmlToMarkdown(docusaurusHtmlString);
```

## Content Resolution

Some Docusaurus plugins render content client-side, so the static HTML contains placeholders instead of real content.
When `docsDir` is set, llmfood scans MDX source files and resolves these automatically:

| Pattern                | Source detection                                                                                 | Resolution                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| GitHub code references | `CodeBlock` JSX, fenced ` ```lang reference `, and `children`/`src`/`srcUrl`/`source` attributes | Fetches code from `raw.githubusercontent.com` with line ranges    |
| Remote content         | `url="..."` or `url={expr}` in MDX                                                               | Fetches remote markdown (JSX expressions via `resolveRemoteUrl`)  |
| Mermaid diagrams       | ` ```mermaid ` blocks in MDX                                                                     | Injects mermaid source into HTML (client-side renders leave none) |
| YouTube embeds         | `<iframe>` with YouTube URL in HTML                                                              | Converts to `[title](youtube-url)` markdown link                  |

Source scanning also resolves imported MDX snippets (`import Foo from "./_snippet.mdx"`), substitutes `${props.x}`
expressions using caller prop values, and matches files by frontmatter `id` when the slug differs from the filename.

All external fetches run in parallel with a concurrency limit of 6.

## API

### `generateLlmsMarkdown(config)`

Processes an entire Docusaurus build and generates `llms.txt` plus any custom files.

#### `LlmfoodConfig`

| Property              | Type                        | Required | Description                                                                 |
| --------------------- | --------------------------- | -------- | --------------------------------------------------------------------------- |
| `baseUrl`             | `string`                    | Yes      | Base URL for generated links (e.g., `https://docs.example.com`)             |
| `buildDir`            | `string`                    | Yes      | Path to the Docusaurus build output directory                               |
| `customFiles`         | `CustomLlmFile[]`           | No       | Custom aggregated output files to generate                                  |
| `docsDir`             | `string`                    | No       | Path to docs source directory (enables mermaid + remote content resolution) |
| `ignorePatterns`      | `RegExp[]`                  | No       | URL patterns to exclude (root `/` is always excluded)                       |
| `postProcessHtml`     | `(html, context) => string` | No       | Hook to transform HTML before markdown conversion                           |
| `postProcessMarkdown` | `(md, context) => string`   | No       | Hook to transform markdown after conversion                                 |
| `resolveRemoteUrl`    | `(expr) => string`          | No       | Resolve JSX expressions (e.g., `getBenchmarkURL(...)`) to fetch URLs        |
| `rootContent`         | `string`                    | No       | Additional content to include at the top of `llms.txt`                      |
| `sectionLabels`       | `Record<string, string>`    | No       | Custom display labels for URL sections                                      |
| `sectionOrder`        | `string[]`                  | No       | Ordering for sections in `llms.txt`                                         |
| `siteDescription`     | `string`                    | No       | Site description shown in `llms.txt`                                        |
| `siteTitle`           | `string`                    | No       | Site title shown in `llms.txt`                                              |
| `verbose`             | `boolean`                   | No       | Log individual skipped pages with reasons                                   |

Both hooks receive a `ProcessContext` with `{ urlPath: string }` and may return a `Promise`.

#### `CustomLlmFile`

| Property          | Type       | Required | Description                              |
| ----------------- | ---------- | -------- | ---------------------------------------- |
| `filename`        | `string`   | Yes      | Output filename (e.g., `llms-full.txt`)  |
| `includePatterns` | `RegExp[]` | Yes      | URL patterns to include in this file     |
| `description`     | `string`   | No       | Description shown at the top of the file |
| `title`           | `string`   | No       | Title shown at the top of the file       |

### `htmlToMarkdown(html)`

Converts a Docusaurus HTML string to clean Markdown. Expects the content to be wrapped in an `<article>` tag.

Returns an empty string if no `<article>` element is found.

## Supported Docusaurus Elements

The converter handles these Docusaurus-specific elements:

- **Prism code blocks** — preserves language and syntax highlighting structure
- **Admonitions** — converts to `:::type [title]` syntax (`tip`, `warning`, `info`, `caution`, `danger`, `note`,
  `important`)
- **Tabs** — renders each tab panel with its label as a bold heading
- **Details/Summary** — preserves as HTML `<details>` elements
- **KaTeX math** — converts to `$$...$$` (block) and `$...$` (inline) syntax
- **Images** — converts to standard Markdown, skipping data URIs
- **Tables** — converts to GFM table syntax with alignment support (`:---:`, `---:`)
- **Strikethrough** — converts `<del>` and `<s>` to `~~text~~`
- **YouTube iframes** — converts to markdown links with video title
- **Mermaid code blocks** — preserves as fenced mermaid code blocks (when source is available)

Pages that can't be converted are tracked and summarized. Set `verbose: true` to see individual skipped pages with
reasons (redirects, empty pages, missing files, errors).

## License

[MIT](https://github.com/smol-ninja/llmfood/blob/main/LICENSE)
