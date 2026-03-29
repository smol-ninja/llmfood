# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[1.0.0]: https://github.com/smol-ninja/llmfood/releases/tag/v1.0.0

## [1.0.0] - 2026-03-29

### Added

- HTML to Markdown conversion engine with custom Turndown rules for Docusaurus elements: Prism code blocks, admonitions,
  tabs, details/summary, KaTeX math (block and inline), images, tables (with alignment), strikethrough, YouTube iframes,
  and mermaid code blocks
- Docusaurus chrome stripping: breadcrumbs, TOC sidebar, hash links, pagination, footer, CSS-in-JS spans, style tags,
  SVG elements
- `llms.txt` generation with configurable section ordering and labels
- Custom aggregated output files via `customFiles` config (e.g., `llms-full.txt`)
- Docusaurus plugin (`llmfood/docusaurus`) for zero-config integration
- Content resolution from source MDX files:
  - GitHub code references from `CodeBlock` JSX and fenced reference blocks
  - Mermaid diagram injection from source (client-side rendered, no trace in static HTML)
  - Remote content resolution with `resolveRemoteUrl` hook for JSX expressions
- MDX snippet inlining — resolves `import` statements to include snippet content before scanning
- Frontmatter `id` support — source map matches both filename and frontmatter id for slug overrides
- Numeric prefix stripping — `01-intro.mdx` maps to `/intro` URL path
- Skip reporting with categorized reasons (empty, redirect, error, missing file) and verbose mode
- `postProcessHtml` and `postProcessMarkdown` hooks for consumer customization
- Redirect detection via `<meta http-equiv="refresh">`
- Parallel fetching with concurrency limit of 6 for all external requests
- 10-second fetch timeout with `AbortSignal`
