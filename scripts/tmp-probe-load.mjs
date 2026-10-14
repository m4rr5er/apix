// 临时探针：按 APIX 冷启动时序起 pi --session <ios 会话>，发 get_messages 看返回形状。
import { spawn } from "node:child_process";

const SESSION =
  "C:\\Users\\NPC-341\\.pi\\agent\\sessions\\--C--projects-dsh_projects-rednote-9480_ios--\\2026-10-13T09-39-52-979Z_01a134a1-fa13-7010-972c-d409cff25b0a.jsonl";
const CWD = "C:\\projects\\dsh_projects\\rednote\\9480_ios";
const NODE = "C:\\nvm4w\\nodejs\\node.exe";
const PI = "C:\\nvm4w\\nodejs\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js";

const child = spawn(NODE, [PI, "--mode", "rpc", "--no-skills", "--session", SESSION], {
  cwd: CWD,
  stdio: ["pipe", "pipe", "pipe"],
});

let id = 0;
const waiters = new Map();
let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id && waiters.has(msg.id)) {
      waiters.get(msg.id)(msg);
      waiters.delete(msg.id);
    }
  }
});
child.stderr.on("data", (d) => console.log("[stderr]", d.toString().trim().slice(0, 200)));

const send = (cmd) => {
  const rid = `p${++id}`;
  return new Promise((resolve) => {
    waiters.set(rid, resolve);
    child.stdin.write(JSON.stringify({ ...cmd, id: rid }) + "\n");
  });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const killer = setTimeout(() => {
  console.log("TIMEOUT");
  child.kill();
  process.exit(1);
}, 40000);

await sleep(1200);
const st = await send({ type: "get_state" });
console.log("[get_state] success=", st.success, "sessionFile=", String(st?.data?.sessionFile ?? st?.sessionFile ?? "?").slice(-24), "messageCount=", st?.data?.messageCount);
const gm = await send({ type: "get_messages" });
const msgs = gm?.data?.messages ?? gm?.messages;
console.log("[get_messages] success=", gm.success, "topKeys=", Object.keys(gm).join(","), "dataKeys=", gm.data && typeof gm.data === "object" ? Object.keys(gm.data).join(",") : typeof gm.data, "messages=", Array.isArray(msgs) ? msgs.length : "NOT ARRAY");
if (Array.isArray(msgs) && msgs.length) {
  console.log("first role=", msgs[0].role, "last role=", msgs[msgs.length - 1].role);
}

clearTimeout(killer);
child.kill();
console.log("done");
