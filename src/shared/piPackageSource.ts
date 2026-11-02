const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;

const UNC_PATH = /^\\\\/;

const POSIX_ABSOLUTE = /^\//;

const EXPLICIT_RELATIVE = /^\.\.?[\\/]/;

const PROTOCOL = /^(?:npm|file|github|git|https?):/i;

export function isPathLikePackageSource(source: string): boolean {
	const value = source.trim();
	if (!value) return false;
	return WINDOWS_DRIVE.test(value) || UNC_PATH.test(value) || POSIX_ABSOLUTE.test(value) || EXPLICIT_RELATIVE.test(value);
}

export function isPackageSource(source: string): boolean {
	const value = source.trim();
	return PROTOCOL.test(value) || isPathLikePackageSource(value);
}
