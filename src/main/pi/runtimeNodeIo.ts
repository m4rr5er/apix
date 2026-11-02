import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, normalize } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RuntimeNodeDownloader = (url: string, destPath: string, expectedSha256OrProgress?: string | ((received: number, total?: number) => void), signal?: AbortSignal, options?: { resumeFromBytes?: number }) => Promise<void>;
export type RuntimeNodeExtractor = (archivePath: string, destDir: string) => Promise<void>;
export type RuntimeIoLog = (scope: string, message: string, detail?: unknown) => void;

export async function sha256OfFile(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	await pipeline(createReadStream(filePath), hash);
	return hash.digest("hex");
}

export function createNetDownloader(log?: RuntimeIoLog): RuntimeNodeDownloader {
	return async (url, destPath, expectedSha256OrProgress, signal, options) => {
		const response = await fetch(url, { signal });
		if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);
		await mkdir(dirname(destPath), { recursive: true });
		const tempPath = `${destPath}.part`;
		const onProgress = typeof expectedSha256OrProgress === "function" ? expectedSha256OrProgress : undefined;
		const expectedSha256 = typeof expectedSha256OrProgress === "string" ? expectedSha256OrProgress : undefined;
		const total = Number(response.headers.get("content-length")) || undefined;
		let received = options?.resumeFromBytes ?? 0;
		try {
			const stream = createWriteStream(tempPath, received > 0 ? { flags: "a" } : undefined);
			const reader = response.body.getReader();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!stream.write(Buffer.from(value))) await new Promise<void>((resolve) => stream.once("drain", () => resolve()));
				received += value.byteLength;
				onProgress?.(received, total);
			}
			await new Promise<void>((resolve, reject) => stream.end((error: Error | null | undefined) => (error ? reject(error) : resolve())));
			if (expectedSha256) {
				const actual = await sha256OfFile(tempPath);
				if (actual.toLowerCase() !== expectedSha256.toLowerCase()) throw new Error("sha256 mismatch");
			}
			await rename(tempPath, destPath);
			log?.("runtime-io", "download complete", { url, destPath });
		} finally {
			await rm(tempPath, { force: true }).catch(() => undefined);
		}
	};
}

function assertSafeArchiveEntries(entries: string): void {
	for (const raw of entries.split(/\r?\n/)) {
		const entry = raw.trim();
		if (!entry) continue;
		const normalized = normalize(entry).replace(/\\/g, "/");
		if (isAbsolute(entry) || /^[A-Za-z]:/.test(entry) || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
			throw new Error(`unsafe archive entry: ${entry}`);
		}
	}
}

export function createTarExtractor(log?: RuntimeIoLog): RuntimeNodeExtractor {
	return async (archivePath, destDir) => {
		const list = await execFileAsync("tar", ["-tf", archivePath], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
		assertSafeArchiveEntries(list.stdout);
		await mkdir(destDir, { recursive: true });
		await execFileAsync("tar", ["-xf", archivePath, "-C", destDir], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
		log?.("runtime-io", "archive extracted", { archivePath, destDir, entries: list.stdout.split(/\r?\n/).filter(Boolean).length });
	};
}
