// 临时探针：chats 绑定 + 各工作区会话目录里最新文件的时间。
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const state = JSON.parse(readFileSync(path.join(process.env.APPDATA, "APIX", "state.json"), "utf8"));
const root = path.join(homedir(), ".pi", "agent", "sessions");

for (const w of state.workspaces || []) {
  console.log(`\n[ws] ${w.path} activeChat=${w.activeChat}`);
  for (const c of w.chats || []) {
    console.log(
      `  chat ${JSON.stringify(c.name)} file=${c.sessionFile ?? "NULL"}`,
      `exists=${c.sessionFile ? existsSync(c.sessionFile) : "-"}`,
      `created=${new Date(c.createdAt).toISOString()}`,
    );
  }
  const encoded = `--${w.path.trim().replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const dir = path.join(root, encoded);
  if (existsSync(dir)) {
    const files = readdirSync(dir)
      .filter((n) => n.endsWith(".jsonl"))
      .map((n) => ({ n, m: statSync(path.join(dir, n)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .slice(0, 3);
    for (const f of files) console.log(`   file ${f.n}  mtime=${new Date(f.m).toISOString()}`);
  } else {
    console.log(`   (no session dir ${encoded})`);
  }
}
