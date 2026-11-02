import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { trashPath } from "../fs/trash";
import { execGit } from "./gitRun";
import { resolveWslGitTarget, toHostGitOutputPath, type WslGitTarget } from "./gitWsl";
import { worktreeSlugify } from "../../shared/worktreeSlug";
import type { WorktreeEntry } from "../../shared/types";
import type { MainProcessTranslationKey } from "../../shared/i18n/mainProcessCopy";

type WorktreeCopy = (key: MainProcessTranslationKey, params?: Record<string, string | number>) => string;

export class WorktreeService {
	constructor(private readonly translate: WorktreeCopy = () => "Worktree operation failed.") {}

	async list(projectPath: string): Promise<WorktreeEntry[]> {
		try {
			const target = resolveWslGitTarget(projectPath);
			const { stdout } = await execGit(["worktree", "list", "--porcelain"], { cwd: projectPath });
			const mainWorktree = await this.getMainWorktree(projectPath);
			return this.parseWorktreeList(stdout, mainWorktree ?? projectPath, target);
		} catch {
			return [];
		}
	}

	async create(projectPath: string, projectId: string, branchName: string): Promise<{ path: string; branch: string }> {
		const baseSlug = worktreeSlugify(branchName);

		const parentDir = resolve(projectPath, "..");

		const { worktreeDir, branch } = await this.allocateWorktreeTarget(projectPath, parentDir, baseSlug);

		try {
			await execGit(["worktree", "add", "--no-checkout", "-b", branch, "--", worktreeDir], { cwd: projectPath });
		} catch (error) {
			console.error("[WorktreeService] git worktree add failed", error);
			throw new Error(this.translate("mainWorktree.createFailed"));
		}

		try {
			await execGit(["reset", "--hard"], { cwd: worktreeDir });
		} catch (error) {
			await this.remove(worktreeDir, projectPath).catch(() => false);
			console.error("[WorktreeService] git reset failed for new worktree", error);
			throw new Error(this.translate("mainWorktree.createFailed"));
		}

		return { path: worktreeDir, branch };
	}

	async remove(worktreePath: string, projectPath: string): Promise<boolean> {
		const entries = await this.list(projectPath);

		const normalizedTarget = this.canonicalSync(worktreePath);
		const entry = entries.find((asyncEntry) => this.samePath(asyncEntry.path, normalizedTarget));
		if (!entry) return false;

		const mainWorktree = await this.getMainWorktree(projectPath);
		if (mainWorktree && this.samePath(this.canonicalSync(mainWorktree), normalizedTarget)) {
			return false;
		}

		try {
			await execGit(["worktree", "remove", "--force", "--", worktreePath], { cwd: projectPath });
		} catch {
			if (existsSync(worktreePath)) return false;
		}

		if (!existsSync(worktreePath)) return true;

		await trashPath(worktreePath, { source: "git:worktree-remove" });

		const worktreeDirName = basename(worktreePath);
		if (entry.branch?.startsWith("pideck/") || entry.branch === worktreeDirName) {
			await execGit(["branch", "-D", entry.branch], { cwd: projectPath }).catch(() => undefined);
		}

		return true;
	}

	private async allocateWorktreeTarget(projectPath: string, parentDir: string, baseSlug: string) {
		const slug = baseSlug;
		const worktreeDir = join(parentDir, slug);
		const branch = slug;
		if (existsSync(worktreeDir)) {
			throw new Error(this.translate("mainWorktree.folderExists"));
		}
		const ref = await execGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: projectPath })
			.then(() => true)
			.catch(() => false);
		if (ref) {
			throw new Error(this.translate("mainWorktree.branchExists"));
		}
		return { worktreeDir, branch };
	}

	private async getMainWorktree(projectPath: string): Promise<string | null> {
		try {
			const { stdout } = await execGit(["rev-parse", "--git-common-dir"], { cwd: projectPath });

			const commonDir = toHostGitOutputPath(stdout.trim(), resolveWslGitTarget(projectPath));
			if (!commonDir) return null;
			return dirname(resolve(projectPath, commonDir));
		} catch {
			return null;
		}
	}

	private parseWorktreeList(stdout: string, rootPath: string, target: WslGitTarget | null): WorktreeEntry[] {
		const entries: WorktreeEntry[] = [];

		const normalizedRoot = this.canonicalSync(rootPath);

		const lines = stdout.split(/\r?\n/);
		let current: Partial<WorktreeEntry> | null = null;

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				if (current) {
					const path = current.path ? resolve(current.path) : "";
					if (!this.samePath(path, normalizedRoot)) {
						entries.push({
							path,
							branch: current.branch?.replace(/^refs\/heads\//, "") ?? "detached",
						});
					}
					current = null;
				}
				continue;
			}

			if (trimmed.startsWith("worktree ")) {
				current = { path: toHostGitOutputPath(trimmed.slice("worktree ".length).trim(), target) };
				continue;
			}

			if (current && trimmed.startsWith("branch ")) {
				current.branch = trimmed.slice("branch ".length).trim();
			}
		}

		if (current) {
			const path = current.path ? resolve(current.path) : "";
			if (!this.samePath(path, normalizedRoot)) {
				entries.push({
					path,
					branch: current.branch?.replace(/^refs\/heads\//, "") ?? "detached",
				});
			}
		}

		return entries;
	}

	private canonicalSync(input: string) {
		const normalized = resolve(input);
		return process.platform === "win32" ? normalized.toLowerCase() : normalized;
	}

	private samePath(a: string, b: string) {
		return this.canonicalSync(a) === this.canonicalSync(b);
	}
}
