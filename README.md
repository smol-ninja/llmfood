# llmfood

Generate LLM-friendly Markdown from [Docusaurus](https://docusaurus.io/) HTML builds, implementing the
[llms.txt](https://llmstxt.org/) convention.

## Overview

llmfood converts a Docusaurus static HTML build into clean Markdown files optimized for LLM consumption. It:

1. **Discovers** all pages in a Docusaurus build directory
2. **Converts** each HTML page to Markdown, stripping Docusaurus chrome (breadcrumbs, pagination, TOC, footers)
3. **Generates `llms.txt`** — a structured index linking to all converted `.md` files
4. **Generates custom files** — aggregated Markdown files matching URL patterns (e.g., `llms-full.txt`)

## Installation

```bash
npm install llmfood
# or
bun add llmfood
```

## Usage

Create a script that runs after `docusaurus build`:

```typescript
import { generateLlmsMarkdown } from "llmfood";

generateLlmsMarkdown({
  baseUrl: "https://docs.example.com",
  buildDir: "./build",
  siteTitle: "My Docs",
  siteDescription: "Documentation for my project",
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

## API

### `generateLlmsMarkdown(config)`

Processes an entire Docusaurus build and generates `llms.txt` plus any custom files.

#### `LlmfoodConfig`

| Property          | Type                     | Required | Description                                                     |
| ----------------- | ------------------------ | -------- | --------------------------------------------------------------- |
| `baseUrl`         | `string`                 | Yes      | Base URL for generated links (e.g., `https://docs.example.com`) |
| `buildDir`        | `string`                 | Yes      | Path to the Docusaurus build output directory                   |
| `customFiles`     | `CustomLlmFile[]`        | No       | Custom aggregated output files to generate                      |
| `ignorePatterns`  | `RegExp[]`               | No       | URL patterns to exclude (root `/` is always excluded)           |
| `rootContent`     | `string`                 | No       | Additional content to include at the top of `llms.txt`          |
| `sectionLabels`   | `Record<string, string>` | No       | Custom display labels for URL sections                          |
| `sectionOrder`    | `string[]`               | No       | Ordering for sections in `llms.txt`                             |
| `siteDescription` | `string`                 | No       | Site description shown in `llms.txt`                            |
| `siteTitle`       | `string`                 | No       | Site title shown in `llms.txt`                                  |

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

The following Docusaurus chrome is automatically stripped:

- Breadcrumb navigation
- Table of contents sidebar
- Hash links / anchor links
- Pagination navigation
- Document footer
- CSS-in-JS styled spans
- Style tags
- SVG elements

## Limitations

- **Docusaurus-only** — tightly coupled to Docusaurus HTML class names and structure
- **No incremental builds** — re-processes all pages on every run
- **Single `<article>` assumption** — only the first `<article>` tag is processed
- **No CLI** — library-only; consumers must write their own build script
- **Regex-based stripping** — may break if Docusaurus changes its class naming conventions across major versions

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [Bun](https://bun.sh/)

### Setup

```bash
git clone https://github.com/smol-ninja/llmfood.git
cd llmfood
bun install
```

### Commands

```bash
bun run build          # Build the package
bun run test           # Run tests
bun run test:coverage  # Run tests with coverage
bun run test:watch     # Run tests in watch mode
bun run check          # Run all code checks (biome, prettier, types)
bun run fix            # Auto-fix linting and formatting
```

### Code Quality

- **Linting & formatting** — [Biome](https://biomejs.dev/) for JS/TS/JSON, [Prettier](https://prettier.io/) for
  Markdown/YAML
- **Pre-commit hooks** — [Husky](https://typicode.github.io/husky/) +
  [lint-staged](https://github.com/lint-staged/lint-staged)
- **Testing** — [Vitest](https://vitest.dev/) with V8 coverage

## License

[MIT](https://github.com/smol-ninja/llmfood/blob/main/LICENSE)
