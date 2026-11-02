import type { ChatMessage } from "../../shared/types/session";

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export function sanitizeExportFileName(title: string, sessionId: string): string {
	const base = title
		.trim()
		.slice(0, 80)
		.replace(/[<>:"/\|?*\u0000-\u001f]/g, "_")
		.replace(/[. ]+$/g, "");
	return `${base || "session"}-${sessionId.slice(0, 8)}.html`;
}

export function renderSessionHtml(messages: readonly ChatMessage[], options: { title: string; cwd?: string; exportedAt: number }): string {
	const rows = messages
		.map((message) => {
			const role = escapeHtml(message.role);
			const text = escapeHtml(message.text);
			return `<article class="msg ${role}"><h3>${role}</h3><pre>${text}</pre></article>`;
		})
		.join("\n");
	return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(options.title)}</title>
<style>body{font:15px/1.65 system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 20px;color:#111}h1{font-size:24px}.meta{color:#666;font-size:12px}.msg{border-top:1px solid #ddd;padding:12px 0}.msg h3{font-size:12px;text-transform:uppercase;color:#666}pre{white-space:pre-wrap;word-break:break-word;font:inherit}</style></head>
<body><h1>${escapeHtml(options.title)}</h1><p class="meta">${escapeHtml(options.cwd ?? "")} · ${new Date(options.exportedAt).toISOString()}</p>${rows}</body></html>`;
}
