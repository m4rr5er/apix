/**
 * Dependency-free rich text renderer.
 *
 * pi streams plain text; APIX renders it without pulling in a Markdown library,
 * which keeps the bundle small but means every construct has to be implemented
 * here. What was there before only understood fenced code, inline `code` and
 * **bold** — so tables, lists and headings came out as their own source text,
 * raw pipes and all.
 *
 * The parser is deliberately line-based rather than character-based: agent
 * output is written as lines, and a line-oriented pass handles the constructs
 * that actually appear (tables, lists, headings, quotes, rules) without a full
 * CommonMark implementation. Paragraphs keep their hard line breaks instead of
 * being soft-wrapped, matching how the model wrote them.
 *
 * Not implemented, on purpose: reference links, setext headings, HTML, nested
 * blockquotes, ordered-list start numbers with arbitrary delimiters. None of
 * them show up in agent output and each would add a pass over the text.
 *
 * Links open in the system browser through `@tauri-apps/plugin-opener`. It is
 * imported lazily so this module stays renderable outside a Tauri webview,
 * which is what `scripts/check-rich.mjs` relies on.
 */

import { Fragment, useCallback, useMemo, useState } from "react";

import { IconCheck, IconCopy } from "../components/ui/Icons";

type Align = "left" | "center" | "right" | null;

interface ListItem {
  text: string;
  sub: ListNode | null;
}

interface ListNode {
  ordered: boolean;
  start: number;
  items: ListItem[];
}

type Block =
  | { kind: "code"; lang?: string; value: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; node: ListNode }
  | { kind: "table"; align: Align[]; header: string[]; rows: string[][] }
  | { kind: "quote"; text: string }
  | { kind: "hr" };

