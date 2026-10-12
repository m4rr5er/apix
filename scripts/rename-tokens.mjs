/**
 * One-off: rename dsh's design tokens to APIX-owned names.
 *
 * The values are being repopulated with Apple system colours, so keeping
 * `--dsw-*` (DeepSeek) names would be actively misleading. Reports anything it
 * could not map so the caller can catch misses.
 *
 *     node scripts/rename-tokens.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const FILES = [
  join(process.cwd(), "src", "styles.css"),
  join(process.cwd(), "src", "settings.css"),
];

/** Longest keys first so a prefix never clips a longer sibling. */
const MAP = {
  "--dsh-content-line-height-secondary": "--apx-leading-sm",
  "--dsh-content-font-size-secondary": "--apx-text-sm",
  "--dsh-content-line-height": "--apx-leading",
  "--dsh-content-font-size": "--apx-text",
  "--dsh-chat-content-width": "--apx-chat-width",
  "--dsh-scrollbar-thumb-hover": "--apx-scrollbar-hover",
  "--dsh-scrollbar-thumb": "--apx-scrollbar",
  "--dsh-scrollbar-width": "--apx-scrollbar-width",

  "--dsw-alias-settings-card-stroke": "--apx-card-stroke",
  "--dsw-alias-settings-card-fill": "--apx-card-bg",
  "--dsw-alias-markdown-code-block": "--apx-code-bg",
  "--dsw-alias-markdown-inline-code": "--apx-code-inline-bg",
  "--dsw-alias-interactive-bg-hover-danger": "--apx-danger-fill",
  "--dsw-alias-interactive-bg-hover-solid": "--apx-fill-solid",
  "--dsw-alias-interactive-bg-hover-accent": "--apx-fill-accent",
  "--dsw-alias-interactive-bg-hover": "--apx-fill-2",
  "--dsw-alias-interactive-bg-active": "--apx-fill-1",
  "--dsw-alias-button-primary-dimmed": "--apx-accent-dimmed",
  "--dsw-alias-button-primary-hover": "--apx-accent-hover",
  "--dsw-alias-button-primary-fill": "--apx-accent",
  "--dsw-alias-button-floating-hover": "--apx-float-bg-hover",
  "--dsw-alias-button-floating-fill": "--apx-float-bg",
  "--dsw-alias-button-ghost-active-border": "--apx-ghost-active-border",
  "--dsw-alias-button-ghost-active-fill": "--apx-ghost-active-fill",
  "--dsw-alias-label-primary-foreground": "--apx-accent-on",
  "--dsw-alias-label-primary-inverted": "--apx-label-inverted",
  "--dsw-alias-label-primary": "--apx-label-1",
  "--dsw-alias-label-secondary": "--apx-label-2",
  "--dsw-alias-label-tertiary": "--apx-label-3",
  "--dsw-alias-label-caption": "--apx-label-4",
  "--dsw-alias-label-dimmed": "--apx-label-dimmed",
  "--dsw-alias-state-business-tertiary": "--apx-accent-subtle",
  "--dsw-alias-state-business-primary": "--apx-accent-soft",
  "--dsw-alias-state-error-primary": "--apx-danger",
  "--dsw-alias-state-error-secondary": "--apx-danger-soft",
  "--dsw-alias-state-success-primary": "--apx-success",
  "--dsw-alias-state-warn-primary": "--apx-warning",
  "--dsw-alias-state-warn-label": "--apx-warning-label",
  "--dsw-alias-state-idle-primary": "--apx-idle",
  "--dsw-alias-bg-layer-1": "--apx-bg-raised",
  "--dsw-alias-bg-layer-2": "--apx-bg-raised-2",
  "--dsw-alias-bg-layer-3": "--apx-bg-raised-3",
  "--dsw-alias-bg-overlay": "--apx-bg-overlay",
  "--dsw-alias-bg-mask-1": "--apx-scrim-strong",
  "--dsw-alias-bg-mask-2": "--apx-scrim",
  "--dsw-alias-bg-base": "--apx-bg",
  "--dsw-alias-border-l1": "--apx-hairline-1",
  "--dsw-alias-border-l2": "--apx-hairline-2",
  "--dsw-alias-border-l3": "--apx-hairline-3",
  "--dsw-alias-border-l4": "--apx-hairline-4",
  "--dsw-alias-brand-primary": "--apx-invert",
  "--dsw-alias-link": "--apx-link",
  "--dsw-alias-scrollbar-hover-l1": "--apx-scrollbar-hover",
  "--dsw-alias-scrollbar-bg-l1": "--apx-scrollbar",
  "--dsw-alias-turn-trigger-bg": "--apx-row-hover",
  "--dsw-alias-toast-bg": "--apx-toast-bg",
  "--dsw-alias-toast-label": "--apx-toast-label",
  "--dsw-alias-tooltip-bg": "--apx-tooltip-bg",

  "--dsw-specific-sidebar-nav-item-active": "--apx-nav-active",
  "--dsw-specific-sidebar-nav-item-hover": "--apx-nav-hover",
  "--dsw-specific-sidebar-nav-item-active-accent": "--apx-nav-active-accent",
  "--dsw-specific-sidebar-fill": "--apx-sidebar-bg",
  "--dsw-specific-input-major": "--apx-input-bg",
  "--dsw-specific-login-input": "--apx-field-bg",
  "--dsw-specific-bubble": "--apx-bubble-bg",
  "--dsw-specific-selector": "--apx-selector-bg",
  "--dsw-specific-tip": "--apx-tip-bg",
  "--dsw-specific-menu": "--apx-menu-bg",

  "--dsw-static-deepseek-700-delete": "--apx-blue-700",
  "--dsw-static-deepseek-450": "--apx-accent-strong",
  "--dsw-static-deepseek-400": "--apx-accent-soft",
  "--dsw-static-deepseek-500": "--apx-blue-500",
  "--dsw-static-deepseek-300": "--apx-accent-weak",
  "--dsw-static-deepseek-200": "--apx-accent-weak-2",
  "--dsw-static-deepseek-900": "--apx-blue-900",
  "--dsw-static-deepseek-800": "--apx-blue-800",
  "--dsw-static-neutral-bluish-1000": "--apx-black",
  "--dsw-static-neutral-bluish-950": "--apx-ink-950",
  "--dsw-static-neutral-bluish-900": "--apx-ink-900",
  "--dsw-static-neutral-bluish-875": "--apx-ink-875",
  "--dsw-static-neutral-bluish-850": "--apx-ink-850",
  "--dsw-static-neutral-bluish-800": "--apx-ink-800",
  "--dsw-static-neutral-bluish-750": "--apx-ink-750",
  "--dsw-static-neutral-bluish-700": "--apx-ink-700",
  "--dsw-static-neutral-bluish-600": "--apx-ink-600",
  "--dsw-static-neutral-bluish-500": "--apx-ink-500",
  "--dsw-static-neutral-bluish-400": "--apx-ink-400",
  "--dsw-static-neutral-bluish-300": "--apx-ink-300",
  "--dsw-static-neutral-bluish-200": "--apx-ink-200",
  "--dsw-static-neutral-bluish-150": "--apx-ink-150",
  "--dsw-static-neutral-bluish-100": "--apx-ink-100",
  "--dsw-static-neutral-bluish-75": "--apx-ink-75",
  "--dsw-static-neutral-bluish-60": "--apx-ink-60",
  "--dsw-static-neutral-bluish-50": "--apx-ink-50",
  "--dsw-static-neutral-bluish-00": "--apx-white",
  "--dsw-static-neutral-1000": "--apx-black",
  "--dsw-static-neutral-900": "--apx-gray-900",
  "--dsw-static-neutral-850": "--apx-gray-850",
  "--dsw-static-neutral-800": "--apx-gray-800",
  "--dsw-static-neutral-700": "--apx-gray-700",
  "--dsw-static-neutral-600": "--apx-gray-600",
  "--dsw-static-neutral-550": "--apx-gray-550",
  "--dsw-static-neutral-500": "--apx-gray-500",
  "--dsw-static-neutral-400": "--apx-gray-400",
  "--dsw-static-neutral-300": "--apx-gray-300",
  "--dsw-static-neutral-200": "--apx-gray-200",
  "--dsw-static-neutral-100": "--apx-gray-100",
  "--dsw-static-neutral-00": "--apx-white",
  "--dsw-static-green-500-a12": "--apx-green-a12",
  "--dsw-static-green-500": "--apx-green",
  "--dsw-static-green-400": "--apx-green-soft",
  "--dsw-static-green-100": "--apx-green-weak",
  "--dsw-static-green-900": "--apx-green-900",
  "--dsw-static-red-600-a08": "--apx-red-a08",
  "--dsw-static-red-500": "--apx-red",
  "--dsw-static-red-400-a12": "--apx-red-a12",
  "--dsw-static-red-400": "--apx-red-soft",
  "--dsw-static-red-100": "--apx-red-weak",
  "--dsw-static-red-50": "--apx-red-50",
  "--dsw-static-red-900": "--apx-red-900",
  "--dsw-static-amber-500": "--apx-amber",
  "--dsw-static-amber-400": "--apx-amber-soft",
  "--dsw-static-amber-600": "--apx-amber-label",
  "--dsw-static-amber-100": "--apx-amber-weak",
  "--dsw-static-amber-900": "--apx-amber-900",
  "--dsw-static-blue-500": "--apx-blue-500",
  "--dsw-static-blue-400": "--apx-blue-400",
  "--dsw-static-blue-300": "--apx-blue-300",
  "--dsw-static-blue-100": "--apx-blue-100",
  "--dsw-static-blue-950": "--apx-blue-950",
  "--dsw-static-blue-900": "--apx-blue-900",

  "--dsw-font-family": "--apx-font",
  "--dsw-font-family-brand": "--apx-font-brand",
  "--ds-font-family-code": "--apx-font-mono",
  "--ds-ease-in-out": "--apx-ease",
  "--ds-transition-duration-fast": "--apx-duration-fast",
  "--ds-transition-duration-slow": "--apx-duration-slow",
  "--ds-transition-duration": "--apx-duration",

  "--dsw-radius-panel": "--apx-radius-panel",
  "--dsw-radius-xs": "--apx-radius-xs",
  "--dsw-radius-sm": "--apx-radius-sm",
  "--dsw-radius-md": "--apx-radius-md",
  "--dsw-radius-lg": "--apx-radius-lg",
  "--dsw-radius-xl": "--apx-radius-xl",

  "--dsw-corner-shape": "--apx-corner-shape",
};

