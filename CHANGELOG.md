# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[1.0.1]: https://github.com/smol-ninja/llmfood/releases/tag/v1.0.1
[1.0.0]: https://github.com/smol-ninja/llmfood/releases/tag/v1.0.0

## [1.0.1] - 2026-03-31

### Fixed

- Block IPv6-mapped IPv4 (`[::ffff:]`) and link-local (`[fe80::]`) addresses in SSRF filter

## [1.0.0] - 2026-03-29

### Added

- HTML to Markdown conversion with custom Turndown rules for Docusaurus elements (code blocks, admonitions, tabs,
  details, KaTeX math, tables, strikethrough, YouTube iframes, mermaid)
- Docusaurus chrome stripping (breadcrumbs, TOC, pagination, footer, hash links, SVGs)
- `llms.txt` index generation with configurable sections
- Custom aggregated output files via `customFiles`
- Docusaurus plugin (`llmfood/docusaurus`) for zero-config integration
- Source file scanning for GitHub code references, mermaid diagrams, and remote content (`docsDir`)
- MDX snippet inlining and frontmatter `id` slug matching
- `postProcessHtml` and `postProcessMarkdown` hooks
- `resolveRemoteUrl` hook for JSX expression resolution
- Skip reporting (redirects, empty pages, errors) with verbose mode