// ---------------------------------------------------------------- block pass

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_RE = /^\s*```([a-zA-Z0-9_+#-]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const QUOTE_RE = /^\s*>/;
const DELIM_CELL_RE = /^:?-+:?$/;

/** Split a table row into cells, honouring `\|` escapes and optional outer pipes. */
function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;

  let body = trimmed;
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);

  const cells: string[] = [];
  let buffer = "";
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === "\\" && body[i + 1] === "|") {
      buffer += "|";
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += char;
  }
  cells.push(buffer.trim());
  return cells;
}

/**
 * A table needs the delimiter row — that is what distinguishes it from a
 * paragraph that happens to contain a pipe.
 */
function tryTable(lines: string[], index: number): { node: Block; next: number } | null {
  const header = splitRow(lines[index]);
  if (!header || header.length < 2) return null;

  const delimiter = index + 1 < lines.length ? splitRow(lines[index + 1]) : null;
  if (!delimiter || delimiter.length !== header.length) return null;

  const align: Align[] = [];
  for (const cell of delimiter) {
    if (!DELIM_CELL_RE.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    align.push(left && right ? "center" : right ? "right" : left ? "left" : null);
  }

  const rows: string[][] = [];
  let cursor = index + 2;
  while (cursor < lines.length) {
    if (!lines[cursor].trim()) break;
    const row = splitRow(lines[cursor]);
    if (!row) break;
    const cells = [...row];
    while (cells.length < header.length) cells.push("");
    rows.push(cells.slice(0, header.length));
    cursor += 1;
  }

  return { node: { kind: "table", align, header, rows }, next: cursor };
}

/** True when the line opens a block, so a paragraph must stop before it. */
function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  if (!line.trim()) return true;
  if (FENCE_RE.test(line)) return true;
  if (HEADING_RE.test(line)) return true;
  if (HR_RE.test(line)) return true;
  if (QUOTE_RE.test(line)) return true;
  if (LIST_RE.test(line)) return true;
  return tryTable(lines, index) !== null;
}

/**
 * Consume one list, recursing for nested items.
 *
 * Nesting is decided by indentation: a marker indented at least two columns
 * past the current level starts a child list. Two is the convention both
 * two- and four-space writers land on; requiring an exact match breaks on the
 * other.
 */
function isOrderedMarker(marker: string): boolean {
  return /^\d/.test(marker);
}

function parseList(lines: string[], start: number): { node: ListNode; next: number } {
  const first = LIST_RE.exec(lines[start]);
  if (!first) return { node: { ordered: false, start: 1, items: [] }, next: start + 1 };

  const base = first[1].length;
  const ordered = isOrderedMarker(first[2]);
  const node: ListNode = {
    ordered,
    start: ordered ? Number.parseInt(first[2], 10) || 1 : 1,
    items: [],
  };

  let cursor = start;
  let current: ListItem | null = null;

  while (cursor < lines.length) {
    const raw = lines[cursor];

    if (!raw.trim()) {
      // A blank line only ends the list when the next content is not part of it.
      let look = cursor + 1;
      while (look < lines.length && !lines[look].trim()) look += 1;
      if (look >= lines.length) break;
      const next = LIST_RE.exec(lines[look]);
      if (!next || next[1].length < base || isOrderedMarker(next[2]) !== ordered) break;
      cursor = look;
      continue;
    }

    const marker = LIST_RE.exec(raw);
    if (marker) {
      const indent = marker[1].length;
      if (indent < base) break;
      // Switching between `-` and `1.` at the same depth starts a new list.
      if (indent < base + 2 && isOrderedMarker(marker[2]) !== ordered) break;
      if (indent >= base + 2 && current) {
        const child = parseList(lines, cursor);
        current.sub = child.node;
        cursor = child.next;
        continue;
      }
      current = { text: marker[3].trim(), sub: null };
      node.items.push(current);
      cursor += 1;
      continue;
    }

    // An indented non-marker line continues the item it sits under.
    const column = raw.search(/\S/);
    if (current && column >= base + 2) {
      current.text = `${current.text} ${raw.trim()}`;
      cursor += 1;
      continue;
    }
    break;
  }

  return { node, next: cursor };
}

function parseBlocks(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // closing fence
      blocks.push({ kind: "code", lang: fence[1] || undefined, value: body.join("\n") });
      continue;
    }

    const table = tryTable(lines, i);
    if (table) {
      blocks.push(table.node);
      i = table.next;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }

    if (LIST_RE.test(line)) {
      const parsed = parseList(lines, i);
      blocks.push({ kind: "list", node: parsed.node });
      i = parsed.next;
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && !startsBlock(lines, i)) {
      paragraph.push(lines[i]);
      i += 1;
    }
    // Guarantee forward progress even if a construct slipped past the checks.
    if (paragraph.length === 0) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "para", text: paragraph.join("\n") });
  }

  return blocks;
}

// --------------------------------------------------------------- inline pass

type Token =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "italic"; value: string }
  | { kind: "strike"; value: string }
  | { kind: "link"; value: string; href: string };

/*
 * One pass, longest-marker-first (`**` before `*`). The guards around the
 * italic branch keep `2 * 3 * 4` and `snake_case` from becoming emphasis —
 * `_` is not treated as an emphasis marker at all, which is the usual reason
 * markdown renderers mangle identifiers.
 *
 * The last branch is a bare URL, because agents write `https://…` far more
 * often than `[text](url)`. It needs two character classes:
 *
 * - The middle one excludes CJK punctuation as well as whitespace. Chinese
 *   prose has no inter-word spaces, so `见 https://a.com/x。下一句` would
 *   otherwise be read as one long URL — and unlike `.` or `/`, a full-width
 *   `。` never legitimately appears inside a URL.
 * - The trailing one additionally excludes ASCII end-of-sentence punctuation
 *   and closing brackets, so `https://a.com/x.` does not keep the period and
 *   `(https://a.com/y)` does not keep the bracket.
 */
const INLINE_RE =
  /`([^`\n]+)`|\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|(?<![\w*])\*(\S|\S[^*\n]*\S)\*(?![\w*])|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>"'`\u3002\uff0c\uff1b\uff1a\uff01\uff1f\uff09\u300b\u300d]*[^\s<>"'`\u3002\uff0c\uff1b\uff1a\uff01\uff1f\uff09\u300b\u300d.,;:!?)\]}"'])/g;

const BARE_URL = 7;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;

  while ((match = INLINE_RE.exec(source)) !== null) {
    if (match.index > cursor) {
      tokens.push({ kind: "text", value: source.slice(cursor, match.index) });
    }
    if (match[1] !== undefined) tokens.push({ kind: "code", value: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: "bold", value: match[2] });
    else if (match[3] !== undefined) tokens.push({ kind: "strike", value: match[3] });
    else if (match[4] !== undefined) tokens.push({ kind: "italic", value: match[4] });
    else if (match[5] !== undefined) tokens.push({ kind: "link", value: match[5], href: match[6] });
    else if (match[BARE_URL] !== undefined) {
      tokens.push({ kind: "link", value: match[BARE_URL], href: match[BARE_URL] });
    }
    cursor = INLINE_RE.lastIndex;
  }

  if (cursor < source.length) {
    tokens.push({ kind: "text", value: source.slice(cursor) });
  }

  return tokens;
}

