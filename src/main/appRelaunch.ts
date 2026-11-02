export type DesktopRelaunchOptions = {
	execPath?: string;
	args: string[];
};

export function desktopRelaunchOptions(env: NodeJS.ProcessEnv, argv: readonly string[]): DesktopRelaunchOptions {
	const portable = env.PORTABLE_EXECUTABLE_FILE?.trim();

	const args = argv.slice(1);
	return portable ? { execPath: portable, args } : { args };
}
