export const TOKENDANCE_PROVIDER = "tokendance";

export const TOKENDANCE_BASE_URL = "https://tokendance.space/gateway/v1";

export const TOKENDANCE_APP_URL = "https://pideck.caoayu.top/";

export const TOKENDANCE_AUTH_URL = "https://tokendance.space/auth";

export const TOKENDANCE_EXCHANGE_URL = "https://tokendance.space/portal/api/v1/auth/keys";

export const TOKENDANCE_KEY_NAME = "PiDeck";

export const TOKENDANCE_APP_URL_HEADER = "X-App-URL";

export type TokendanceAuthMode = "callback" | "headless";

export const TOKENDANCE_PORTAL_API_URL = "https://tokendance.space/portal/api/v1";

export const TOKENDANCE_PAYMENT_SESSIONS_URL = `${TOKENDANCE_PORTAL_API_URL}/payment/sessions`;

export const TOKENDANCE_PAYMENT_SESSION_PATH_PREFIX = "/portal/api/v1/payment/sessions/";

export const TOKENDANCE_TOP_UP_MIN_AMOUNT = 1;
export const TOKENDANCE_TOP_UP_MAX_AMOUNT = 100000;

export type TokendancePaymentStatus = "pending" | "paid" | "failed" | "closed" | "refunded";

export type TokendancePaymentSession = {
	id: string;

	amount: number;
	status: TokendancePaymentStatus;

	paymentUrl: string;

	alipayUrl?: string;

	statusUrl: string;

	expiredAt: number;
	createdAt: number;

	paidAt?: number;
};

export type TokendancePaymentErrorCode = "invalid-amount" | "not-configured" | "endpoint-mismatch" | "bad-status-url" | "http" | "timeout" | "network" | "bad-response";

export type TokendancePaymentSessionResult =
	| {
			ok: true;
			session: TokendancePaymentSession;

			keyHint?: string;
	  }
	| { ok: false; code: TokendancePaymentErrorCode; detail?: string };
