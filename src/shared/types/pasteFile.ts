export type PasteFileWriteInput = {
	projectPath: string;
	content: string;
};

export type PasteFileWriteResult = {
	path: string;
	fileName: string;
	bytes: number;

	inProject: boolean;
};
