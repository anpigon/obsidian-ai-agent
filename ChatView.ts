import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { AIChatSettings, ChatMessage } from './types';
import { AgentService } from './AgentService';
import { ChatRenderer } from './ChatRenderer';
import { MessageFactory } from './MessageFactory';
import { createExampleMessages } from './exampleMessages';

export const VIEW_TYPE_AI_CHAT = 'ai-chat-view';

/**
 * AIChatView - AI 채팅 인터페이스의 메인 뷰 클래스
 *
 * 책임:
 * - Obsidian ItemView 라이프사이클 관리
 * - 채팅 UI 초기화 및 이벤트 핸들링
 * - 메시지 상태 관리
 * - AgentService와의 통신 조율
 */
export class AIChatView extends ItemView {
	// 설정 및 서비스
	private settings: AIChatSettings;
	private agentService: AgentService;
	private renderer: ChatRenderer;

	// 상태
	private messages: ChatMessage[] = [];
	private currentSessionId: string | null = null;
	private includeFileContext: boolean = true;
	private isProcessing: boolean = false;

	// DOM 요소
	private chatContainer: HTMLElement;
	private messagesContainer: HTMLElement;
	private inputContainer: HTMLElement;
	private inputField: HTMLTextAreaElement;
	private sendButton: HTMLButtonElement;
	private loadingIndicator: HTMLElement;
	private fileContextHeader: HTMLElement;

	constructor(leaf: WorkspaceLeaf, settings: AIChatSettings) {
		super(leaf);
		this.settings = settings;
		this.agentService = new AgentService(settings);
	}

	getViewType(): string {
		return VIEW_TYPE_AI_CHAT;
	}

	getDisplayText(): string {
		return 'AI Chat';
	}

	getIcon(): string {
		return 'sparkles';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('ai-chat-container');

		this.createChatInterface(container);
		this.renderer = new ChatRenderer(this.messagesContainer);
	}

	async onClose(): Promise<void> {
		if (this.isProcessing) {
			this.agentService.cancel();
		}
	}

	// ==================== UI 생성 ====================

	private createChatInterface(container: HTMLElement): void {
		this.createHeader(container);
		this.createChatBody(container);
		this.createInputArea(container);
	}

	private createHeader(container: HTMLElement): void {
		const headerEl = container.createEl('div', { cls: 'ai-chat-header' });

		headerEl.createEl('div', {
			text: 'AI Agent',
			cls: 'ai-chat-title'
		});

		const buttonGroupEl = headerEl.createEl('div', { cls: 'ai-header-buttons' });

		// Examples 버튼
		const examplesButton = buttonGroupEl.createEl('button', {
			text: 'Examples',
			cls: 'ai-examples-button'
		});
		examplesButton.addEventListener('click', () => this.showExamples());

		// Settings 버튼
		const settingsButton = buttonGroupEl.createEl('button', {
			cls: 'ai-settings-button',
			attr: { 'aria-label': 'Plugin settings' }
		});
		setIcon(settingsButton, 'settings');
		settingsButton.addEventListener('click', () => this.openSettings());

		// New Chat 버튼
		const newChatButton = buttonGroupEl.createEl('button', {
			cls: 'ai-new-chat-button',
			attr: { 'aria-label': 'New chat' }
		});
		setIcon(newChatButton, 'plus');
		newChatButton.addEventListener('click', () => this.startNewChat());
	}

	private createChatBody(container: HTMLElement): void {
		this.chatContainer = container.createEl('div', { cls: 'ai-chat-body' });
		this.messagesContainer = this.chatContainer.createEl('div', { cls: 'ai-chat-messages' });
	}

	private createInputArea(container: HTMLElement): void {
		this.inputContainer = container.createEl('div', { cls: 'ai-chat-input-container' });

		this.createFileContextToggle();
		this.createInputField();
		this.createButtonContainer();
	}

	private createFileContextToggle(): void {
		this.fileContextHeader = this.inputContainer.createEl('div', { cls: 'ai-file-context-header' });
		const fileContextToggle = this.fileContextHeader.createEl('div', {
			cls: 'ai-file-context-toggle',
			attr: { 'aria-label': "Add current page's context to message" }
		});

		const fileIcon = fileContextToggle.createEl('span', { cls: 'ai-file-context-icon' });
		setIcon(fileIcon, 'file-text');

		const fileContextText = fileContextToggle.createEl('span', { cls: 'ai-file-context-text' });
		fileContextText.setText('Current page');

		fileContextToggle.toggleClass('active', this.includeFileContext);

		fileContextToggle.addEventListener('click', () => {
			this.includeFileContext = !this.includeFileContext;
			fileContextToggle.toggleClass('active', this.includeFileContext);
		});
	}

