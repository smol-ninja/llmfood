export type CustomLlmFile = {
  description?: string;
  filename: string;
  includePatterns: RegExp[];
  title?: string;
};

export type LlmfoodConfig = {
  baseUrl: string;
  buildDir: string;
  customFiles?: CustomLlmFile[];
  ignorePatterns?: RegExp[];
  rootContent?: string;
  sectionLabels?: Record<string, string>;
  sectionOrder?: string[];
  siteDescription?: string;
  siteTitle?: string;
};

export type PageEntry = {
  markdown: string;
  mdPath: string;
  title: string;
  urlPath: string;
};
