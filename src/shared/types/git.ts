export type GitBranchInfo = {
	current: string | null;
	branches: string[];
};

export type GitRepoInfo = {
	path: string;

	name: string;

	relativePath: string;
};

export type GitGenerateCommitMessageResult =
	| { ok: true; message: string }
	| {
			ok: false;

			code: "GIT_COMMIT_MODEL_REQUIRED" | "GIT_COMMIT_BUSY" | "GIT_COMMIT_TIMEOUT" | "GIT_COMMIT_GENERATE_FAILED" | "GIT_COMMIT_NO_REPO" | "GIT_COMMIT_EMPTY_DIFF" | "GIT_COMMIT_DIFF_FAILED";
			message: string;
	  };

export type GitFileStatus = "modified" | "added" | "deleted" | "renamed";

export type GitChangedFile = {
	path: string;
	status: GitFileStatus;

	originalPath?: string;
};

export type WorktreeEntry = {
	path: string;
	branch: string;
};

export enum GitStatus {
	INDEX_MODIFIED,
	INDEX_ADDED,
	INDEX_DELETED,
	INDEX_RENAMED,
	INDEX_COPIED,
	MODIFIED,
	DELETED,
	UNTRACKED,
	IGNORED,
	INTENT_TO_ADD,
	INTENT_TO_RENAME,
	TYPE_CHANGED,
	ADDED_BY_US,
	ADDED_BY_THEM,
	DELETED_BY_US,
	DELETED_BY_THEM,
	BOTH_ADDED,
	BOTH_DELETED,
	BOTH_MODIFIED,

	INDEX_TYPE_CHANGED,
}

export type GitResourceGroupType = "merge" | "index" | "workingTree" | "untracked";

export type GitResource = {
	path: string;

	status: GitStatus;

	letter: string;

	oldPath?: string;
};

export type GitResourceGroups = {
	merge: GitResource[];
	index: GitResource[];
	workingTree: GitResource[];
	untracked: GitResource[];
};

export type GitDiscardResource = {
	group: "workingTree" | "untracked";
	path: string;
};

export type GitWorkspaceDiffGroup = GitResourceGroupType;

export type GitWorkspaceFileDiff = {
	path: string;
	originalContent: string;
	modifiedContent: string;
};

export type CommitEntry = {
	hash: string;
	shortHash: string;
	message: string;
	authorName: string;
	authorEmail: string;
	authorDate: number;
	parents: string[];
	refNames: string[];

	graph: string[];

	fullMessage?: string;

	shortStat?: { files: number; insertions: number; deletions: number };
};

export type CommitDetail = {
	commit: CommitEntry;
	files: GitChangedFile[];
};

export type GitCommitFileDiff = {
	path: string;
	originalPath?: string;
	originalContent: string;
	modifiedContent: string;
};

export type GitRef = {
	name: string;
	fullName: string;
	hash: string;
	type: "head" | "remote" | "tag";
};

export type GitAheadBehind = {
	ahead: number;

	behind: number;
};

export type BranchDiffResult = {
	files: GitChangedFile[];
	ahead: number;
	behind: number;
};

export type GitExecutableSource = "configured" | "path" | "known-location" | "not-found";

export type GitExecutableProbe = {
	resolvedPath: string;
	version: string;
};

export type GitSystemProbe = GitExecutableProbe & {
	source: Exclude<GitExecutableSource, "configured" | "not-found">;
};

export type GitExecutableInfo = {
	source: GitExecutableSource;

	executable: string;

	resolvedPath: string;

	version: string;

	error: string | null;

	system: GitSystemProbe | null;
};