	private createInputField(): void {
		this.inputField = this.inputContainer.createEl('textarea', {
			cls: 'ai-chat-input',
			attr: {
				placeholder: 'Type your message (press Enter to send and Shift+Enter for a new line)...',
				rows: '3'
			}
		}) as HTMLTextAreaElement;

		this.inputField.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.handleButtonClick();
			}
		});

		this.inputField.addEventListener('input', () => this.autoResizeTextarea());
		this.autoResizeTextarea();
	}

	private createButtonContainer(): void {
		const buttonContainer = this.inputContainer.createEl('div', { cls: 'ai-chat-button-container' });

		this.loadingIndicator = buttonContainer.createEl('div', { cls: 'ai-loading-indicator hidden' });
		this.loadingIndicator.createEl('div', { cls: 'ai-loading-spinner' });

		this.sendButton = buttonContainer.createEl('button', {
			cls: 'ai-chat-send-button',
			attr: { 'aria-label': 'Send message' }
		}) as HTMLButtonElement;
		setIcon(this.sendButton, 'corner-down-right');
		this.sendButton.addEventListener('click', () => this.handleButtonClick());
	}

	// ==================== 상태 관리 ====================

	private setProcessingState(processing: boolean): void {
		this.isProcessing = processing;

		if (processing) {
			this.sendButton.empty();
			setIcon(this.sendButton, 'square');
			this.sendButton.setAttribute('aria-label', 'Cancel processing');
			this.sendButton.addClass('ai-cancel-button');
			this.loadingIndicator.removeClass('hidden');
			this.inputField.disabled = true;
		} else {
			this.sendButton.empty();
			setIcon(this.sendButton, 'corner-down-right');
			this.sendButton.setAttribute('aria-label', 'Send message');
			this.sendButton.removeClass('ai-cancel-button');
			this.loadingIndicator.addClass('hidden');
			this.inputField.disabled = false;
		}
	}

	// ==================== 메시지 처리 ====================

	private addMessage(message: ChatMessage): void {
		this.messages.push(message);
		this.renderer.renderMessage(message);
	}

	private handleButtonClick(): void {
		if (this.isProcessing) {
			this.cancelExecution();
		} else {
			this.handleSendMessage();
		}
	}

	private async handleSendMessage(): Promise<void> {
		const messageText = this.inputField.value.trim();
		if (!messageText || this.isProcessing) return;

		const finalMessage = this.buildFinalMessage(messageText);
		this.logDebugContext(messageText, finalMessage);

		const userMessage = MessageFactory.createUserInputMessage(messageText, this.currentSessionId);
		this.addMessage(userMessage);

		this.inputField.value = '';
		this.autoResizeTextarea();
		this.setProcessingState(true);

		await this.executeCommand(finalMessage);
		this.setProcessingState(false);
	}

	private buildFinalMessage(messageText: string): string {
		if (this.includeFileContext) {
			const currentFile = this.getCurrentFilePath();
			if (currentFile) {
				return `Current file context: ${currentFile}\n\n${messageText}`;
			}
		}
		return messageText;
	}

	private logDebugContext(originalMessage: string, finalMessage: string): void {
		if (!this.settings.debugContext) return;

		console.log('=== DEBUG CONTEXT START ===');
		console.log('API Key configured:', !!this.settings.apiKey);
		console.log('Model:', this.settings.model);
		console.log('New message context:', {
			originalMessage,
			finalMessage,
			includeFileContext: this.includeFileContext,
			currentFile: this.includeFileContext ? this.getCurrentFilePath() : null,
			sessionId: this.currentSessionId
		});
		console.log('=== DEBUG CONTEXT END ===');
	}

	private async executeCommand(prompt: string): Promise<void> {
		const vaultPath = (this.app.vault.adapter as { basePath?: string }).basePath || process.cwd();

		try {
			const sessionId = await this.agentService.execute({
				prompt,
				workingDirectory: vaultPath,
				sessionId: this.currentSessionId,
				onMessage: (message: ChatMessage) => {
					if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
						this.currentSessionId = message.session_id;
					}

					if (this.settings.debugContext) {
						console.log('=== STREAMING MESSAGE DEBUG ===');
						console.log('Received message:', message);
					}

					this.addMessage(message);
				},
				onError: (error: Error) => {
					const errorMessage = MessageFactory.createErrorMessage(error, this.currentSessionId);
					this.addMessage(errorMessage);
				},
				onComplete: () => {
					// Processing complete
				}
			});

			if (sessionId) {
				this.currentSessionId = sessionId;
			}
		} catch (error) {
			const errorMessage = MessageFactory.createErrorMessage(
				error instanceof Error ? error : new Error(String(error)),
				this.currentSessionId
			);
			this.addMessage(errorMessage);
		}
	}

	private cancelExecution(): void {
		this.agentService.cancel();
		this.setProcessingState(false);

		const cancelMessage = MessageFactory.createCancelMessage(this.currentSessionId);
		this.addMessage(cancelMessage);
	}

	// ==================== 유틸리티 ====================

	private autoResizeTextarea(): void {
		this.inputField.style.height = 'auto';

		const computedStyle = getComputedStyle(this.inputField);
		const minHeight = parseFloat(computedStyle.minHeight);

		const newHeight = Math.max(this.inputField.scrollHeight, minHeight);
		this.inputField.style.height = newHeight + 'px';

		const maxHeight = window.innerHeight * 0.5;
		if (newHeight > maxHeight) {
			this.inputField.style.height = maxHeight + 'px';
		}
	}

	private getCurrentFilePath(): string | null {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			const vaultPath = (this.app.vault.adapter as { basePath?: string }).basePath;
			return `${vaultPath}/${activeFile.path}`;
		}
		return null;
	}

	private startNewChat(): void {
		if (this.isProcessing) {
			this.cancelExecution();
		}

		this.currentSessionId = null;
		this.messages = [];
		this.renderer.clear();
	}

	private showExamples(): void {
		this.startNewChat();
		const exampleMessages = createExampleMessages();
		exampleMessages.forEach(message => this.addMessage(message));
	}

	private openSettings(): void {
		const app = this.app as unknown as {
			setting: { open: () => void; openTabById: (id: string) => void }
		};
		app.setting.open();
		app.setting.openTabById('obsidian-terminal-ai');
	}

	// ==================== 공개 메서드 ====================

	updateSettings(settings: AIChatSettings): void {
		this.settings = settings;
		this.agentService.updateSettings(settings);
	}
}
