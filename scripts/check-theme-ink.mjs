/**
 * 文字与底色不能是同一个颜色。
 *
 * 设置页「模型供应商」里，被设为默认的供应商名字右边会挂一个琥珀色胶囊（`.cell-flag`）。
 * 它原来写的是 `background: var(--apx-amber-soft)` + `color: var(--apx-amber-label)`，
 * 而在**深色主题**下这两个令牌的值逐字节相同（都是 `#ffb340`）——于是胶囊渲染成一个
 * **里面没有字的黄色椭圆**。浅色主题下它们不同，所以只在深色下看得见。
 *
 * 根因不是某一行写错，而是 `--apx-amber-label` 一个令牌被要求干两件互斥的事：
 * 在**实心**琥珀底上当字（需要暗色），以及在页面/半透明琥珀底上当琥珀色文字（需要亮色）。
 * 修法是拆出 `--apx-amber-ink` 专供实心底，`--apx-amber-label` 保留原职责。
 *
 * 这个脚本把那条真正的规则钉住：**同一主题下，任何一条规则的文字色令牌，不得与它
 * 自己的底色令牌解析成同一个值。** 它比"检查 .cell-flag 那一行"更值钱——同类错误
 * 以后出现在别的组件里也会被抓到。
 *
 * 跑法：node scripts/check-theme-ink.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

// --------------------------------------------------------------- 变量表解析

/** 取一个选择器块里声明的自定义属性。块内不会再有嵌套块。 */
function varsOf(css, selector) {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return {};
  const open = css.indexOf("{", at);
  let depth = 0;
  let close = open;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const out = {};
  for (const m of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const SHEETS = [join("src", "styles.css"), join("src", "settings.css"), join("src", "tray.css")];
const sheets = new Map(SHEETS.map((file) => [file, readFileSync(file, "utf8")]));
const styles = sheets.get(SHEETS[0]);

// `:root` 是深色（应用默认），浅色主题在此基础上覆盖。
const THEMES = {
  dark: varsOf(styles, ":root"),
  light: { ...varsOf(styles, ":root"), ...varsOf(styles, ':root[data-theme="light"]') },
};

check(
  "两套主题都解析出了变量表",
  Object.keys(THEMES.dark).length > 50 && Object.keys(THEMES.light).length > 50,
  `dark ${Object.keys(THEMES.dark).length} / light ${Object.keys(THEMES.light).length}`,
);

// ------------------------------------------------- 令牌本身的断言（钉住本次修复）

for (const [theme, vars] of Object.entries(THEMES)) {
  check(
    `${theme}: --apx-amber-ink 存在，且不等于实心底色 --apx-amber-soft`,
    Boolean(vars["--apx-amber-ink"]) && vars["--apx-amber-ink"] !== vars["--apx-amber-soft"],
    `ink=${vars["--apx-amber-ink"]} soft=${vars["--apx-amber-soft"]}`,
  );
}

check(
  "深色下 --apx-amber-label 仍与实心底同色（保持原样，未被过度修复）",
  THEMES.dark["--apx-amber-label"] === THEMES.dark["--apx-amber-soft"],
  `${THEMES.dark["--apx-amber-label"]} vs ${THEMES.dark["--apx-amber-soft"]}`,
);

const flag = sheets.get(SHEETS[1]);
check(
  "默认标记 .cell-flag 用的是 --apx-amber-ink",
  /\.cell-flag\s*\{[^}]*color:\s*var\(--apx-amber-ink\)/.test(flag),
);
check(
  "半透明底的标签 .skill-row-tag 仍用 --apx-amber-label",
  /\.skill-row-tag\s*\{[^}]*color:\s*var\(--apx-amber-label\)/.test(styles),
);

// --------------------------------- 令牌不相等还不够：直接量「看不看得清」

/** `#rgb` / `#rrggbb` → [r,g,b]（0–255）。不是十六进制则返回 null。 */
function rgb(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!hex) return null;
  const body = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
  return [0, 2, 4].map((i) => parseInt(body.slice(i, i + 2), 16));
}

/** WCAG 相对亮度。 */
function luminance([r, g, b]) {
  const channel = (raw) => {
    const v = raw / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 对比度，1–21。 */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 两个令牌值不同只是必要条件，不是充分条件——它们可以不同却照样看不清。
 * 这一条直接给「胶囊里的字看不看得见」一个数字。4.5:1 是 WCAG AA 对正文的下限。
 * 修好之前这里是 1.00:1（同色）；修好之后约 8:1。
 */
for (const [theme, vars] of Object.entries(THEMES)) {
  const bg = rgb(vars["--apx-amber-soft"]);
  const fg = rgb(vars["--apx-amber-ink"]);
  const ratio = bg && fg ? contrast(bg, fg) : 0;
  check(
    `${theme}: 「默认」胶囊文字对比度 ≥ 4.5:1（WCAG AA）`,
    ratio >= 4.5,
    `实得 ${ratio.toFixed(2)}:1`,
  );
}

// ------------------------------------------- 通例：文字色令牌 != 同一条规则的底色令牌

/**
 * 把样式表切成「选择器 { 声明 }」。@media / @supports 的字面量会被跳过，
 * 它们内部的选择器由下一层扫描覆盖不到——这里刻意只查最外层，够用且不会误伤。
 */
function rules(css) {
  const out = [];
  for (const m of css.matchAll(/(^|\n)([^\n{}@{][^{}]*)\{([^{}]*)\}/g)) {
    const [, , selector, body] = m;
    // 选择器前面常跟着一段注释，报告里带上它只会把真正的选择器挤掉。
    out.push({ selector: selector.replace(/\/\*[\s\S]*?\*\//g, "").trim(), body });
  }
  return out;
}

/** 同一条规则里，底色令牌解析出的值与文字色令牌解析出的值。 */
function inkPair(rule, vars) {
  const bg = /background(?:-color)?:\s*var\((--[\w-]+)\)/.exec(rule.body);
  // 前面加边界，避免把 border-color / outline-color 当成文字色。
  const fg = /(?:^|[;{\s])color:\s*var\((--[\w-]+)\)/.exec(`;${rule.body}`);
  if (!bg || !fg) return null;
  const bgValue = vars[bg[1]];
  const fgValue = vars[fg[1]];
  if (!bgValue || !fgValue) return null;
  return { bg: bg[1], fg: fg[1], bgValue, fgValue };
}

const collisions = [];
for (const [theme, vars] of Object.entries(THEMES)) {
  for (const [file, css] of sheets) {
    for (const rule of rules(css)) {
      const pair = inkPair(rule, vars);
      if (pair && pair.bgValue === pair.fgValue) {
        collisions.push(`${theme} ${file} ${rule.selector}: ${pair.bg} == ${pair.fg} (${pair.bgValue})`);
      }
    }
  }
}

check(
  "没有任何规则的文字色与自己的底色撞成同一颜色",
  collisions.length === 0,
  collisions.join(" | "),
);

// ---------------------------------------------------------------------- 汇总

let failed = 0;
for (const { name, ok, detail } of results) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exitCode = failed === 0 ? 0 : 1;
