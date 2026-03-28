import { describe, expect, it, vi } from "vitest";

vi.mock("../src/generate.js", () => ({
  generateLlmsMarkdown: vi.fn(),
}));

import llmfoodPlugin from "../src/docusaurus.js";
import { generateLlmsMarkdown } from "../src/generate.js";

const mockGenerate = vi.mocked(generateLlmsMarkdown);

describe("llmfoodPlugin", () => {
  const context = {
    siteDir: "/site",
    siteConfig: {
      tagline: "A tagline",
      title: "My Docs",
      url: "https://docs.example.com",
    },
  };

  it("returns a plugin with correct name", () => {
    const plugin = llmfoodPlugin(context, {});
    expect(plugin.name).toBe("llmfood");
  });

  it("maps Docusaurus context to LlmfoodConfig", async () => {
    const plugin = llmfoodPlugin(context, {});
    await plugin.postBuild({ outDir: "/site/build" });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://docs.example.com",
        buildDir: "/site/build",
        docsDir: "/site/docs",
        siteDescription: "A tagline",
        siteTitle: "My Docs",
      })
    );
  });

  it("passes plugin options through to config", async () => {
    const options = {
      sectionLabels: { guides: "Guides" },
      sectionOrder: ["guides", "api"],
      verbose: true,
    };
    const plugin = llmfoodPlugin(context, options);
    await plugin.postBuild({ outDir: "/site/build" });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionLabels: { guides: "Guides" },
        sectionOrder: ["guides", "api"],
        verbose: true,
      })
    );
  });

  it("uses custom docsDir when provided", async () => {
    const plugin = llmfoodPlugin(context, { docsDir: "/custom/docs" });
    await plugin.postBuild({ outDir: "/site/build" });

    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ docsDir: "/custom/docs" }));
  });

  it("defaults docsDir to siteDir/docs", async () => {
    const plugin = llmfoodPlugin(context, {});
    await plugin.postBuild({ outDir: "/site/build" });

    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ docsDir: "/site/docs" }));
  });

  it("Docusaurus-derived values override plugin options", async () => {
    const plugin = llmfoodPlugin(context, {});
    await plugin.postBuild({ outDir: "/site/build" });

    const call = mockGenerate.mock.calls[0][0];
    expect(call.baseUrl).toBe("https://docs.example.com");
    expect(call.buildDir).toBe("/site/build");
    expect(call.siteTitle).toBe("My Docs");
  });

  it("handles undefined tagline", async () => {
    const noTagline = {
      ...context,
      siteConfig: { ...context.siteConfig, tagline: undefined },
    };
    const plugin = llmfoodPlugin(noTagline, {});
    await plugin.postBuild({ outDir: "/site/build" });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ siteDescription: undefined })
    );
  });
});
