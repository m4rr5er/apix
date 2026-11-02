import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { countSessionUserTurns } = loadTsCommonJs("src/main/pi/SessionHistoryReader.ts");

test("countSessionUserTurns：连续 user 合并为一轮，assistant/tool 不额外计数", () => {
	assert.equal(countSessionUserTurns([{ role: "user" }, { role: "assistant" }, { role: "toolResult" }, { role: "user" }, { role: "user" }, { role: "assistant" }, { role: "system" }, { role: "user" }]), 3);
	assert.equal(countSessionUserTurns([]), 0);
});
