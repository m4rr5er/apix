/**
 * One-off: route every font-size and line-height through --apx-font-scale.
 *
 * The appearance settings offer a text-size control, and "affects every font on
 * every page" means no hardcoded px may survive. Each literal becomes
 * `calc(<n>px * var(--apx-font-scale))`, so one variable scales the whole UI
 * while spacing, borders and radii keep their proportions.
 *
 * Line-heights are included on purpose: scaling text without its leading clips
 * descenders once the scale goes up.
 *
 *     node scripts/scale-typography.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const FILES = [
  join(process.cwd(), "src", "styles.css"),
  join(process.cwd(), "src", "settings.css"),
];

const SCALE = "var(--apx-font-scale)";
const DECLARATION = /^(\s*)(font-size|line-height):\s*(-?[\d.]+)px;/gm;

let total = 0;
let failed = false;

for (const file of FILES) {
  if (!existsSync(file)) {
    console.warn(`skip (missing): ${file}`);
    continue;
  }

  const before = readFileSync(file, "utf8");
  let hits = 0;
  const after = before.replace(DECLARATION, (_match, indent, property, value) => {
    hits += 1;
    return `${indent}${property}: calc(${value}px * ${SCALE});`;
  });

  writeFileSync(file, after);
  total += hits;
  console.log(`${hits.toString().padStart(4)} declarations  ${file}`);

  // Anything left in px would simply not scale — surface it instead of hiding it.
  const leftovers = new Map();
  for (const line of after.split("\n")) {
    const match = line.match(/^\s*(?:font-size|line-height):\s*(-?[\d.]+)px;/);
    if (match) leftovers.set(line.trim(), (leftovers.get(line.trim()) ?? 0) + 1);
  }
  if (leftovers.size > 0) {
    failed = true;
    console.log("  UNSCALED declarations still present:");
    for (const [line, count] of leftovers) console.log(`    ${line}  x${count}`);
  }
}

console.log(`\ntotal ${total} declarations now scale with --apx-font-scale.`);
if (failed) process.exitCode = 1;
