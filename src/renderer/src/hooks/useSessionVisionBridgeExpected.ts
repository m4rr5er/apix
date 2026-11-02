import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { sessionRecordByIdAtomFamily, sessionRuntimeBySessionIdAtomFamily } from "../atoms";
import { desktopApi } from "../desktopApi";
import { modelSupportsNativeImages, resolveVisionBridgeExpected } from "../utils/modelImageCapability";

export function useSessionVisionBridgeExpected(sessionId: string, hasUserImages: boolean): boolean | null {
	const session = useAtomValue(sessionRecordByIdAtomFamily(sessionId));
	const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(sessionId));
	const backend = session?.backend ?? runtime?.backend ?? "pi";
	const provider = runtime?.state?.provider ?? session?.model?.provider;
	const modelId = runtime?.state?.modelId ?? session?.model?.modelId;
	const lookupKey = `${backend}\0${provider ?? ""}\0${modelId ?? ""}\0${hasUserImages ? "1" : "0"}`;
	const [fetched, setFetched] = useState<{ key: string; supports: boolean } | null>(null);

	useEffect(() => {
		if (!hasUserImages) return;
		let cancelled = false;
		const listed = desktopApi.projects.listModels(session?.projectId).catch(() => []);
		const localFile = desktopApi.config
			.getModels()
			.then((result) => result.parsed)
			.catch(() => undefined);
		void Promise.all([listed, localFile]).then(([models, parsed]) => {
			if (cancelled) return;
			setFetched({
				key: lookupKey,
				supports: modelSupportsNativeImages(models, { provider, modelId }, parsed),
			});
		});
		return () => {
			cancelled = true;
		};
	}, [lookupKey, hasUserImages, backend, session?.projectId, provider, modelId]);

	const modelSupportsImages = fetched?.key === lookupKey ? fetched.supports : hasUserImages ? null : false;
	return resolveVisionBridgeExpected({ backend, modelSupportsImages });
}
