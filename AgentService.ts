import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AIChatSettings, SDKMessage, ChatMessage } from './types';

export interface AgentSession {
	sessionId: string | null;
	isActive: boolean;
}

export interface AgentExecutionOptions {
	prompt: string;
	workingDirectory: string;
	sessionId?: string | null;
	onMessage: (message: ChatMessage) => void;
	onError: (error: Error) => void;
	onComplete: () => void;
	signal?: AbortSignal;
}

export class AgentService {
	private settings: AIChatSettings;
	private currentAbortController: AbortController | null = null;

	constructor(settings: AIChatSettings) {
		this.settings = settings;
	}

	updateSettings(settings: AIChatSettings): void {
		this.settings = settings;
	}

	async execute(options: AgentExecutionOptions): Promise<string | null> {
		const { prompt, workingDirectory, sessionId, onMessage, onError, onComplete, signal } = options;

		this.currentAbortController = new AbortController();

		// Combine external signal with internal abort controller
		if (signal) {
			signal.addEventListener('abort', () => {
				this.currentAbortController?.abort();
			});
		}

		let activeSessionId: string | null = sessionId || null;

		try {
			// Set API key from settings if provided
			if (this.settings.apiKey) {
				process.env.ANTHROPIC_API_KEY = this.settings.apiKey;
			}

			const queryOptions: Record<string, unknown> = {
				model: this.settings.model || 'claude-sonnet-4-20250514',
				cwd: workingDirectory,
				permissionMode: 'bypassPermissions' as const,
			};

			// Resume session if provided
			if (sessionId) {
				queryOptions.resume = sessionId;
			}

			const stream = query({
				prompt,
				options: queryOptions,
			});

			for await (const message of stream) {
				// Check if aborted
				if (this.currentAbortController?.signal.aborted) {
					break;
				}

				const chatMessage = this.convertSDKMessage(message as SDKMessage, activeSessionId);

				// Extract session ID from init message
				if (message.type === 'system' && (message as SDKMessage).subtype === 'init') {
					activeSessionId = (message as SDKMessage).session_id || activeSessionId;
				}

				if (chatMessage) {
					onMessage(chatMessage);
				}
			}

			onComplete();
			return activeSessionId;

		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				// Cancelled by user
				onMessage({
					type: 'system',
					result: 'Execution cancelled by user',
					session_id: activeSessionId || `session-${Date.now()}`,
					uuid: `cancel-${Date.now()}`,
					timestamp: new Date()
				});
			} else {
				onError(error instanceof Error ? error : new Error(String(error)));
			}
			onComplete();
			return activeSessionId;
		} finally {
			this.currentAbortController = null;
		}
	}

	cancel(): void {
		if (this.currentAbortController) {
			this.currentAbortController.abort();
		}
	}

	private convertSDKMessage(sdkMessage: SDKMessage, sessionId: string | null): ChatMessage | null {
		const baseMessage = {
			session_id: sdkMessage.session_id || sessionId || `session-${Date.now()}`,
			uuid: `${sdkMessage.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			timestamp: new Date()
		};

		switch (sdkMessage.type) {
			case 'system':
				if (sdkMessage.subtype === 'init') {
					return {
						...baseMessage,
						type: 'system',
						subtype: 'init',
						session_id: sdkMessage.session_id || baseMessage.session_id
					};
				}
				return null;

			case 'assistant':
				if (sdkMessage.message) {
					return {
						...baseMessage,
						type: 'assistant',
						message: {
							id: sdkMessage.message.id || `msg-${Date.now()}`,
							role: 'assistant',
							content: sdkMessage.message.content || [],
							model: sdkMessage.message.model,
							usage: sdkMessage.message.usage
						}
					};
				}
				return null;

			case 'user':
				// Tool result messages from SDK
				if (sdkMessage.message) {
					return {
						...baseMessage,
						type: 'user',
						message: {
							id: sdkMessage.message.id || `msg-${Date.now()}`,
							role: 'user',
							content: sdkMessage.message.content || []
						}
					};
				}
				return null;

			case 'result':
				return {
					...baseMessage,
					type: 'result',
					subtype: sdkMessage.subtype || 'success',
					duration_ms: sdkMessage.duration_ms,
					duration_api_ms: sdkMessage.duration_api_ms,
					is_error: sdkMessage.is_error,
					num_turns: sdkMessage.num_turns,
					result: sdkMessage.result,
					total_cost_usd: sdkMessage.total_cost_usd
				};

			default:
				return null;
		}
	}
}
