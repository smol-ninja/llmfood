import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/convert.js";

function wrap(inner: string): string {
  return `<article>${inner}</article>`;
}

describe("htmlToMarkdown", () => {
  it("returns empty string when no <article> tag is present", () => {
    expect(htmlToMarkdown("<div>no article</div>")).toBe("");
  });

  it("converts basic paragraph content", () => {
    const html = wrap("<p>Hello world</p>");
    expect(htmlToMarkdown(html)).toBe("Hello world");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Docusaurus chrome stripping
  // ──────────────────────────────────────────────────────────────────────────

  it("strips breadcrumb navigation", () => {
    const html = wrap(
      '<nav aria-label="Breadcrumbs" class="theme-doc-breadcrumbs"><ul><li>Home</li></ul></nav><p>Content</p>'
    );
    expect(htmlToMarkdown(html)).toBe("Content");
  });

  it("strips collapsible TOC", () => {
    const html = wrap(
      '<div class="tocCollapsible tocCollapsible_abc">TOC content</button></div><p>Content</p>'
    );
    expect(htmlToMarkdown(html)).toBe("Content");
  });

  it("strips hash links", () => {
    const html = wrap('<p>Title<a class=hash-link href="#title">#</a></p>');
    expect(htmlToMarkdown(html)).toBe("Title");
  });

  it("strips pagination nav", () => {
    const html = wrap(
      '<p>Content</p><nav class="pagination-nav docusaurus-mt-lg"><a>Previous</a><a>Next</a></nav>'
    );
    expect(htmlToMarkdown(html)).toBe("Content");
  });

  it("strips doc footer", () => {
    const html = wrap(
      '<p>Content</p><footer class="theme-doc-footer docusaurus-mt-lg">Footer</footer>'
    );
    expect(htmlToMarkdown(html)).toBe("Content");
  });

  it("strips css-* spans", () => {
    const html = wrap("<p>Before<span class=css-abc123>styled</span>After</p>");
    expect(htmlToMarkdown(html)).toBe("BeforeAfter");
  });

  it("strips style tags", () => {
    const html = wrap("<style>.foo { color: red; }</style><p>Content</p>");
    expect(htmlToMarkdown(html)).toBe("Content");
  });

  it("replaces theme-doc-markdown divs with plain divs", () => {
    const html = wrap('<div class="theme-doc-markdown markdown"><p>Content</p></div>');
    expect(htmlToMarkdown(html)).toBe("Content");
  });

  it("strips empty HTML comments", () => {
    const html = wrap("<!-- --><p>Content</p><!--  -->");
    expect(htmlToMarkdown(html)).toBe("Content");
  });

  it("removes heading anchor links from converted markdown", () => {
    const html = wrap('<h2>Title<a href="#title" title="Direct link to Title">\u200B</a></h2>');
    const result = htmlToMarkdown(html);
    expect(result).toContain("Title");
    expect(result).not.toContain("[​]");
  });

  it("collapses triple+ newlines into double newlines", () => {
    const html = wrap("<p>A</p><br><br><br><br><p>B</p>");
    const result = htmlToMarkdown(html);
    expect(result).not.toMatch(/\n{3,}/);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Code blocks
  // ──────────────────────────────────────────────────────────────────────────

  it("converts Prism code blocks with language class", () => {
    const html = wrap(
      '<pre class="prism-code language-typescript"><code>' +
        '<span class="token-line">const x = 1;</span>' +
        '<span class="token-line">const y = 2;</span>' +
        "</code></pre>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("```typescript");
    expect(result).toContain("const x = 1;");
    expect(result).toContain("const y = 2;");
    expect(result).toContain("```");
  });

  it("handles Prism code blocks without language class", () => {
    const html = wrap(
      '<pre class="prism-code"><code><span class="token-line">hello</span></code></pre>'
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("```\nhello\n```");
  });

  it("handles code blocks without token-line spans", () => {
    const html = wrap('<pre class="prism-code language-js"><code>plain code text</code></pre>');
    const result = htmlToMarkdown(html);
    expect(result).toContain("```js");
    expect(result).toContain("plain code text");
  });

  it("handles code blocks without code element", () => {
    const html = wrap('<pre class="prism-code language-sh">raw text</pre>');
    const result = htmlToMarkdown(html);
    expect(result).toContain("```sh");
    expect(result).toContain("raw text");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Admonitions
  // ──────────────────────────────────────────────────────────────────────────

  it("converts tip admonition with custom title", () => {
    const html = wrap(
      '<div class="theme-admonition theme-admonition-tip">' +
        '<div class="admonitionHeading"><span class="admonitionIcon">💡</span>Pro Tip</div>' +
        '<div class="admonitionContent"><p>This is helpful.</p></div>' +
        "</div>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain(":::tip [Pro Tip]");
    expect(result).toContain("This is helpful.");
    expect(result).toContain(":::");
  });

  it("converts warning admonition without custom title", () => {
    const html = wrap(
      '<div class="theme-admonition theme-admonition-warning">' +
        '<div class="admonitionHeading"><span class="admonitionIcon">⚠️</span>Warning</div>' +
        '<div class="admonitionContent"><p>Be careful.</p></div>' +
        "</div>"
    );
    const result = htmlToMarkdown(html);
    // Title matches type so no [title] suffix
    expect(result).toContain(":::warning");
    expect(result).not.toContain("[Warning]");
  });

  it("handles admonition without heading", () => {
    const html = wrap(
      '<div class="theme-admonition theme-admonition-info">' +
        '<div class="admonitionContent"><p>Info content.</p></div>' +
        "</div>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain(":::info");
    expect(result).toContain("Info content.");
  });

  it("handles admonition without content", () => {
    const html = wrap(
      '<div class="theme-admonition theme-admonition-danger">' +
        '<div class="admonitionHeading">Danger</div>' +
        "</div>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain(":::danger");
  });

  it("falls back to 'note' for unknown admonition type", () => {
    const html = wrap(
      '<div class="theme-admonition theme-admonition-custom">' +
        '<div class="admonitionContent"><p>Custom.</p></div>' +
        "</div>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain(":::note");
  });

  it("handles admonition heading without icon", () => {
    const html = wrap(
      '<div class="theme-admonition theme-admonition-caution">' +
        '<div class="admonitionHeading">Be Cautious</div>' +
        '<div class="admonitionContent"><p>Watch out.</p></div>' +
        "</div>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain(":::caution [Be Cautious]");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Tabs
  // ──────────────────────────────────────────────────────────────────────────

  it("converts tabs container", () => {
    const html = wrap(
      '<div class="tabs-container">' +
        '<div role="tab">JavaScript</div>' +
        '<div role="tab">Python</div>' +
        '<div role="tabpanel"><p>JS code</p></div>' +
        '<div role="tabpanel"><p>Python code</p></div>' +
        "</div>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("**JavaScript**");
    expect(result).toContain("JS code");
    expect(result).toContain("**Python**");
    expect(result).toContain("Python code");
  });

  it("uses fallback tab label when button is missing", () => {
    const html = wrap(
      '<div class="tabs-container"><div role="tabpanel"><p>Content</p></div></div>'
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("**Tab 1**");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Details/Summary
  // ──────────────────────────────────────────────────────────────────────────

  it("converts details/summary elements", () => {
    const html = wrap("<details><summary>Click me</summary><p>Hidden content</p></details>");
    const result = htmlToMarkdown(html);
    expect(result).toContain("<details>");
    expect(result).toContain("<summary>Click me</summary>");
    expect(result).toContain("Hidden content");
    expect(result).toContain("</details>");
  });

  it("uses default summary text when summary is missing", () => {
    const html = wrap("<details><p>No summary here</p></details>");
    const result = htmlToMarkdown(html);
    expect(result).toContain("<summary>Details</summary>");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Math (KaTeX)
  // ──────────────────────────────────────────────────────────────────────────

  it("converts block math (KaTeX display)", () => {
    const html = wrap(
      '<span class="katex-display"><span class="katex">' +
        '<annotation encoding="application/x-tex">E = mc^2</annotation>' +
        "</span></span>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("$$\nE = mc^2\n$$");
  });

  it("returns empty for block math without annotation", () => {
    const html = wrap('<span class="katex-display"><span class="katex"></span></span>');
    const result = htmlToMarkdown(html);
    expect(result).toBe("");
  });

  it("returns empty for block math with annotation element but no textContent", () => {
    const html = wrap(
      '<span class="katex-display"><span class="katex">' +
        '<annotation encoding="application/x-tex"></annotation>' +
        "</span></span>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toBe("");
  });

  it("converts inline math (KaTeX)", () => {
    const html = wrap(
      '<p>The formula <span class="katex">' +
        '<annotation encoding="application/x-tex">x^2</annotation>' +
        "</span> is simple.</p>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("$x^2$");
  });

  it("returns empty for inline math without annotation", () => {
    const html = wrap('<p>Formula <span class="katex"></span> here.</p>');
    const result = htmlToMarkdown(html);
    expect(result).not.toContain("$");
  });

  it("returns empty for inline math with annotation element but no textContent", () => {
    const html = wrap(
      '<p>Formula <span class="katex">' +
        '<annotation encoding="application/x-tex"></annotation>' +
        "</span> here.</p>"
    );
    const result = htmlToMarkdown(html);
    expect(result).not.toContain("$");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Images
  // ──────────────────────────────────────────────────────────────────────────

  it("converts images with src and alt", () => {
    const html = wrap('<img src="/img/logo.png" alt="Logo">');
    const result = htmlToMarkdown(html);
    expect(result).toBe("![Logo](/img/logo.png)");
  });

  it("skips data:image sources", () => {
    const html = wrap('<img src="data:image/png;base64,abc" alt="Inline">');
    expect(htmlToMarkdown(html)).toBe("");
  });

  it("skips images without src", () => {
    const html = wrap('<img alt="No source">');
    expect(htmlToMarkdown(html)).toBe("");
  });

  it("handles images with empty alt", () => {
    const html = wrap('<img src="/img/photo.jpg" alt="">');
    expect(htmlToMarkdown(html)).toBe("![](/img/photo.jpg)");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SVG removal
  // ──────────────────────────────────────────────────────────────────────────

  it("removes SVG elements", () => {
    const html = wrap("<p>Text</p><svg><path d='M0 0'/></svg>");
    const result = htmlToMarkdown(html);
    expect(result).toBe("Text");
    expect(result).not.toContain("svg");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Tables
  // ──────────────────────────────────────────────────────────────────────────

  it("converts a basic table with headers", () => {
    const html = wrap(
      "<table><thead><tr><th>Name</th><th>Value</th></tr></thead>" +
        "<tbody><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></tbody></table>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("| Name | Value |");
    expect(result).toContain("| --- | --- |");
    expect(result).toContain("| A | 1 |");
    expect(result).toContain("| B | 2 |");
  });

  it("converts table with center alignment", () => {
    const html = wrap(
      '<table><thead><tr><th>Left</th><th style="text-align:center">Center</th></tr></thead>' +
        '<tbody><tr><td>a</td><td style="text-align:center">b</td></tr></tbody></table>'
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("| Left | Center |");
    expect(result).toContain("| --- | :---: |");
  });

  it("converts table with right alignment", () => {
    const html = wrap(
      '<table><thead><tr><th style="text-align:right">Amount</th></tr></thead>' +
        '<tbody><tr><td style="text-align:right">100</td></tr></tbody></table>'
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("| Amount |");
    expect(result).toContain("| ---: |");
    expect(result).toContain("| 100 |");
  });

  it("converts table with spaced text-align style", () => {
    const html = wrap(
      '<table><thead><tr><th style="text-align: center">Col</th></tr></thead>' +
        "<tbody><tr><td>val</td></tr></tbody></table>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("| :---: |");
  });

  it("converts table matching Docusaurus minified output", () => {
    const html = wrap(
      "<table><thead><tr>" +
        "<th>Action" +
        "<th style=text-align:center>Sender" +
        "<th style=text-align:center>Public" +
        "<tbody><tr>" +
        "<td>Deposit" +
        "<td style=text-align:center>✅" +
        "<td style=text-align:center>✅" +
        "</table>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("| Action | Sender | Public |");
    expect(result).toContain("| --- | :---: | :---: |");
    expect(result).toContain("| Deposit | ✅ | ✅ |");
  });

  it("handles table with links in cells", () => {
    const html = wrap(
      "<table><thead><tr><th>Name</th></tr></thead>" +
        '<tbody><tr><td><a href="https://example.com">Link</a></td></tr></tbody></table>'
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("[Link](https://example.com)");
  });

  it("escapes pipe characters in cell content", () => {
    const html = wrap(
      "<table><thead><tr><th>Expression</th></tr></thead>" +
        "<tbody><tr><td>a | b</td></tr></tbody></table>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("a \\| b");
  });

  it("pads short rows to match header length", () => {
    const html = wrap(
      "<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>" +
        "<tbody><tr><td>1</td></tr></tbody></table>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("| 1 |  |  |");
  });

  it("handles table with no rows", () => {
    const html = wrap("<table></table>");
    const result = htmlToMarkdown(html);
    expect(result).toBe("");
  });

  it("handles table without thead (data-only)", () => {
    const html = wrap(
      "<table><tbody><tr><td>X</td><td>Y</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("| Col 1 | Col 2 |");
    expect(result).toContain("| --- | --- |");
    expect(result).toContain("| X | Y |");
    expect(result).toContain("| 1 | 2 |");
  });

  it("pads short rows in no-header table", () => {
    const html = wrap(
      "<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>1</td></tr></tbody></table>"
    );
    const result = htmlToMarkdown(html);
    expect(result).toContain("| 1 |  |");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Strikethrough
  // ──────────────────────────────────────────────────────────────────────────

  it("converts <del> to strikethrough", () => {
    const html = wrap("<p>This is <del>deleted</del> text.</p>");
    const result = htmlToMarkdown(html);
    expect(result).toContain("~~deleted~~");
  });

  it("converts <s> to strikethrough", () => {
    const html = wrap("<p>This is <s>struck</s> text.</p>");
    const result = htmlToMarkdown(html);
    expect(result).toContain("~~struck~~");
  });
});
