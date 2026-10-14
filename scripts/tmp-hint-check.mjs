// 临时探针：用真实 state.json + 真实目录清单回放 resolveChatSession 的判定，
// 并打印每个会话的 hint 会是什么（null = 引擎不带 --session 启动）。
import { build } from "esbuild";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "apix-hint-"));
const out = join(dir, "bundle.mjs");
const entry = join(dir, "entry.ts");
writeFileSync(
  entry,
  `export { resolveChatSession } from ${JSON.stringify(resolve("src/lib/sessionRecovery.ts").replace(/\\/g, "/"))};`,
  "utf8",
);
await build({
  entryPoints: [entry], outfile: out, bundle: true, format: "esm", platform: "node",
  absWorkingDir: process.cwd(), nodePaths: [resolve("node_modules")], logLevel: "silent",
});
const { resolveChatSession } = await import(pathToFileURL(out).href);

const state = JSON.parse(readFileSync(join(process.env.APPDATA, "APIX", "state.json"), "utf8"));
const root = join(homedir(), ".pi", "agent", "sessions");

for (const w of state.workspaces ?? []) {
  const encoded = `--${w.path.trim().replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const sdir = join(root, encoded);
  const files = existsSync(sdir)
    ? readdirSync(sdir).filter((n) => n.endsWith(".jsonl")).map((n) => {
      const full = join(sdir, n);
      const st = statSync(full);
      return { path: full, fileName: n, modifiedMs: st.mtimeMs, size: st.size };
    })
    : [];
  console.log(`\n[ws] ${w.path}`);
  console.log(`  session dir: ${sdir}  exists=${existsSync(sdir)}  files=${files.length}`);
  for (const c of w.chats ?? []) {
    const listing = {
      dir: sdir,
      files,
      recordedExists: Boolean(c.sessionFile && existsSync(c.sessionFile)),
    };
    const r = resolveChatSession({
      chat: c,
      siblings: (w.chats ?? []).filter((s) => s.id !== c.id),
      listing,
    });
    const hint = r.kind === "resume" || r.kind === "adopt" ? r.path : null;
    console.log(
      `  chat ${JSON.stringify(c.name)} sessionFile=${c.sessionFile ? "set" : "NULL"} recordedExists=${listing.recordedExists} => ${r.kind}${r.reason ? "(" + r.reason + ")" : ""} hint=${hint ? "OK" : "NULL <<< 引擎不会带 --session"}`,
    );
  }
}
console.log("\nlastWorkdir:", state.lastWorkdir ?? "(none)");
rmSync(dir, { recursive: true, force: true });
