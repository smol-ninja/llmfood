export type CustomLlmFile = {
  description?: string;
  filename: string;
  includePatterns: RegExp[];
  title?: string;
};

export type ProcessContext = {
  urlPath: string;
};

export type LlmfoodConfig = {
  baseUrl: string;
  buildDir: string;
  customFiles?: CustomLlmFile[];
  docsDir?: string;
  ignorePatterns?: RegExp[];
  postProcessHtml?: (html: string, context: ProcessContext) => string | Promise<string>;
  postProcessMarkdown?: (markdown: string, context: ProcessContext) => string | Promise<string>;
  rootContent?: string;
  sectionLabels?: Record<string, string>;
  sectionOrder?: string[];
  siteDescription?: string;
  siteTitle?: string;
  verbose?: boolean;
};

export type PageEntry = {
  markdown: string;
  mdPath: string;
  title: string;
  urlPath: string;
};

export type SkipReason = "empty" | "error" | "no-file" | "redirect";

export type SkippedPage = {
  reason: SkipReason;
  redirectTarget?: string;
  urlPath: string;
};
