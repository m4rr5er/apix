/**
 * Verify the desktop shortcut + icon chain, with zero dependencies and no COM
 * (the earlier COM-based version couldn't spawn powershell.exe from a sandbox).
 *
 *   node scripts/diag-shortcut.mjs
 *
 * Checks, in order:
 *   1. APIX.lnk exists and parses; reports flags, target (via LinkInfo local
 *      base path), working dir, and whether an explicit IconLocation is baked
 *      in (we expect none — the icon is meant to come from the target exe).
 *   2. The target exe's embedded PNG icon frames vs. src-tauri/icons/icon.ico:
 *      a byte-exact match means the build actually picked up the current icon.
 *
 * Exit code 0 = everything consistent, 1 = mismatch found.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const lnk = join(homedir(), "Desktop", "APIX.lnk");
const installExe = join(process.env.LOCALAPPDATA ?? "", "APIX", "APIX.exe");
const ico = join(root, "src-tauri", "icons", "icon.ico");
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const iso = (p) => (existsSync(p) ? statSync(p).mtime.toISOString() : "—");
const hex = (n) => "0x" + n.toString(16);

// ------------------------------------------------------------------ .lnk ----
function parseLnk(path) {
  const b = readFileSync(path);
  const flags = b.readUInt32LE(20);
  let o = 76;
  if (flags & 0x01) o += 2 + b.readUInt16LE(o); // LinkTargetIDList
  let localBasePath = null;
  if (flags & 0x02) {
    // LinkInfo: size, header(~28), then LocalBasePath at LinkInfoHeaderSize+off
    const size = b.readUInt32LE(o);
    const infoFlags = b.readUInt32LE(o + 8);
    const volumeOff = b.readUInt32LE(o + 12);
    const localOff = b.readUInt32LE(o + 16);
    if (infoFlags & 0x01 && localOff) {
      const end = b.indexOf(0, o + localOff);
      localBasePath = b.toString("latin1", o + localOff, end);
    }
    o += size;
  }
  const uni = !!(flags & 0x80);
  const strings = { NAME: 0x04, RELATIVE_PATH: 0x08, WORKING_DIR: 0x10, ARGUMENTS: 0x20, ICON_LOCATION: 0x40 };
  const out = {};
  for (const [name, mask] of Object.entries(strings)) {
    if (!(flags & mask)) { out[name] = null; continue; }
    const n = b.readUInt16LE(o); o += 2;
    out[name] = uni ? b.toString("utf16le", o, o + n * 2) : b.toString("latin1", o, o + n);
    o += uni ? n * 2 : n;
  }
  return { size: b.length, flags, localBasePath, ...out };
}

// ------------------------------------------------------------------ icons ----
/** PNG frames inside an ICO container. */
function icoFrames(path) {
  const b = readFileSync(path);
  const n = b.readUInt16LE(4);
  const frames = [];
  for (let i = 0; i < n; i++) {
    const e = 6 + i * 16;
    const w = b[e] || 256, h = b[e + 1] || 256;
    const size = b.readUInt32LE(e + 8), off = b.readUInt32LE(e + 12);
    const data = b.subarray(off, off + size);
    frames.push({ w, h, size, isPng: data.subarray(0, 8).equals(PNG_SIG), data });
  }
  return frames;
}

/** PNG blobs embedded anywhere in a file (RT_ICON resources keep PNG data verbatim). */
function exePngFrames(path) {
  const b = readFileSync(path);
  const frames = [];
  let i = 0;
  while ((i = b.indexOf(PNG_SIG, i)) >= 0) {
    let p = i + 8, end = -1;
    while (p < b.length - 8) {
      const len = b.readUInt32BE(p);
      if (b.toString("latin1", p + 4, p + 8) === "IEND") { end = p + 12; break; }
      p += 12 + len;
    }
    if (end > 0) {
      const d = b.subarray(i, end);
      frames.push({ w: b.readUInt32BE(i + 16), h: b.readUInt32BE(i + 20), data: d });
    }
    i += 8;
  }
  return frames;
}

// ------------------------------------------------------------------- main ----
console.log(`lnk        ${lnk}   mtime ${iso(lnk)}`);
console.log(`target exe ${installExe}   mtime ${iso(installExe)}`);
console.log(`icon.ico   ${ico}   mtime ${iso(ico)}`);

if (!existsSync(lnk)) { console.log("\nFAIL: APIX.lnk not found"); process.exit(1); }
if (!existsSync(installExe)) { console.log("\nFAIL: installed exe not found"); process.exit(1); }

const link = parseLnk(lnk);
console.log("\n--- APIX.lnk ---");
console.log(`  size=${link.size} flags=${hex(link.flags)}`);
console.log(`  target (LinkInfo) : ${link.localBasePath ?? "(none stored)"}`);
console.log(`  relative path     : ${link.RELATIVE_PATH}`);
console.log(`  working dir       : ${link.WORKING_DIR}`);
console.log(`  explicit icon     : ${link.ICON_LOCATION ?? "(none — icon comes from the target exe)"}`);

// When the shortcut pins its own icon file, that file is what the desktop
// renders — so it has to be byte-identical to the icon we ship.
let iconFileMismatch = false;
if (link.ICON_LOCATION) {
  const iconFile = link.ICON_LOCATION.replace(/,\s*-?\d+$/, "");
  console.log(`\n--- pinned shortcut icon ---`);
  console.log(`  path   ${iconFile}`);
  if (!existsSync(iconFile)) {
    console.log("  MISSING — the shortcut points at a file that does not exist");
    iconFileMismatch = true;
  } else {
    const same = readFileSync(iconFile).equals(readFileSync(ico));
    console.log(`  mtime  ${iso(iconFile)}`);
    console.log(`  bytes  ${statSync(iconFile).size}  ${same ? "identical to icon.ico" : "DIFFERS from icon.ico"}`);
    if (!same) iconFileMismatch = true;
  }
}

const frames = icoFrames(ico);
const exeFrames = exePngFrames(installExe);
console.log(`\n--- icon.ico (${frames.length} frames) vs exe embedded PNGs (${exeFrames.length}) ---`);
let mismatches = 0;
for (const f of frames) {
  if (!f.isPng) { console.log(`  ${String(f.w).padStart(3)}x${f.h}  non-PNG frame — skipped (compare N/A)`); continue; }
  const hit = exeFrames.some((e) => e.data.equals(f.data));
  console.log(`  ${String(f.w).padStart(3)}x${f.h}  ${String(f.size).padStart(6)} B  ${hit ? "IN EXE" : "NOT in exe"}`);
  if (!hit) mismatches += 1;
}

if (mismatches > 0) {
  console.log(`\nVERDICT: FAIL — ${mismatches}/${frames.length} frames missing. The exe still embeds an older icon;`);
  console.log("  rebuild so tauri-build recompiles resource.lib (build.rs now tracks icons/icon.ico).");
  process.exitCode = 1;
} else if (iconFileMismatch) {
  console.log("\nVERDICT: FAIL — the shortcut's pinned icon file is missing or stale.");
  console.log("  Re-run `node scripts/deploy.mjs` to re-point it at the current icon.");
  process.exitCode = 1;
} else {
  console.log("\nVERDICT: PASS — the exe embeds the current icon.ico, and any pinned icon file matches.");
  console.log("  If the desktop still looks stale, Explorer's cache is holding it: restart explorer.exe.");
}
