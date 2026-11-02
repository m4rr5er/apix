export type BusySendDelivery = "steer" | "followUp";

export const DEFAULT_BUSY_SEND_DELIVERY: BusySendDelivery = "steer";

export function parseBusySendDelivery(value: unknown): BusySendDelivery {
	return value === "followUp" ? "followUp" : DEFAULT_BUSY_SEND_DELIVERY;
}

export function resolveBusySendDelivery(busy: boolean, configured: unknown, backend?: string): BusySendDelivery | undefined {
	if (!busy) return undefined;
	if (backend === "acp" || backend === "qoder") return "followUp";
	return parseBusySendDelivery(configured);
}
