/**
 * 「改配置不重启引擎」这条链路的接线检查。
 *
 * 背景：pi 把「原地重读」`ctx.reload()` **只暴露给扩展**，RPC 没有对应命令。
 * 所以 APIX 的做法是：自己写一个扩展（`config::APIX_RELOAD_EXTENSION`）随进程
 * 用 `--extension` 带上，配置写完后发一条 `/apix-reload` 命令触发它。
 *
 * 实测收益：重启要 5.6s（还伴随会话短暂消失），原地重读预热后约 1.1s，会话与
 * 对话记录完全不动。
 *
 * 这里钉住四件事：
 *   1. 扩展源码本身可用——真的注册了命令、真的调了 `ctx.reload()`，
 *      并且**没有在 reload 之后碰 ctx**（reload 会让 ctx 失效，之后任何
 *      访问都会抛 "This extension ctx is stale"，实测会变成一条
 *      extension_error 事件）；
 *   2. 扩展落在 APIX 自己的目录里，不是 `<agent>/extensions`——否则 pi 的其它
 *      前端（自带 TUI、dsh）也会多出一个只属于 APIX 的命令；
 *   3. `pi.rs` 确实把它作为 `--extension` 传下去；
 *   4. 设置页不再让用户手动重启。
 *
 * 跑法：node scripts/check-reload.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const read = (...parts) => readFileSync(join(...parts), "utf8");

const config = read("src-tauri", "src", "config.rs");
const piRs = read("src-tauri", "src", "pi.rs");
const usePi = read("src", "hooks", "usePi.ts");

/**
 * 去掉注释。这些断言问的是「代码里还有没有旧做法」，而注释里写着
 * 「原来这里是这么做的」是正常的——不剥离注释的话，越认真注释越容易误判。
 * `[^:]` 是为了不把 `https://` 当成行注释。
 */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const settings = stripComments(read("src", "components", "settings", "Settings.tsx"));
const appRaw = read("src", "App.tsx");
const app = stripComments(appRaw);

const COMMAND = "apix-reload";

// ------------------------------------------------------ 扩展源码本身（真跑一遍）

const extracted = /const APIX_RELOAD_EXTENSION: &str = r#"([\s\S]*?)"#;/.exec(config);
check("config.rs 里能找到内嵌的扩展源码", Boolean(extracted), extracted ? `${extracted[1].length} 字节` : "未找到");

if (extracted) {
  const source = extracted[1];
  const url = `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`;

  let mod = null;
  try {
    mod = await import(url);
  } catch (error) {
    check("扩展源码是合法的 ES 模块", false, String(error));
  }

  if (mod) {
    check("扩展有默认导出的工厂函数", typeof mod.default === "function");

    let registered = null;
    const fakePi = {
      registerCommand: (name, spec) => {
        registered = { name, spec };
      },
    };

    let bootError = null;
    try {
      await mod.default(fakePi);
    } catch (error) {
      bootError = error;
    }

    check("工厂函数能注册命令而不抛错", !bootError, bootError ? String(bootError) : "");
    check(`注册的命令名是 ${COMMAND}`, registered?.name === COMMAND, String(registered?.name));
    check("命令带 description 与 handler", Boolean(registered?.spec?.description) && typeof registered?.spec?.handler === "function");

    if (typeof registered?.spec?.handler === "function") {
      let reloads = 0;
      let afterReload = false;
      // reload 之后 ctx 就失效了：任何属性访问都必须失败。这正是第一次实现时踩到的坑——
      // 在 reload 之后调 `ctx.ui.notify()`，pi 会回一条 extension_error。
      const ctx = new Proxy(
        {
          reload: async () => {
            reloads += 1;
            afterReload = true;
          },
        },
        {
          get(target, prop) {
            if (afterReload && prop !== "reload") {
              throw new Error(`reload 之后又碰了 ctx.${String(prop)}`);
            }
            return target[prop];
          },
        },
      );

      let handlerError = null;
      try {
        await registered.spec.handler([], ctx);
      } catch (error) {
        handlerError = error;
      }

      check("handler 调且只调了一次 ctx.reload()", reloads === 1, `调用了 ${reloads} 次`);
      check("handler 在 reload 之后没有再用 ctx", !handlerError, handlerError ? String(handlerError) : "");
    }
  }
}

