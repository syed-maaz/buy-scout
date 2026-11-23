import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    "intro",
    {
      type: "category",
      label: "Start here",
      collapsed: false,
      items: ["architecture", "data-model"],
    },
    {
      type: "category",
      label: "Decide",
      collapsed: false,
      items: ["criteria", "verdicts", "analysis"],
    },
    {
      type: "category",
      label: "Run it",
      collapsed: false,
      items: ["ui", "operations", "sources-operations", "mobile-de-latency"],
    },
    {
      type: "category",
      label: "Quality",
      collapsed: false,
      items: ["evaluation", "roadmap"],
    },
    {
      type: "category",
      label: "Reference",
      collapsed: false,
      items: [
        "glossary",
        "journal",
        {
          type: "category",
          label: "Architecture decisions",
          items: ["adr/adr-0001", "adr/adr-0002"],
        },
        {
          type: "category",
          label: "Legacy & deep dives",
          collapsed: true,
          items: [
            "status",
            "smart-fetch",
            "sources",
            "workarounds",
            "access-playbook",
            "criteria-flow",
            "runbook",
            "plan",
            "acceptance",
            "backlog",
          ],
        },
      ],
    },
  ],
};

export default sidebars;
