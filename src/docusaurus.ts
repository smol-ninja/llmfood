import { generateLlmsMarkdown } from "./generate.js";
import type { CustomLlmFile, ProcessContext } from "./types.js";

export type LlmfoodPluginOptions = {
  customFiles?: CustomLlmFile[];
  ignorePatterns?: RegExp[];
  postProcessHtml?: (html: string, context: ProcessContext) => string | Promise<string>;
  postProcessMarkdown?: (markdown: string, context: ProcessContext) => string | Promise<string>;
  rootContent?: string;
  sectionLabels?: Record<string, string>;
  sectionOrder?: string[];
  verbose?: boolean;
};

type DocusaurusContext = {
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
      const { siteConfig } = context;
      await generateLlmsMarkdown({
        baseUrl: siteConfig.url,
        buildDir: outDir,
        siteDescription: siteConfig.tagline,
        siteTitle: siteConfig.title,
        ...options,
      });
    },
  };
}
