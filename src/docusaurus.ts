import * as path from "node:path";

import { generateLlmsMarkdown } from "./generate.js";
import type { CustomLlmFile, ProcessContext } from "./types.js";

export type LlmfoodPluginOptions = {
  customFiles?: CustomLlmFile[];
  docsDir?: string;
  ignorePatterns?: RegExp[];
  postProcessHtml?: (html: string, context: ProcessContext) => string | Promise<string>;
  postProcessMarkdown?: (markdown: string, context: ProcessContext) => string | Promise<string>;
  rootContent?: string;
  sectionLabels?: Record<string, string>;
  sectionOrder?: string[];
  verbose?: boolean;
};

type DocusaurusContext = {
  siteDir: string;
  siteConfig: {
    tagline?: string;
    title: string;
    url: string;
  };
};

type DocusaurusPlugin = {
  name: string;
  postBuild: (args: { outDir: string }) => Promise<void>;
};

export default function llmfoodPlugin(
  context: DocusaurusContext,
  options: LlmfoodPluginOptions
): DocusaurusPlugin {
  return {
    name: "llmfood",
    async postBuild({ outDir }) {
      const { siteConfig, siteDir } = context;
      await generateLlmsMarkdown({
        ...options,
        baseUrl: siteConfig.url,
        buildDir: outDir,
        docsDir: options.docsDir ?? path.join(siteDir, "docs"),
        siteDescription: siteConfig.tagline,
        siteTitle: siteConfig.title,
      });
    },
  };
}
