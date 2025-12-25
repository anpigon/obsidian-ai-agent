// Settings
export interface AIChatSettings {
	apiKey?: string;
	model?: string;
	debugContext?: boolean;
}

export const DEFAULT_SETTINGS: AIChatSettings = {
	apiKey: '',
	model: 'claude-sonnet-4-20250514',
	debugContext: false
}

// Available models
export const AVAILABLE_MODELS = [
	{ value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5 (Most capable)' },
	{ value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (Balanced)' },
	{ value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5 (Latest)' },
	{ value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fastest)' }
];

// Content block types
export interface TextBlock {
	type: "text";
	text: string;
}

export interface ToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolResultBlock {
	type: "tool_result";
	tool_use_id: string;
	content?: string;
	is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

// Message types
export interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: ContentBlock[];
	model?: string;
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		service_tier?: string;
	};
}

export interface ChatMessage {
	type: "assistant" | "user" | "result" | "system";
	message?: Message;
	subtype?: "success" | "error" | "init";
	duration_ms?: number;
	duration_api_ms?: number;
	is_error?: boolean;
	num_turns?: number;
	result?: string;
	session_id: string;
	total_cost_usd?: number;
	uuid: string;
	timestamp?: Date;
	isUserInput?: boolean;
}

// SDK Message types (from Claude Agent SDK)
export interface SDKMessage {
	type: "assistant" | "user" | "result" | "system";
	subtype?: "success" | "error" | "init";
	session_id?: string;
	message?: {
		id?: string;
		role?: 'user' | 'assistant';
		content?: ContentBlock[];
		model?: string;
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			service_tier?: string;
		};
	};
	duration_ms?: number;
	duration_api_ms?: number;
	is_error?: boolean;
	num_turns?: number;
	result?: string;
	total_cost_usd?: number;
}
