import { ItemView, WorkspaceLeaf, setIcon, MarkdownView, TFile } from 'obsidian';
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

		this.createQuickActions();
		this.createFileContextToggle();
		this.createInputField();
		this.createButtonContainer();
	}

	// Phase 2-F: 빠른 액션 버튼 생성
	private createQuickActions(): void {
		const quickActionsEl = this.inputContainer.createEl('div', { cls: 'ai-quick-actions' });

		const actions = [
			{ icon: 'file-text', label: 'Summarize', prompt: 'Please summarize this document concisely.' },
			{ icon: 'edit', label: 'Improve', prompt: 'Please improve the writing style and fix any errors.' },
			{ icon: 'search', label: 'Analyze', prompt: 'Please analyze this document and provide insights.' },
			{ icon: 'languages', label: 'Translate', prompt: 'Please translate this text to English. If already in English, translate to Korean.' },
		];

		for (const action of actions) {
			const button = quickActionsEl.createEl('button', {
				cls: 'ai-quick-action-button',
				attr: { 'aria-label': action.label }
			});

			const iconEl = button.createEl('span', { cls: 'ai-quick-action-icon' });
			setIcon(iconEl, action.icon);

			button.createEl('span', { text: action.label, cls: 'ai-quick-action-label' });

			button.addEventListener('click', () => {
				if (!this.isProcessing) {
					this.sendMessage(action.prompt);
				}
			});
		}
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

		const finalMessage = await this.buildFinalMessage(messageText);
		this.logDebugContext(messageText, finalMessage);

		const userMessage = MessageFactory.createUserInputMessage(messageText, this.currentSessionId);
		this.addMessage(userMessage);

		this.inputField.value = '';
		this.autoResizeTextarea();
		this.setProcessingState(true);

		await this.executeCommand(finalMessage);
		this.setProcessingState(false);
	}

	private async buildFinalMessage(messageText: string): Promise<string> {
		if (!this.includeFileContext) {
			return messageText;
		}

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return messageText;
		}

		const contextParts: string[] = [];
		const vaultPath = (this.app.vault.adapter as { basePath?: string }).basePath;
		const filePath = `${vaultPath}/${activeFile.path}`;

		// 파일 경로 추가
		contextParts.push(`Current file: ${filePath}`);

		// Phase 1-A: 파일 내용 컨텍스트
		if (this.settings.includeFileContent) {
			try {
				// 선택 영역이 있는 경우 선택 영역만 포함
				if (this.settings.includeSelection) {
					const selection = this.getActiveSelection();
					if (selection) {
						contextParts.push(`\nSelected text:\n\`\`\`\n${selection}\n\`\`\``);
					} else {
						// 선택 영역이 없으면 전체 파일 내용 포함
						const content = await this.getFileContent(activeFile);
						if (content) {
							contextParts.push(`\nFile content:\n\`\`\`\n${content}\n\`\`\``);
						}
					}
				} else {
					// 선택 영역 옵션이 비활성화된 경우 전체 파일 내용 포함
					const content = await this.getFileContent(activeFile);
					if (content) {
						contextParts.push(`\nFile content:\n\`\`\`\n${content}\n\`\`\``);
					}
				}
			} catch (error) {
				console.warn('Failed to read file content:', error);
			}
		}

		return `${contextParts.join('\n')}\n\n${messageText}`;
	}

	private getActiveSelection(): string | null {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (markdownView?.editor) {
			const selection = markdownView.editor.getSelection();
			if (selection && selection.trim().length > 0) {
				return selection;
			}
		}

		return null;
	}

	private async getFileContent(file: TFile): Promise<string | null> {
		try {
			const content = await this.app.vault.read(file);
			const maxLength = this.settings.maxContentLength || 10000;

			if (content.length > maxLength) {
				return content.substring(0, maxLength) + `\n\n... (truncated, ${content.length - maxLength} characters omitted)`;
			}

			return content;
		} catch (error) {
			console.warn('Failed to read file:', error);
			return null;
		}
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

	// Phase 1-D: 외부에서 메시지 전송
	async sendMessage(message: string): Promise<void> {
		if (this.isProcessing) return;

		this.inputField.value = message;
		await this.handleSendMessage();
	}

	// Phase 1-D: 외부에서 새 채팅 시작
	startNewChatFromCommand(): void {
		this.startNewChat();
	}

	// Phase 2-B: 대화 저장
	async saveConversation(): Promise<void> {
		if (this.messages.length === 0) {
			return;
		}

		const savePath = this.settings.conversationSavePath || 'AI-Chats';
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const fileName = `${savePath}/chat-${timestamp}.md`;

		// 폴더 생성
		try {
			const folder = this.app.vault.getAbstractFileByPath(savePath);
			if (!folder) {
				await this.app.vault.createFolder(savePath);
			}
		} catch {
			// 폴더가 이미 존재하면 무시
		}

		// 마크다운 생성
		const markdown = this.generateMarkdown();

		// 파일 저장
		try {
			await this.app.vault.create(fileName, markdown);
			console.log(`Conversation saved to ${fileName}`);
		} catch (error) {
			console.error('Failed to save conversation:', error);
		}
	}

	// Phase 2-B: 마크다운 생성
	private generateMarkdown(): string {
		const lines: string[] = [];
		const now = new Date();

		// 프론트매터
		lines.push('---');
		lines.push(`date: ${now.toISOString().slice(0, 10)}`);
		lines.push(`time: ${now.toLocaleTimeString()}`);
		lines.push(`model: ${this.settings.model || 'unknown'}`);
		if (this.currentSessionId) {
			lines.push(`session_id: ${this.currentSessionId}`);
		}
		lines.push('---');
		lines.push('');
		lines.push(`# AI Chat - ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`);
		lines.push('');

		// 메시지 변환
		for (const msg of this.messages) {
			if (msg.type === 'user' && 'isUserInput' in msg && msg.isUserInput) {
				lines.push('## User');
				const content = msg.message.content;
				for (const block of content) {
					if (block.type === 'text') {
						lines.push(block.text);
					}
				}
				lines.push('');
			} else if (msg.type === 'assistant') {
				lines.push('## Assistant');
				const content = msg.message.content;
				for (const block of content) {
					if (block.type === 'text') {
						lines.push(block.text);
					} else if (block.type === 'tool_use') {
						lines.push(`> Using tool: ${block.name}`);
					}
				}
				lines.push('');
			} else if (msg.type === 'result' && msg.result) {
				lines.push('## Result');
				lines.push(msg.result);
				lines.push('');
				if (msg.duration_ms) {
					lines.push(`*Duration: ${(msg.duration_ms / 1000).toFixed(2)}s*`);
				}
				lines.push('');
			}
		}

		return lines.join('\n');
	}
}