/**
 * A link in assistant output.
 *
 * Deliberately an `<a>` **without `href`**. Handing the URL to the system
 * browser is done by the opener plugin, and if the element also carried an
 * href the webview would keep its own navigation paths — middle-click,
 * ctrl-click, drag-and-drop — any of which would replace the whole app with a
 * web page. Without href there is no way to navigate at all, so a click can
 * only ever do the one thing we handle. `role` and `tabIndex` restore the
 * semantics and keyboard access that href would have provided.
 *
 * Only http(s) is offered: the capability scopes `open_url` to
 * http/https/mailto/tel, and rendering `file:` or `javascript:` as a live link
 * would promise something the permission layer refuses.
 */
const OPENABLE = /^https?:\/\//i;

function Link({ text, href }: { text: string; href: string }) {
  const [failed, setFailed] = useState(false);
  const openable = OPENABLE.test(href);

  const activate = useCallback(() => {
    if (!openable) return;
    void import("@tauri-apps/plugin-opener")
      .then((module) => module.openUrl(href))
      .catch(() => setFailed(true));
  }, [href, openable]);

  if (!openable) {
    return (
      <span className="inline-link is-inert" title={href}>
        {text}
      </span>
    );
  }

  return (
    <a
      className="inline-link"
      role="link"
      tabIndex={0}
      href={undefined}
      title={failed ? `打开失败：${href}` : href}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activate();
      }}
    >
      {text}
    </a>
  );
}

function Inline({ value }: { value: string }) {
  const tokens = useMemo(() => tokenize(value), [value]);
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.kind) {
          case "code":
            return (
              <code className="inline-code" key={index}>
                {token.value}
              </code>
            );
          case "bold":
            return (
              <strong className="inline-strong" key={index}>
                {token.value}
              </strong>
            );
          case "italic":
            return (
              <em className="inline-em" key={index}>
                {token.value}
              </em>
            );
          case "strike":
            return (
              <s className="inline-strike" key={index}>
                {token.value}
              </s>
            );
          case "link":
            return <Link text={token.value} href={token.href} key={index} />;
          default:
            return <Fragment key={index}>{token.value}</Fragment>;
        }
      })}
    </>
  );
}

// ------------------------------------------------------------------ render

function CodeBlock({ lang, value }: { lang?: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // The clipboard API can be unavailable; fall back to a scratch textarea.
      const scratch = document.createElement("textarea");
      scratch.value = value;
      scratch.style.position = "fixed";
      scratch.style.opacity = "0";
      document.body.appendChild(scratch);
      scratch.select();
      document.execCommand("copy");
      document.body.removeChild(scratch);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }, [value]);

  return (
    <pre className="code-block">
      <span className="code-head">
        {lang ? <span className="code-lang">{lang}</span> : null}
        <button
          className={`code-copy${copied ? " is-copied" : ""}`}
          type="button"
          title={copied ? "已复制" : "复制"}
          aria-label={copied ? "已复制" : "复制"}
          onClick={() => void copy()}
        >
          {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
        </button>
      </span>
      <code>{value}</code>
    </pre>
  );
}

function ListView({ node }: { node: ListNode }) {
  const items = node.items.map((item, index) => (
    <li key={index}>
      <Inline value={item.text} />
      {item.sub ? <ListView node={item.sub} /> : null}
    </li>
  ));

  return node.ordered ? (
    <ol className="md-list md-list-ordered" start={node.start === 1 ? undefined : node.start}>
      {items}
    </ol>
  ) : (
    <ul className="md-list">{items}</ul>
  );
}

function TableView({
  align,
  header,
  rows,
}: {
  align: Align[];
  header: string[];
  rows: string[][];
}) {
  const style = (index: number) => ({ textAlign: align[index] ?? undefined });

  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={index} style={style(index)}>
                <Inline value={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} style={style(cellIndex)}>
                  <Inline value={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "code":
      return <CodeBlock lang={block.lang} value={block.value} />;
    case "table":
      return <TableView align={block.align} header={block.header} rows={block.rows} />;
    case "list":
      return <ListView node={block.node} />;
    case "quote":
      return (
        <blockquote className="md-quote">
          <Inline value={block.text} />
        </blockquote>
      );
    case "hr":
      return <hr className="md-hr" />;
    case "heading":
      return (
        <p className={`md-heading md-h${block.level}`}>
          <Inline value={block.text} />
        </p>
      );
    default:
      return (
        <p className="md-para">
          <Inline value={block.text} />
        </p>
      );
  }
}

export function RichText({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </>
  );
}