/** Apply before the map: otherwise `--dsw-alias-bg-base` would match inside
 *  `--dsw-alias-bg-base-something`. Split on token boundaries instead. */
const keys = Object.keys(MAP).sort((a, b) => b.length - a.length);
const pattern = new RegExp(`(${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");

let totalHits = 0;
const leftovers = new Map();

for (const file of FILES) {
  if (!existsSync(file)) {
    console.warn(`skip (missing): ${file}`);
    continue;
  }
  const before = readFileSync(file, "utf8");
  let hits = 0;
  const after = before.replace(pattern, (match) => {
    hits += 1;
    return MAP[match];
  });
  writeFileSync(file, after);
  totalHits += hits;
  console.log(`${hits.toString().padStart(4)} replacements  ${file}`);

  for (const line of after.split("\n")) {
    const found = line.match(/--(?:dsw|dsh)-[a-z0-9-]+/g);
    if (found) {
      for (const token of found) leftovers.set(token, (leftovers.get(token) ?? 0) + 1);
    }
  }
}

console.log(`\ntotal ${totalHits} replacements`);

if (leftovers.size > 0) {
  console.log("\nUNMAPPED tokens still present:");
  for (const [token, count] of [...leftovers].sort()) {
    console.log(`  ${token}  x${count}`);
  }
  process.exitCode = 1;
} else {
  console.log("no --dsw-* / --dsh-* tokens remain.");
}
