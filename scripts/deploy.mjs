/**
 * Deploy the release build so it can be launched from an icon.
 *
 *   - %LOCALAPPDATA%\APIX\APIX.exe  — canonical location, survives repo cleanup
 *   - %LOCALAPPDATA%\APIX\APIX-<hash>.ico
 *                                   — the icon the shortcut points at, named
 *                                     after its content hash (see below)
 *   - <Desktop>\APIX.lnk            — a shortcut, so the desktop label reads
 *                                     "APIX" with no file extension
 *
 * Note: the shortcut's icon is set explicitly, so swapping the icon does not
 * rely on the shell noticing the exe changed. The titlebar/taskbar icon still
 * comes from the exe's embedded resource — `src-tauri/build.rs` tracks
 * `icons/icon.ico` so that resource is rebuilt when the icon changes.
 *
 * The shortcut needs COM (WScript.Shell). Sandboxed runs block it, in which
 * case deploy falls back to copying the exe onto the desktop — the icon is the
 * same, the label just reads "APIX.exe".
 *
 *     npm run app:deploy   # build, then deploy
 *     npm run app:copy     # deploy only (after closing a running APIX)
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const source = join(root, "src-tauri", "target", "release", "apix.exe");

if (!existsSync(source)) {
  console.error(`release build not found: ${source}`);
  console.error("run `npm run app:build` first.");
  process.exit(1);
}

const size = (statSync(source).size / 1024 / 1024).toFixed(2);

function findDesktop() {
  const candidates = [
    process.env.OneDrive ? join(process.env.OneDrive, "Desktop") : null,
    process.env.OneDriveConsumer ? join(process.env.OneDriveConsumer, "Desktop") : null,
    join(homedir(), "Desktop"),
  ].filter(Boolean);
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

/**
 * Create a `.lnk` on the desktop.
 *
 * Why a shortcut instead of a bare copy: the copy is named `APIX.exe`, and
 * Windows always shows an executable's extension, so the desktop label reads
 * "APIX.exe" no matter what. A shortcut named `APIX` displays with *no*
 * extension at all — Windows never reveals the `.lnk` suffix, even with
 * "show file extensions" turned on.
 *
 * The icon is pinned with an explicit `IconLocation` rather than left to be
 * inherited from the target exe. The shell caches an icon against the path it
 * came from, so an exe that replaces itself in place (same path, new resource)
 * can keep serving the stale entry until explorer restarts. Pointing at a
 * content-hashed `.ico` sidesteps that: a changed icon means a path the cache
 * has never seen. Note this only covers the shortcut — the titlebar and
 * taskbar icon come from the exe's own resource, embedded at build time.
 *
 * Needs COM (WScript.Shell), so it has to run outside a restricted sandbox.
 */
function createShortcut(target, linkPath, workDir, iconPath) {
  const esc = (value) => value.replace(/'/g, "''");
  const script = [
    "$ws = New-Object -ComObject WScript.Shell",
    `$sc = $ws.CreateShortcut('${esc(linkPath)}')`,
    `$sc.TargetPath = '${esc(target)}'`,
    `$sc.WorkingDirectory = '${esc(workDir)}'`,
    // The `,0` is the icon index inside the file — index 0 is the only entry.
    `$sc.IconLocation = '${esc(iconPath)},0'`,
    "$sc.Description = 'APIX'",
    "$sc.WindowStyle = 1",
    // Explicitly empty, so a leftover value can never be inherited.
    "$sc.Arguments = ''",
    "$sc.Hotkey = ''",
    "$sc.Save()",
  ].join("; ");
  // -EncodedCommand sidesteps every quoting pitfall between here and PowerShell.
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { stdio: "ignore", timeout: 30_000 },
  );
}

/** [target, required] — the install copy is the one that must succeed. */
const targets = [];

const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
const installDir = join(localAppData, "APIX");
mkdirSync(installDir, { recursive: true });
targets.push([join(installDir, "APIX.exe"), true]);

// A standalone copy of the icon for the shortcut to point at, named after the
// icon's own content hash. Re-deploying an unchanged icon reuses the same path
// (no churn); changing the icon yields a fresh path, so Windows never serves a
// cached entry for it. Kept next to the exe so the desktop shortcut keeps
// working even if the repo is cleaned up.
const iconSource = join(root, "src-tauri", "icons", "icon.ico");
const iconHash = createHash("sha256").update(readFileSync(iconSource)).digest("hex").slice(0, 8);
const iconTarget = join(installDir, `APIX-${iconHash}.ico`);
copyFileSync(iconSource, iconTarget);
console.log(`copied  ${iconTarget}`);
for (const entry of readdirSync(installDir)) {
  if (!/^APIX-[0-9a-f]{8}\.ico$/.test(entry)) continue;
  const stale = join(installDir, entry);
  if (stale === iconTarget) continue;
  try {
    rmSync(stale);
  } catch {
    // Still referenced by an old shortcut somewhere; harmless to leave behind.
  }
}

const desktop = findDesktop();
if (desktop) {
  const linkPath = join(desktop, "APIX.lnk");
  const target = join(installDir, "APIX.exe");
  try {
    // CreateShortcut loads an existing .lnk and keeps whatever it finds, so
    // every field we care about is assigned — including the ones we want empty
    // (Arguments, Hotkey) — or a previous run's values would survive.
    createShortcut(target, linkPath, installDir, iconTarget);
    console.log(`shortcut ${linkPath}  →  ${target}`);
    console.log(`         icon    ${iconTarget}`);
  } catch (error) {
    // Sandboxed environments block COM; a plain copy still leaves an icon, it
    // just reads "APIX.exe" on the label.
    console.warn(
      `shortcut failed — ${error && error.message}. Falling back to a plain exe copy.`,
    );
    targets.push([join(desktop, "APIX.exe"), false]);
  }
} else {
  console.warn("could not locate the Desktop folder; skipping the desktop copy.");
}

let locked = 0;
let requiredFailed = false;

for (const [target, required] of targets) {
  try {
    copyFileSync(source, target);
    console.log(`copied  ${target}`);
  } catch (error) {
    const busy = error && error.code === "EBUSY";
    if (busy) locked += 1;
    if (required) requiredFailed = true;
    console.warn(
      busy
        ? `locked  ${target}  — APIX 正在运行，Windows 不允许覆盖已启动的 exe`
        : `failed  ${target}  — ${error && error.message}`,
    );
  }
}

console.log(`\nsource  ${source}  (${size} MB)`);

if (locked > 0) {
  console.log("\n退出 APIX（托盘图标右键 → 退出 APIX），然后重跑：");
  console.log("    npm run app:copy");
  process.exitCode = 1;
} else {
  console.log("double-click APIX on the desktop to launch.");
}

if (requiredFailed && locked === 0) process.exitCode = 1;
