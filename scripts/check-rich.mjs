/**
 * `src/lib/rich.tsx` 的回归测试。
 *
 * 手写的 Markdown 解析器最容易在边界上悄悄退化（一个正则改动就能让表格退回成
 * 裸管道符），所以这里断言的是**真实渲染出的 HTML**，不是解析器的内部结构 ——
 * 用 esbuild 把 rich.tsx 打成临时包，再用 react-dom/server 渲染，然后对 HTML 做断言。
 * 这样不需要为测试导出内部函数。
 *
 * 跑法：node scripts/check-rich.mjs
 * 退出码非 0 表示有断言失败。
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RICH = resolve("src/lib/rich.tsx");

const ENTRY = `
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from ${JSON.stringify(RICH)};

export function render(text) {
  return renderToStaticMarkup(createElement(RichText, { text }));
}
`;

const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
}

/** 计数出现次数。 */
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/**
 * 数某个标签的出现次数。
 *
 * 不能直接数 `<th` —— 那会把 `<thead>` 也算进去。要求后面跟空格或 `>`。
 */
function countTag(html, tag) {
  return (html.match(new RegExp(`<${tag}(?=[\\s>])`, "g")) || []).length;
}

async function loadRenderer() {
  const dir = mkdtempSync(join(tmpdir(), "apix-rich-"));
  const entry = join(dir, "entry.jsx");
  const out = join(dir, "bundle.mjs");
  writeFileSync(entry, ENTRY, "utf8");

  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    // 入口在系统临时目录里，默认的向上查找找不到项目的 node_modules。
    absWorkingDir: process.cwd(),
    nodePaths: [resolve("node_modules")],
    // React 走 CJS，打成 ESM 需要这个垫片；否则运行时报 "require is not defined"。
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    logLevel: "silent",
  });

  const mod = await import(pathToFileURL(out).href);
  return { render: mod.render, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const USER_TABLE = [
  "| 层 | 做法 |",
  "|---|---|",
  "| 设备层 | 200 台 iOS 固定 9480 版本，关自动更新；每台编号、供电、散热、独立账号/网络 |",
  "| 控制层 | 多台 Mac mini 做 worker，每台控制 8–12 台设备；Appium + WebDriverAgent |",
  "| 调度层 | Redis/Celery/Temporal：任务 = device_id + account + target_id + 动作 |",
  "| 采集层 | 路线 A：UI 自动化抓页面可见字段；路线 B：代理抓包拦截目标接口响应 |",
  "| 数据层 | mitmproxy/Appium 输出 -> Kafka/Redis -> parser -> ClickHouse/Postgres/S3 |",
  "| 风控层 | 低频、随机延迟、分时分组、canary；监控成功率、验证码率、封号率 |",
].join("\n");

async function main() {
  const { render, cleanup } = await loadRenderer();

  try {
    // ── 用户实际遇到的那张表 ──────────────────────────────────────────
    {
      const html = render(USER_TABLE);
      check("表格：渲染成 <table>", html.includes('<table class="md-table">'), html.slice(0, 120));
      check("表格：表头 2 列", countTag(html, "th") === 2, `实际 ${countTag(html, "th")}`);
      check("表格：数据 12 格", countTag(html, "td") === 12, `实际 ${countTag(html, "td")}`);
      check("表格：7 行（1 表头 + 6 数据）", countTag(html, "tr") === 7, `实际 ${countTag(html, "tr")}`);
      check("表格：单元格内容正确", html.includes("设备层") && html.includes("风控层"));
      check(
        "表格：不再残留分隔行字面量",
        !html.includes("|---|"),
        "输出里还有 |---|，说明表格没被识别",
      );
      check("表格：外层可横向滚动", html.includes('class="md-table-wrap"'));
    }

    // ── 对齐 ─────────────────────────────────────────────────────────
    {
      const html = render(["| a | b | c |", "|:--|:-:|--:|", "| 1 | 2 | 3 |"].join("\n"));
      check("对齐：左", html.includes("text-align:left"), html);
      check("对齐：居中", html.includes("text-align:center"));
      check("对齐：右", html.includes("text-align:right"));
    }

    // ── 单元格里的转义管道 ───────────────────────────────────────────
    {
      const html = render(["| a | b |", "|---|---|", "| x \\| y | z |"].join("\n"));
      check("转义：\\| 不拆列", countTag(html, "th") === 2 && html.includes("x | y"), html);
    }

    // ── 列表 ─────────────────────────────────────────────────────────
    {
      const html = render(["- 一级", "  - 二级", "  - 二级b", "- 又一级"].join("\n"));
      check("列表：无序", count(html, '<ul class="md-list">') === 2, `实际 ${count(html, '<ul class="md-list">')}`);
      check("列表：嵌套正确", html.includes("一级") && html.includes("二级b"));
    }
    {
      const html = render(["1. 第一", "2. 第二", "3. 第三"].join("\n"));
      check("列表：有序", html.includes('<ol class="md-list md-list-ordered"'), html);
      check("列表：从 1 开始时不加 start 属性", !html.includes("start="));
    }
    {
      const html = render(["3. 从三开始"].join("\n"));
      check("列表：start 生效", html.includes('start="3"'), html);
    }
    {
      // 同层级里从 `-` 换成 `1.` 必须断开成两个列表
      const html = render(["- 无序项", "1. 有序项"].join("\n"));
      check(
        "列表：标记类型切换会断开",
        count(html, "<ul") === 1 && count(html, "<ol") === 1,
        `ul=${count(html, "<ul")} ol=${count(html, "<ol")}`,
      );
    }

    // ── 标题 ─────────────────────────────────────────────────────────
    {
      const html = render(["## 二级", "### 三级"].join("\n"));
      check("标题：h2", html.includes("md-heading md-h2"), html);
      check("标题：h3", html.includes("md-heading md-h3"));
    }

    // ── 引用与分隔线 ─────────────────────────────────────────────────
    {
      const html = render(["> 引用一", "> 引用二", "", "---"].join("\n"));
      check("引用：渲染", html.includes('class="md-quote"') && html.includes("引用二"), html);
      check("分隔线：渲染", html.includes('class="md-hr"'));
    }

    // ── 代码块必须免疫解析 ───────────────────────────────────────────
    {
      const html = render(["```", "| 层 | 做法 |", "|---|---|", "```"].join("\n"));
      check("代码块：不解析成表格", !html.includes("<table"), html);
      check("代码块：内容保留", html.includes("| 层 | 做法 |"));
    }
    {
      const html = render(["```json", '{"a":1}', "```"].join("\n"));
      check("代码块：语言标记", html.includes('class="code-lang">json<'));
    }

    // ── 行内格式与误伤 ───────────────────────────────────────────────
    {
      const html = render("**粗** `码` ~~删~~ *斜* [文](https://example.com)");
      check("行内：粗体", html.includes('class="inline-strong"'));
      check("行内：行内码", html.includes('class="inline-code"'));
      check("行内：删除线", html.includes('class="inline-strike"'));
      check("行内：斜体", html.includes("inline-em\">"));
      check(
        "行内：链接可点（a + role）",
        html.includes('<a class="inline-link"') && html.includes('role="link"'),
        html,
      );
      check("行内：链接键盘可达", html.includes('tabindex="0"'));
      check("行内：URL 进 title", html.includes('title="https://example.com"'));
      check(
        "行内：绝对不带 href（带了 WebView 就有自己的导航路径）",
        !html.includes("href"),
        html,
      );
    }
    {
      const html = render("[邮件](mailto:a@b.com) [本地](file:///C:/x) [伪协议](javascript:alert(1))");
      check("行内：非 http(s) 不渲染成可点链接", !html.includes("<a "), html);
      check("行内：非 http(s) 标记为 inert", count(html, "is-inert") === 3, html);
    }
    {
      const html = render("看 https://example.com/a 这个");
      check("行内：裸 URL 自动成链", html.includes('title="https://example.com/a"'), html);
    }
    {
      const html = render("见 https://example.com/x.");
      check("行内：裸 URL 不吃句末句号", html.includes('title="https://example.com/x"'), html);
    }
    {
      const html = render("包裹 (https://example.com/y) 结束");
      check("行内：裸 URL 不吃右括号", html.includes('title="https://example.com/y"'), html);
    }
    {
      const html = render("见 https://example.com/z。中文句号");
      check("行内：裸 URL 不吃中文句号", html.includes('title="https://example.com/z"'), html);
    }
    {
      const html = render("`https://example.com/code` 在行内码里不成链");
      check("行内：行内码里的 URL 不成链", !html.includes("inline-link"), html);
    }
    {
      const html = render("2 * 3 * 4 等于 24");
      check("误伤：乘法星号不斜体", !html.includes("inline-em"), html);
    }
    {
      const html = render("变量 some_var_name 和 a_b_c 不该斜体");
      check("误伤：snake_case 不斜体", !html.includes("inline-em"), html);
    }

    // ── 段落保留硬换行 ───────────────────────────────────────────────
    {
      const html = render(["第一行", "第二行"].join("\n"));
      check("段落：合并成一个块", count(html, 'class="md-para"') === 1, html);
      check("段落：保留换行", html.includes("第一行\n第二行"), JSON.stringify(html));
    }

    // ── 混排：块之间不能串味 ─────────────────────────────────────────
    {
      const html = render(
        ["## 标题", "", "一段话。", "", "- 项一", "- 项二", "", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"),
      );
      check("混排：标题", html.includes("md-h2"));
      check("混排：段落", html.includes('class="md-para"'));
      check("混排：列表", html.includes('<ul class="md-list">'));
      check("混排：表格", html.includes('<table class="md-table">'));
      check("混排：顺序正确", html.indexOf("md-h2") < html.indexOf("md-para") && html.indexOf("md-para") < html.indexOf("md-list"));
    }

    // ── 空输入与纯空白的健壮性 ───────────────────────────────────────
    {
      check("空字符串：不抛异常", render("") === "", JSON.stringify(render("")));
      check("纯空白：不抛异常", render("   \n\n  ") === "");
    }
  } finally {
    cleanup();
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "  ✔" : "  ✘"} ${r.name}${r.ok || !r.detail ? "" : `\n      ${r.detail.slice(0, 200)}`}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) {
    console.log(`失败 ${failed.length} 项：${failed.map((f) => f.name).join(" / ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
