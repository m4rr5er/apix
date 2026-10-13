/**
 * 多引擎（每会话一个 pi 进程）的接线回归。
 *
 * 这套架构要钉住的行为就三条，全部源自一次实测事故：
 *   1. 切走一个正在跑的会话，它的引擎必须活着（不发 abort、不停进程）；
 *   2. 后台回合结束（agent_settled）后进程自动回收，不留着吃内存；
 *   3. 每个进程的事件带 slot，路由错了就是串台——A 的流式字出现在 B 脸上。
 *
 * Rust 侧的注册表与事件打标、前端侧的过滤与 detach/attach 分工，都用源码接线
 * 断言钉住；真实的「后台跑完再切回来」需要活体应用，由用户实测兜底。
 *
 * 跑法：node scripts/check-slots.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const rust = readFileSync(join("src-tauri", "src", "pi.rs"), "utf8");
const commands = readFileSync(join("src-tauri", "src", "commands.rs"), "utf8");
const lib = readFileSync(join("src-tauri", "src", "lib.rs"), "utf8");
const bridge = readFileSync(join("src", "lib", "bridge.ts"), "utf8");
const usePi = readFileSync(join("src", "hooks", "usePi.ts"), "utf8");
const app = readFileSync(join("src", "App.tsx"), "utf8");

function main() {
  // ------------------------------------------------------------------ Rust
  check("Rust 用槽位注册表管理多个引擎（不再是单例 State<PiHandle>）",
    /struct PiRegistry/.test(rust) && /HashMap<String, Arc<PiHandle>>/.test(rust));
  check("每个命令都按 slot 寻址（send/prompt/abort/stop 全带 slot 参数）",
    /pub async fn pi_send\([\s\S]*?slot: String/.test(commands) &&
      /pub async fn pi_abort\([\s\S]*?slot: String/.test(commands) &&
      /pub async fn pi_stop\([\s\S]*?slot: String/.test(commands));
  check("record 事件带 slot（前端路由的依据）",
    /emit\(\s*EVT_RECORD\s*,\s*json!\(\{[^}]*"slot"/.test(rust));
  check("status 事件带 slot（running/exited/stopped 都要知道是谁的）",
    /"state": "running",\s*"slot"/.test(rust) && /"state": "exited"[\s\S]{0,60}"slot"/.test(rust));
  check("应用退出时停掉所有槽位（漏一个就是孤儿 node 进程）",
    /for handle in registry\.all\(\)/.test(lib));

  // ---------------------------------------------------------------- bridge
  check("bridge 的每个引擎调用都以 slot 为首参",
    /start: \(slot: string/.test(bridge) &&
      /send: \(slot: string/.test(bridge) &&
      /abort: \(slot: string/.test(bridge) &&
      /stop: \(slot: string/.test(bridge));
  check("切走的在途请求按「转入后台」拒绝（不是错误，是不再有人等它）",
    /SLOT_DETACHED/.test(bridge) && /isRestartCancellation/.test(bridge));

  // ----------------------------------------------------------------- usePi
  check("detach：忙则留（不加 stop），闲才停进程",
    /const detach = useCallback\(\(\) => \{[\s\S]*?if \(busyRef\.current\) \{[\s\S]*?return;\n    \}[\s\S]*?pi\.stop\(slot\)/
      .test(usePi));
  check("detach 不发 abort（后台回合继续跑，这是需求本身）",
    !/const detach[\s\S]{0,800}pi\.abort/.test(usePi));
  check("后台事件只认回合边界，settle 即回收进程",
    /markBackgroundBusy/.test(usePi) &&
      /record\.type === "agent_settled"[\s\S]{0,80}markBackgroundBusy\(slot, false\)/.test(usePi));
  check("非活跃槽位的事件绝不进 reducer（串台防线）",
    /if \(slot !== slotRef\.current\) \{[\s\S]{0,500}return;\n      \}/.test(usePi));
  check("pending 按槽位分桶（切走不误伤别的会话的在途请求）",
    /Map<string, Map<string, \{ resolve/.test(usePi));

  // ------------------------------------------------------------------- App
  check("切工作区不再重启引擎（合并循环与 pi.start 直调都已从 App 消失）",
    !/const applyWorkspace/.test(app) &&
      !/wantedWorkspace/.test(app) &&
      !/pi\.start\(/.test(app));
  check("会话开关全部走 focus（唯一的入口）",
    /const focus = useCallback/.test(app) &&
      /handleSelectChat[\s\S]{0,700}focus\(workspacePath, chat\)/.test(app));
  check("skill 开关不再触发全局重启（syncSkills 已删；空闲时只重生自己的引擎）",
    !/syncSkills/.test(app) && /respawnIfIdle/.test(app));
  check("respawnIfIdle 有回合保护：忙时绝不动引擎",
    /const respawnIfIdle[\s\S]{0,200}pi\.state\.busy\) return/.test(app));
  check("删除会话时回收它的引擎（包括后台在跑的）",
    /pi\.stopSlot\(removedId\)/.test(app));

  let failed = 0;
  for (const { name, ok, detail } of results) {
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
