/**
 * 背景资源的加载方式、以及「能不能当背景用」检查。
 *
 * 池子里 11 个背景，其中 **BubbleText** 与 **GlowingParticles** 依赖 three.js
 * （其余 9 个只用 React + 自绘 canvas/WebGL）。如果这两个被静态 import，
 * three（约 650KB 源码）就会进入**首包**：空会话要为 9 个用不到它的背景、
 * 以及 2 个只有摇到才用得上的背景付出代价。所以它们必须走 `lazy(() => import(...))`。
 *
 * 这个脚本钉住三件事：
 *   1. 谁是 three 的使用者，以及它们是不是动态加载的（顺带校验 dist 真的拆出了分块）；
 *   2. 池子里的每一件都**有自主的动画**；
 *   3. 每一件都在 `VARIANTS`、`PALETTE`（两套主题）、JSX 分支里各出现一次。
 *
 * 第 2 条是被一次真实事故逼出来的：`CrystalGlow` 的字母是 `color: transparent` +
 * 6 层橙色 `text-shadow`，而每一层的偏移都乘了 `--hover`，`--hover` 只在 `:hover`
 * 时变 1——背景容器是 `pointer-events: none`，永远 hover 不到，于是 6 层叠成一块
 * 实心橙色字、静止不动。同批被删掉的 `PredictiveArc` 也是点阵静止、只有一道弧带在呼吸。
 * 所以这里不钉死那两个名字，而是钉住**「必须能自己动」**这条规则：再从同一个
 * vendored 组件集里搬一件进来，如果它是纯 hover 驱动的，这个脚本会直接拦住。
 *
 * 跑法：node scripts/check-backdrops.mjs
 * 退出码非 0 表示有断言失败。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join("src", "components", "backdrops");
const THREE_USERS = ["BubbleText", "GlowingParticles"];

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

// ---------------------------------------------------------------- 谁是 three 用户
const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx") && f !== "index.tsx");
const importers = files.filter((f) => /from\s+["']three["']/.test(readFileSync(join(DIR, f), "utf8")));

check(
  "只有 BubbleText 与 GlowingParticles 依赖 three",
  importers.length === THREE_USERS.length &&
    THREE_USERS.every((name) => importers.includes(`${name}.tsx`)),
  `实际：${importers.join(", ")}`,
);

// ------------------------------------------------- 其余 9 个必须仍然静态可用
const index = readFileSync(join(DIR, "index.tsx"), "utf8");
const others = files
  .map((f) => f.replace(/\.tsx$/, ""))
  .filter((name) => !THREE_USERS.includes(name));
const staticallyImported = others.filter((name) =>
  new RegExp(`^import\\s+${name}\\s+from\\s+["']\\./${name}["']`, "m").test(index),
);
check(
  "其余 9 个背景仍是普通静态引入（改动没有波及它们）",
  staticallyImported.length === others.length,
  `${staticallyImported.length}/${others.length}`,
);

// -------------------------------------------- 那两个必须是动态 import（lazy）
for (const name of THREE_USERS) {
  check(
    `${name} 没有被静态 import`,
    !new RegExp(`^import\\s+${name}\\s+from\\s+["']\\./${name}["']`, "m").test(index),
  );
  check(
    `${name} 通过 lazy(() => import(...)) 加载`,
    new RegExp(`lazy\\(\\(\\)\\s*=>\\s*import\\(["']\\./${name}["']\\)\\)`).test(index),
  );
}
check("懒加载的分支外面有 Suspense 边界", /<Suspense\s+fallback=/.test(index));

// ---------------------------------- 每一件都必须能自己动（背景不是按钮）
//
// 纯 hover 驱动的件当背景等于冻住：`.newchat-backdrop` 是 `pointer-events: none`，
// 永远收不到 hover。判据是「有没有自己的帧循环」——时间可以来自 rAF 的 now，
// 不一定非要 `performance.now()`，所以只查前者的存在。
const frozen = files.filter((f) => !/requestAnimationFrame/.test(readFileSync(join(DIR, f), "utf8")));
check(
  "池子里没有「只有 hover 才动」的背景（那种件当背景就是冻住）",
  frozen.length === 0,
  frozen.length ? frozen.join(", ") : `${files.length} 件全部有帧循环`,
);

// ------------------------------------------------ VARIANTS / PALETTE / JSX 对齐
const variants = (() => {
  const block = /const VARIANTS: BackdropVariant\[\] = \[([\s\S]*?)\];/.exec(index)?.[1] ?? "";
  return block.match(/"([a-z]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
})();
check(`池子里有 ${others.length + THREE_USERS.length} 个变体`, variants.length === others.length + THREE_USERS.length, variants.join(", "));
check("VARIANTS 里的每个变体都有 JSX 分支", variants.every((v) => index.includes(`variant === "${v}"`)));

for (const theme of ["dark", "light"]) {
  const at = index.indexOf(`\n  ${theme}: {`);
  const body = at < 0 ? "" : index.slice(at, index.indexOf("\n  },\n", at));
  const keys = (body.match(/^    ([a-z]+):/gm) ?? []).map((s) => s.trim().replace(":", ""));
  const missing = variants.filter((v) => !keys.includes(v));
  check(`${theme}: 每个变体都有一份调色`, missing.length === 0, missing.join(", "));
}
check("被删掉的两件不再出现", !/crystal|arc/.test(index), index.match(/crystal|arc/)?.[0] ?? "");

// -------------------------------------------------- 构建产物确实拆出了 three
const dist = join("dist", "assets");
if (existsSync(dist)) {
  const assets = readdirSync(dist);
  const threeChunk = assets.find((f) => /^three\.module.*\.js$/.test(f));
  check("构建产物把 three 拆成了独立分块", Boolean(threeChunk), threeChunk ?? "未找到");
  const entry = join("dist", "index.html");
  if (existsSync(entry)) {
    const html = readFileSync(entry, "utf8");
    check("首屏 HTML 不直接引用 three 分块", !threeChunk || !html.includes(threeChunk));
  }
} else {
  check("dist 尚不存在（先 npm run build 再复查）", true, "跳过产物校验");
}

let failed = 0;
for (const { name, ok, detail } of results) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exitCode = failed === 0 ? 0 : 1;
