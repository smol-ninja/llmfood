import TurndownService from "turndown";

/**
 * Regex patterns to strip Docusaurus chrome from HTML before conversion.
 * Turndown only supports tag-name selectors (not CSS class selectors),
 * so we pre-process the HTML with regex to remove these elements.
 */
const HTML_STRIP_PATTERNS: RegExp[] = [
  /<nav[^>]*class="theme-doc-breadcrumbs[^"]*"[^>]*>[\s\S]*?<\/nav>/g,
  /<div[^>]*class="tocCollapsible[^"]*"[^>]*>[\s\S]*?<\/button><\/div>/g,
  /<a[^>]*class=hash-link[^>]*>[^<]*<\/a>/g,
  /<nav[^>]*class="pagination-nav[^"]*"[\s\S]*?<\/nav>/g,
  /<footer[^>]*class="theme-doc-footer[^"]*"[\s\S]*?<\/footer>/g,
  /<span class=css-[a-z0-9]+>[\s\S]*?<\/span>/g,
  /<style[^>]*>[\s\S]*?<\/style>/g,
];

const LANGUAGE_CLASS_PATTERN = /^language-(.+)$/;
const TRAILING_NEWLINE_PATTERN = /\n$/;
const ARTICLE_PATTERN = /<article[^>]*>([\s\S]*?)<\/article>/;
const HEADING_ANCHOR_PATTERN = /\[​\]\(#[^)]*\s*(?:"[^"]*")?\)/g;
const MULTI_NEWLINE_PATTERN = /\n{3,}/g;
const THEME_DOC_MARKDOWN_PATTERN = /<div class="theme-doc-markdown markdown">/g;
const EMPTY_COMMENT_PATTERN = /<!--\s*-->/g;

function createTurndownService(): TurndownService {
  const turndownService = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
    hr: "---",
  });

  turndownService.remove((node: HTMLElement) => node.nodeName === "svg");

  // GFM: tables
  turndownService.addRule("table", {
    filter: "table",
    replacement(_content, node) {
      const table = node as HTMLElement;
      const rows = table.querySelectorAll("tr");
      if (rows.length === 0) {
        return "";
      }

      const headerRow = rows[0];
      const headerCells = headerRow.querySelectorAll("th");

      if (headerCells.length === 0) {
        return convertTableWithoutHeader(table, turndownService);
      }

      const alignments = extractAlignments(headerCells);
      const headers = cellsToMarkdown(headerCells, turndownService);
      const separator = alignments.map((a) => {
        if (a === "center") {
          return ":---:";
        }
        if (a === "right") {
          return "---:";
        }
        return "---";
      });

      const lines = [`| ${headers.join(" | ")} |`, `| ${separator.join(" | ")} |`];

      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].querySelectorAll("td");
        const values = cellsToMarkdown(cells, turndownService);
        while (values.length < headers.length) {
          values.push("");
        }
        lines.push(`| ${values.join(" | ")} |`);
      }

      return `\n\n${lines.join("\n")}\n\n`;
    },
  });

  // GFM: strikethrough
  turndownService.addRule("strikethrough", {
    filter: ["del", "s"],
    replacement(content) {
      return `~~${content}~~`;
    },
  });

  turndownService.addRule("codeBlock", {
    filter(node) {
      return node.nodeName === "PRE" && node.classList.contains("prism-code");
    },
    replacement(_content, node) {
      const element = node as HTMLElement;
      const lang = extractLanguage(element);
      const code = extractCodeText(element);
      return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    },
  });

  turndownService.addRule("admonition", {
    filter(node) {
      return node.nodeName === "DIV" && node.classList.contains("theme-admonition");
    },
    replacement(_content, node) {
      const element = node as HTMLElement;
      const type = extractAdmonitionType(element);
      const title = extractAdmonitionTitle(element);
      const body = extractAdmonitionBody(element, turndownService);

      const titleLine = title && title.toLowerCase() !== type.toLowerCase() ? ` [${title}]` : "";
      return `\n\n:::${type}${titleLine}\n\n${body}\n\n:::\n\n`;
    },
  });

  turndownService.addRule("tabs", {
    filter(node) {
      return node.nodeName === "DIV" && node.classList.contains("tabs-container");
    },
    replacement(_content, node) {
      const element = node as HTMLElement;
      const panels = element.querySelectorAll('[role="tabpanel"]');
      const tabButtons = element.querySelectorAll('[role="tab"]');

      const parts: string[] = [];
      for (const [i, panel] of Array.from(panels).entries()) {
        const label = tabButtons[i]?.textContent?.trim() ?? `Tab ${i + 1}`;
        const panelContent = turndownService.turndown(panel.innerHTML);
        parts.push(`**${label}**\n\n${panelContent}`);
      }

      return `\n\n${parts.join("\n\n")}\n\n`;
    },
  });

  turndownService.addRule("details", {
    filter: "details",
    replacement(_content, node) {
      const element = node as HTMLElement;
      const summary = element.querySelector("summary");
      const summaryText = summary?.textContent?.trim() ?? "Details";

      const clone = element.cloneNode(true) as HTMLElement;
      const summaryEl = clone.querySelector("summary");
      summaryEl?.remove();
      const body = turndownService.turndown(clone.innerHTML);

      return `\n\n<details>\n<summary>${summaryText}</summary>\n\n${body}\n\n</details>\n\n`;
    },
  });

  turndownService.addRule("mathBlock", {
    filter(node) {
      return node.nodeName === "SPAN" && node.classList.contains("katex-display");
    },
    replacement(_content, node) {
      const element = node as HTMLElement;
      const annotation = element.querySelector('annotation[encoding="application/x-tex"]');
      if (annotation?.textContent) {
        return `\n\n$$\n${annotation.textContent.trim()}\n$$\n\n`;
      }
      /* v8 ignore next */
      return "";
    },
  });

  turndownService.addRule("mathInline", {
    filter(node) {
      return (
        node.nodeName === "SPAN" &&
        node.classList.contains("katex") &&
        !node.parentElement?.classList.contains("katex-display")
      );
    },
    replacement(_content, node) {
      const element = node as HTMLElement;
      const annotation = element.querySelector('annotation[encoding="application/x-tex"]');
      if (annotation?.textContent) {
        return `$${annotation.textContent.trim()}$`;
      }
      /* v8 ignore next */
      return "";
    },
  });

  turndownService.addRule("images", {
    filter: "img",
    replacement(_content, node) {
      const element = node as HTMLElement;
      const src = element.getAttribute("src") ?? "";
      const alt = element.getAttribute("alt") ?? "";
      if (!src || src.includes("data:image")) {
        return "";
      }
      return `![${alt}](${src})`;
    },
  });

  return turndownService;
}

