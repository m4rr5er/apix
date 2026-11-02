import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const mod = loadTsCommonJs("src/shared/piPackageSource.ts");

test("isPathLikePackageSource 不误判协议源与裸文件名", () => {
	for (const value of ["npm:pi-tracker", "file:./x", "github:owner/repo", "git:https://x", "https://x/y", "pi-deck-demo-plugin.ts", "context-mode.ts"]) {
		assert.equal(mod.isPathLikePackageSource(value), false, value + " 不应判定为路径型包");
	}
});
