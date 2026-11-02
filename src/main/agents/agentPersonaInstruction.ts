export type ComposeAgentInstructionInput = {
	persona: string;

	message: string;

	existingAgentMessage?: string;

	backend: string | undefined;
};

export type ComposedAgentInstruction = {
	message: string;

	agentMessage?: string;
};

export function composeAgentInstruction(input: ComposeAgentInstructionInput): ComposedAgentInstruction {
	const persona = input.persona.trim();
	if (!persona) {
		return input.existingAgentMessage === undefined ? { message: input.message } : { message: input.message, agentMessage: input.existingAgentMessage };
	}

	return { message: input.message, agentMessage: `${persona}\n\n${input.existingAgentMessage ?? input.message}` };
}