function extractLanguage(preElement: HTMLElement): string {
  for (const cls of preElement.className.split(" ")) {
    const match = cls.match(LANGUAGE_CLASS_PATTERN);
    if (match) {
      return match[1];
    }
  }
  return "";
}

function extractCodeText(preElement: HTMLElement): string {
  const codeElement = preElement.querySelector("code");
  if (!codeElement) {
    return preElement.textContent ?? "";
  }

  const lines: string[] = [];
  const tokenLines = codeElement.querySelectorAll(".token-line");

  if (tokenLines.length > 0) {
    for (const line of Array.from(tokenLines)) {
      lines.push(line.textContent ?? "");
    }
  } else {
    return codeElement.textContent ?? "";
  }

  return lines.join("\n").replace(TRAILING_NEWLINE_PATTERN, "");
}

function extractAdmonitionType(element: HTMLElement): string {
  const classes = element.className;
  const types = ["tip", "warning", "info", "caution", "danger", "note", "important"];
  for (const type of types) {
    if (classes.includes(`theme-admonition-${type}`)) {
      return type;
    }
  }
  return "note";
}

function extractAdmonitionTitle(element: HTMLElement): string {
  const heading = element.querySelector('[class*="admonitionHeading"]');
  if (!heading) {
    return "";
  }
  const clone = heading.cloneNode(true) as HTMLElement;
  clone.querySelector('[class*="admonitionIcon"]')?.remove();
  return clone.textContent?.trim() ?? "";
}

function extractAdmonitionBody(element: HTMLElement, service: TurndownService): string {
  const content = element.querySelector('[class*="admonitionContent"]');
  if (!content) {
    return "";
  }
  return service.turndown(content.innerHTML).trim();
}

function extractAlignments(cells: NodeListOf<Element>): string[] {
  return Array.from(cells).map((cell) => {
    const style = (cell as HTMLElement).getAttribute("style") ?? "";
    if (style.includes("text-align:center") || style.includes("text-align: center")) {
      return "center";
    }
    if (style.includes("text-align:right") || style.includes("text-align: right")) {
      return "right";
    }
    return "left";
  });
}

function cellsToMarkdown(cells: NodeListOf<Element>, td: TurndownService): string[] {
  return Array.from(cells).map((cell) => {
    const html = (cell as HTMLElement).innerHTML;
    return td.turndown(html).replace(/\n/g, " ").replace(/\|/g, "\\|").trim();
  });
}

function convertTableWithoutHeader(table: HTMLElement, td: TurndownService): string {
  const rows = table.querySelectorAll("tr");
  /* v8 ignore next 3 */
  if (rows.length === 0) {
    return "";
  }

  const firstCells = rows[0].querySelectorAll("td");
  const colCount = firstCells.length;
  const headers = Array.from({ length: colCount }, (_, i) => `Col ${i + 1}`);
  const separator = Array.from({ length: colCount }, () => "---");

  const lines = [`| ${headers.join(" | ")} |`, `| ${separator.join(" | ")} |`];

  for (const row of Array.from(rows)) {
    const cells = row.querySelectorAll("td");
    const values = cellsToMarkdown(cells, td);
    while (values.length < colCount) {
      values.push("");
    }
    lines.push(`| ${values.join(" | ")} |`);
  }

  return `\n\n${lines.join("\n")}\n\n`;
}

let service: TurndownService | undefined;

function getService(): TurndownService {
  if (!service) {
    service = createTurndownService();
  }
  return service;
}

export function htmlToMarkdown(html: string): string {
  const turndownService = getService();

  const articleMatch = html.match(ARTICLE_PATTERN);
  if (!articleMatch) {
    return "";
  }

  let articleHtml = articleMatch[1];

  for (const pattern of HTML_STRIP_PATTERNS) {
    articleHtml = articleHtml.replace(pattern, "");
  }

  articleHtml = articleHtml.replace(THEME_DOC_MARKDOWN_PATTERN, "<div>");
  articleHtml = articleHtml.replace(EMPTY_COMMENT_PATTERN, "");

  let markdown = turndownService.turndown(articleHtml);

  // Remove heading anchor links (e.g., [​](#heading "Direct link to ..."))
  markdown = markdown.replace(HEADING_ANCHOR_PATTERN, "");

  return markdown.replace(MULTI_NEWLINE_PATTERN, "\n\n").trim();
}
