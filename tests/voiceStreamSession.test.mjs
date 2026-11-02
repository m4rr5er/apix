import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/**
 * 流式会话（VolcengineStreamSession）的生命周期测试：WebSocket 用替身，不碰网络。
 *
 * 这里钉住的是「只有真机才会暴露」的四类问题：
 * 1. init 包没被 ACK 之前不能先发音频（服务端按收到顺序解析，音频抢先 = 协议错误）；
 * 2. 收尾包只能发一次（第二个收尾包服务端回错误帧，用户看到的是「每次停录必失败」）；
 * 3. 结果帧可能在 send 的同一轮里同步到达，等待必须先建好；
 * 4. 取消/超时/超限都必须有终局，不能留一条常驻 WebSocket 占住会话。
 */
// vm 上下文有自己一套内置对象，跨 realm 的 instanceof 恒 false：会话里那道
// 「帧字节必须是 Uint8Array/ArrayBuffer」的守卫会把测试发来的帧整个丢掉。注入宿主构造器。
const realmGlobals = { globals: { Uint8Array, ArrayBuffer } };
const { VolcengineStreamSession } = loadTsCommonJs("src/main/voice/VolcengineStreamSession.ts", realmGlobals);

const CREDENTIALS = { appId: "app-1", accessToken: "tok-1", resourceId: "volc.bigasr.sauc.duration", language: "zh" };
const ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel";
const MESSAGE_INIT = 0b0001;
const MESSAGE_AUDIO = 0b0010;

function int32BE(value) {
	const buffer = Buffer.alloc(4);
	buffer.writeInt32BE(value, 0);
	return buffer;
}

/** 造一帧服务端下行的结果帧（载荷是 gzip JSON，与真实服务端一致）。 */
function resultFrame(text, { sequence = 2, last = false } = {}) {
	const body = gzipSync(Buffer.from(JSON.stringify({ result: { text } }), "utf8"));
	return Buffer.concat([Buffer.from([0x11, (0b1001 << 4) | 0b0001 | (last ? 0b0010 : 0), 0x11, 0x00]), int32BE(sequence), int32BE(body.length), body]);
}

function ackFrame({ sequence = 1 } = {}) {
	return Buffer.concat([Buffer.from([0x11, (0b1011 << 4) | 0b0001, 0x11, 0x00]), int32BE(sequence), int32BE(0)]);
}

function errorFrame(code, message, { sequence = 0 } = {}) {
	const body = gzipSync(Buffer.from(JSON.stringify({ message }), "utf8"));
	return Buffer.concat([Buffer.from([0x11, (0b1111 << 4) | 0b0001, 0x11, 0x00]), int32BE(sequence), int32BE(code), int32BE(body.length), body]);
}

/** WebSocket 替身：记录上行字节，由测试手动触发下行事件。 */
function createFakeSocket() {
	const sent = [];
	const handlers = { open: [], message: [], error: [], close: [] };
	const socket = {
		sent,
		closed: false,
		on: (type, listener) => handlers[type].push(listener),
		send: (data) => sent.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength)),
		// teardown 已结算过等待方，这里只记录「连接被关闭」，不回调 close 事件（那是网络侧的事）。
		close: () => {
			socket.closed = true;
		},
		emit(type, value) {
			for (const listener of [...handlers[type]]) listener(value);
		},
	};
	return socket;
}

function createSession(overrides = {}) {
	const partials = [];
	const sockets = [];
	const session = new VolcengineStreamSession(
		{
			createSocket: (url, headers) => {
				const socket = createFakeSocket();
				socket.url = url;
				socket.headers = headers;
				sockets.push(socket);
				return socket;
			},
			onPartial: (text, final) => partials.push({ text, final }),
			log: () => undefined,
			...overrides,
		},
		CREDENTIALS,
		ENDPOINT,
	);
	return { session, sockets, partials };
}

/** 走完握手：连接建立 → 服务端 ACK。 */
function handshake(socket) {
	socket.emit("open", undefined);
	socket.emit("message", ackFrame({ sequence: 1 }));
}

test("握手期失败立刻结算开流，不让设置页等满超时", async () => {
	const { session, sockets } = createSession();
	const started = session.open();
	sockets[0].emit("error", undefined);
	assert.deepEqual({ ...(await started) }, { ok: false, error: "network" });
});

test("服务端错误帧按业务码分类：45000030 是「没开通」不是「Key 无效」", async () => {
	const { session, sockets } = createSession();
	const started = session.open();
	const socket = sockets[0];
	socket.emit("open", undefined);
	socket.emit("message", errorFrame(45000030, "requested resource not granted"));
	const result = await started;
	assert.equal(result.ok, false);
	assert.equal(result.error, "notGranted", "误报成凭据错误会让用户反复改密钥，而该做的开通没人提示");
	assert.equal(result.detail.statusCode, "45000030");
});

test("ACK 之前推的音频帧排队补发，init 恒在最前且序号连续", async () => {
	const { session, sockets } = createSession();
	const started = session.open();
	const socket = sockets[0];
	assert.equal(session.push(new Uint8Array([1, 2, 3, 4])), true);
	socket.emit("open", undefined);
	assert.equal(session.push(new Uint8Array([5, 6])), true);
	socket.emit("message", ackFrame({ sequence: 1 }));
	await started;
	assert.deepEqual(
		socket.sent.map((packet) => packet[1] >> 4),
		[MESSAGE_INIT, MESSAGE_AUDIO, MESSAGE_AUDIO],
		"握手未完成时不得把音频排到 init 前面",
	);
	assert.deepEqual(
		socket.sent.map((packet) => packet.readInt32BE(4)),
		[1, 2, 3],
	);
});

test("握手期间就停录：等 ACK 补发积压后再收尾", async () => {
	const { session, sockets } = createSession();
	const started = session.open();
	const socket = sockets[0];
	session.push(new Uint8Array([1, 2]));
	const finished = session.finish();
	socket.emit("open", undefined);
	socket.emit("message", ackFrame({ sequence: 1 }));
	await started;
	assert.deepEqual(
		socket.sent.map((packet) => packet[1] >> 4),
		[MESSAGE_INIT, MESSAGE_AUDIO, MESSAGE_AUDIO],
		"顺序必须是 init → 音频 → 收尾",
	);
	socket.emit("message", resultFrame("收尾了", { sequence: 4, last: true }));
	assert.deepEqual({ ...(await finished) }, { ok: true, text: "收尾了" });
});
