import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "buy-scout",
  tagline: "A reusable buy-side search engine, starting with a family car",
  favicon: "img/logo.svg",
  url: "https://buy-scout.local",
  baseUrl: "/",
  organizationName: "syedmaaz",
  projectName: "buy-scout",
  onBrokenLinks: "warn",
  markdown: {
    mermaid: true,
  },
  themes: [
    [
      "@easyops-cn/docusaurus-search-local",
      {
        hashed: true,
        language: ["en"],
        indexBlog: false,
        docsRouteBasePath: "/docs",
      },
    ],
    "@docusaurus/theme-mermaid",
  ],
  presets: [
    [
      "classic",
      {
        docs: {
          path: "docs",
          routeBasePath: "docs",
          sidebarPath: "./sidebars.ts",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    image: "img/logo.svg",
    navbar: {
      title: "buy-scout",
      logo: { alt: "buy-scout", src: "img/logo.svg" },
      items: [
        { type: "docSidebar", sidebarId: "docs", position: "left", label: "Documentation" },
        { to: "/docs/ui", label: "Run the UI", position: "right" },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Introduction", to: "/docs/intro" },
            { label: "Architecture", to: "/docs/architecture" },
            { label: "Smart Fetch", to: "/docs/smart-fetch" },
          ],
        },
        {
          title: "Operations",
          items: [
            { label: "Runbook", to: "/docs/operations" },
            { label: "Sources", to: "/docs/sources-operations" },
            { label: "Verdicts", to: "/docs/verdicts" },
          ],
        },
      ],
      copyright: `buy-scout POC · ${new Date().getFullYear()}`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
    mermaid: {
      theme: { light: "neutral", dark: "dark" },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