// --------------------------------------------- 扩展必须落在 APIX 自己的目录里

const fn = /pub fn apix_reload_extension\(\)[\s\S]*?\n}/.exec(config);
check("能读到 apix_reload_extension() 的实现", Boolean(fn));
if (fn) {
  check("扩展写在 APIX 自己的目录（apix_dir）", fn[0].includes("apix_dir()"));
  check(
    "扩展没有写进 pi 的文件夹（agent_dir / extensions），不污染其它前端",
    !fn[0].includes("agent_dir()") && !fn[0].includes("extensions"),
  );
  check("内容没变时不重写（沿用内置 skill 的做法）", fn[0].includes("write_atomic") && fn[0].includes("should_write"));
}

check("apix_dir() 就是 state.json 所在的那个目录", /fn state_file\(\)[\s\S]{0,120}apix_dir\(\)\?\.join\("state\.json"\)/.test(config));

// ------------------------------------------------------------- 启动时传下去

check("pi.rs 把扩展作为 --extension 传给 pi", /arg\("--extension"\)/.test(piRs));
check(
  "pi.rs 用的是 config::apix_reload_extension()，而不是自己拼路径",
  /crate::config::apix_reload_extension\(\)/.test(piRs),
);
check(
  "写扩展失败时不阻止 pi 启动（是 if let Ok，不是 ?）",
  /if let Ok\(extension\) = crate::config::apix_reload_extension\(\)/.test(piRs),
);
check(
  "扩展参数排在 --session 之后、current_dir 之前（只是摆放位置，不影响语义）",
  piRs.indexOf('arg("--extension")') > piRs.indexOf('arg("--session")'),
);

// ------------------------------------------------------------- 前端发这条命令

check("usePi 导出了 reloadConfig", /^\s+reloadConfig,/m.test(usePi));
check(
  "reloadConfig 发的是 /" + COMMAND + " 命令",
  usePi.includes(`message: "/${COMMAND}"`),
);
check(
  "reloadConfig 在发命令前等当前回合结束",
  /waitUntilIdle\(\)/.test(usePi) && /await waitUntilIdle\(\)/.test(usePi),
);
check(
  "并发调用会合并（burst 只触发一次重载）",
  /if \(reloadRef\.current\) return reloadRef\.current/.test(usePi),
);
check(
  "重载成功后推进 generation，让模型列表等派生状态重新取",
  /engineGenerationRef\.current \+= 1/.test(usePi),
);

// ------------------------------------------------------------- 设置页不再要人按重启

check("设置页不再出现「配置已改，pi 不会自动重读」", !settings.includes("pi 不会自动重读"));
check("设置页不再有 setDirty 那套布尔脏标记", !settings.includes("setDirty"));
check("设置页接了 onApplyConfig", /onApplyConfig/.test(settings) && /await onApplyConfig\(\)/.test(settings));
check(
  "「重启引擎」只在自动应用失败时出现",
  /apply === "error"[\s\S]{0,400}onRestartEngine/.test(settings),
);
check("写入是防抖的（一行开关只算一次改动）", /applyTimer\.current = window\.setTimeout/.test(settings));
check(
  "重载期间又来了写入，会在结束后补跑一次",
  /applying\.current\) \{\s*\n\s*queued\.current = true/.test(settings),
);
check("App 把 pi.reloadConfig 传给了设置页", /onApplyConfig=\{pi\.reloadConfig\}/.test(app));
check(
  "引擎就绪后会预热一次重载（首次 ~4s → 之后 ~1.1s）",
  /warmedReload/.test(app) && /void pi\.reloadConfig\(\)/.test(app),
);
check(
  "预热按「进程」而不是「generation」记账（否则会无限自我触发）",
  /A new process has its own first-reload cost to pay/.test(appRaw) && !/warmedGeneration/.test(app),
);

// ---------------------------------------------------------------------- 汇总

let failed = 0;
for (const { name, ok, detail } of results) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exitCode = failed === 0 ? 0 : 1;
