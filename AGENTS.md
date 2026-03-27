# Agents

Instructions for AI agents working on this repository.

## Project Overview

llmfood is a TypeScript library that converts Docusaurus HTML builds into LLM-friendly Markdown, implementing the
[llms.txt](https://llmstxt.org/) convention. It is published as an npm package.

## Architecture

```
src/
  index.ts     # Barrel exports (no logic)
  types.ts     # Type definitions (no logic)
  convert.ts   # HTML → Markdown engine (Turndown + custom rules)
  generate.ts  # Orchestrator: page discovery, conversion, llms.txt generation
```

### Data Flow

1. `generateLlmsMarkdown(config)` is the entry point
2. It calls `discoverPages()` to recursively find all `index.html` files in the build directory
3. For each page, `processPage()` reads the HTML and converts to Markdown
4. `htmlToMarkdown()` uses Turndown with custom rules to convert the cleaned HTML to Markdown
5. Finally, `generateLlmsTxt()` and `generateCustomLlmsFiles()` write the output files

### Key Dependencies

- **turndown** — HTML to Markdown conversion (only runtime dependency)

GFM features (tables, strikethrough) are implemented as custom Turndown rules — no plugin dependency.

## Code Conventions

- ESM-only (`"type": "module"` in package.json)
- Use `.js` extensions in import paths (TypeScript compiles to JS)
- Biome for linting and formatting JS/TS/JSON
- Prettier for Markdown and YAML
- No path aliases — use relative imports

## Testing

- Tests live in `tests/` and use Vitest
- Run with `bun run test` or `bun vitest run`
- Run with coverage: `bun run test:coverage` or `bun vitest run --coverage`
- Coverage thresholds: 100% lines, 99% statements, 95% functions, 90% branches
- Tests use real temp directories (via `fs.mkdtempSync`) rather than mocking `fs`
- ESM native modules like `node:fs` cannot be spied on — use real files or alternative approaches

## Building

- `bun run build` cleans and compiles via `tsc`
- Output goes to `dist/`
- Only `dist/**` is published to npm

## Common Tasks

### Adding a new Turndown rule

1. Add the rule in `convert.ts` inside `createTurndownService()`
2. Add a `filter` function to match the HTML element
3. Add a `replacement` function to produce the Markdown
4. Add tests in `tests/convert.test.ts` with realistic Docusaurus HTML wrapped in `<article>` tags

### Adding a new config option

1. Add the type to `LlmfoodConfig` in `types.ts`
2. Use it in `generate.ts`
3. Export it from `index.ts` if it's a new type
4. Add tests in `tests/generate.test.ts`
5. Document in `README.md`

## Don'ts

- Do not mock `node:fs` — ESM exports are non-configurable. Use real temp directories instead.
- Do not add a CLI — this is a library package. CLI usage is the consumer's responsibility.
- Do not add runtime dependencies unless absolutely necessary — the package should stay lightweight.
- Do not modify `dist/` — it is a build artifact and gitignored.
