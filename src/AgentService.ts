import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AIChatSettings, SDKMessage, ChatMessage } from './types';
import { MessageFactory } from './MessageFactory';

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

/**
 * AgentService - Claude Agent SDK와의 통신을 담당하는 서비스
 *
 * 책임:
 * - Claude Agent SDK query 함수 래핑
 * - 스트리밍 메시지 처리
 * - 세션 관리
 * - 취소 처리
 */
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

		// 외부 시그널과 내부 abort controller 연결
		if (signal) {
			signal.addEventListener('abort', () => {
				this.currentAbortController?.abort();
			});
		}

		let activeSessionId: string | null = sessionId || null;

		try {
			this.configureApiKey();

			const queryOptions = this.buildQueryOptions(workingDirectory, sessionId);

			const stream = query({
				prompt,
				options: queryOptions,
			});

			for await (const message of stream) {
				if (this.currentAbortController?.signal.aborted) {
					break;
				}

				const chatMessage = MessageFactory.convertSDKMessage(message as SDKMessage, activeSessionId);

				// init 메시지에서 세션 ID 추출
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
			this.handleError(error, activeSessionId, onMessage, onError);
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

	private configureApiKey(): void {
		if (this.settings.apiKey) {
			process.env.ANTHROPIC_API_KEY = this.settings.apiKey;
		}
	}

	private buildQueryOptions(workingDirectory: string, sessionId?: string | null): Record<string, unknown> {
		const options: Record<string, unknown> = {
			model: this.settings.model || 'claude-sonnet-4-20250514',
			cwd: workingDirectory,
			permissionMode: 'bypassPermissions' as const,
		};

		if (sessionId) {
			options.resume = sessionId;
		}

		// Phase 1-E: 시스템 프롬프트 적용
		if (this.settings.systemPrompt && this.settings.systemPrompt.trim()) {
			options.systemPrompt = this.settings.systemPrompt.trim();
		}

		return options;
	}

	private handleError(
		error: unknown,
		sessionId: string | null,
		onMessage: (message: ChatMessage) => void,
		onError: (error: Error) => void
	): void {
		if (error instanceof Error && error.name === 'AbortError') {
			const cancelMessage = MessageFactory.createCancelMessage(sessionId);
			onMessage(cancelMessage);
		} else {
			onError(error instanceof Error ? error : new Error(String(error)));
		}
	}
}
