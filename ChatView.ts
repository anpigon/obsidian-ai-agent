import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type { AIChatSettings, ChatMessage, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock, Message } from './types';
import { AgentService } from './AgentService';

export const VIEW_TYPE_AI_CHAT = 'ai-chat-view';

export class AIChatView extends ItemView {
	settings: AIChatSettings;
	messages: ChatMessage[] = [];
	chatContainer: HTMLElement;
	messagesContainer: HTMLElement;
	inputContainer: HTMLElement;
	inputField: HTMLTextAreaElement;
	currentSessionId: string | null = null;
	includeFileContext: boolean = true;
	fileContextHeader: HTMLElement;
	isProcessing: boolean = false;
	sendButton: HTMLButtonElement;
	loadingIndicator: HTMLElement;
	agentService: AgentService;
	currentAbortController: AbortController | null = null;

	constructor(leaf: WorkspaceLeaf, settings: AIChatSettings) {
		super(leaf);
		this.settings = settings;
		this.agentService = new AgentService(settings);
	}

	getViewType() {
		return VIEW_TYPE_AI_CHAT;
	}

	getDisplayText() {
		return 'AI Chat';
	}

	getIcon() {
		return 'sparkles';
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('ai-chat-container');

		this.createChatInterface(container);
	}

	createChatInterface(container: HTMLElement) {
		// Add header with new chat button
		const headerEl = container.createEl('div', { cls: 'ai-chat-header' });

		headerEl.createEl('div', {
			text: 'AI Agent',
			cls: 'ai-chat-title'
		});

		const buttonGroupEl = headerEl.createEl('div', { cls: 'ai-header-buttons' });

		const examplesButton = buttonGroupEl.createEl('button', {
			text: 'Examples',
			cls: 'ai-examples-button'
		});

		const settingsButton = buttonGroupEl.createEl('button', {
			cls: 'ai-settings-button',
			attr: { 'aria-label': 'Plugin settings' }
		});
		setIcon(settingsButton, 'settings');

		const newChatButton = buttonGroupEl.createEl('button', {
			cls: 'ai-new-chat-button',
			attr: { 'aria-label': 'New chat' }
		});
		setIcon(newChatButton, 'plus');

		newChatButton.addEventListener('click', () => this.startNewChat());
		settingsButton.addEventListener('click', () => this.openSettings());
		examplesButton.addEventListener('click', () => {
			this.startNewChat();
			this.addExampleMessages();
		});

		this.chatContainer = container.createEl('div', { cls: 'ai-chat-body' });

		this.messagesContainer = this.chatContainer.createEl('div', { cls: 'ai-chat-messages' });

		this.inputContainer = container.createEl('div', { cls: 'ai-chat-input-container' });

		// Add file context header above the input field
		this.fileContextHeader = this.inputContainer.createEl('div', { cls: 'ai-file-context-header' });
		const fileContextToggle = this.fileContextHeader.createEl('div', {
			cls: 'ai-file-context-toggle',
			attr: { 'aria-label': 'Add current page\'s context to message' }
		});

		const fileIcon = fileContextToggle.createEl('span', { cls: 'ai-file-context-icon' });
		setIcon(fileIcon, 'file-text');

		const fileContextText = fileContextToggle.createEl('span', { cls: 'ai-file-context-text' });
		this.updateFileContextDisplay(fileContextText);

		// Set initial active state based on includeFileContext
		fileContextToggle.toggleClass('active', this.includeFileContext);

		fileContextToggle.addEventListener('click', () => {
			this.includeFileContext = !this.includeFileContext;
			fileContextToggle.toggleClass('active', this.includeFileContext);
			this.updateFileContextDisplay(fileContextText);
		});

		this.inputField = this.inputContainer.createEl('textarea', {
			cls: 'ai-chat-input',
			attr: {
				placeholder: 'Type your message (press Enter to send and Shift+Enter for a new line)...',
				rows: '3'
			}
		}) as HTMLTextAreaElement;

		const buttonContainer = this.inputContainer.createEl('div', { cls: 'ai-chat-button-container' });

		// Create loading indicator (initially hidden)
		this.loadingIndicator = buttonContainer.createEl('div', { cls: 'ai-loading-indicator hidden' });
		this.loadingIndicator.createEl('div', { cls: 'ai-loading-spinner' });

		this.sendButton = buttonContainer.createEl('button', {
			cls: 'ai-chat-send-button',
			attr: { 'aria-label': 'Send message' }
		}) as HTMLButtonElement;
		setIcon(this.sendButton, 'corner-down-right');

		this.sendButton.addEventListener('click', () => this.handleButtonClick());
		this.inputField.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.handleButtonClick();
			}
		});

		// Auto-resize functionality
		this.inputField.addEventListener('input', () => {
			this.autoResizeTextarea();
		});

		// Set initial height
		this.autoResizeTextarea();
	}

	autoResizeTextarea() {
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

	addMessage(message: ChatMessage) {
		this.messages.push(message);
		this.renderMessage(message);
	}

	renderMessage(chatMessage: ChatMessage) {
		try {
			let cssClass = 'ai-chat-message';
			if (chatMessage.isUserInput) {
				cssClass += ' ai-chat-message-user';
			} else if (chatMessage.type === 'result') {
				cssClass += ' ai-chat-message-final-response';
			} else {
				cssClass += ' ai-chat-message-assistant';
			}

			const messageEl = this.messagesContainer.createEl('div', { cls: cssClass });

			if (chatMessage.type === 'user' && !chatMessage.isUserInput) {
				this.renderThinkingMessage(messageEl, chatMessage);
			} else if (chatMessage.type === 'assistant') {
				this.renderAssistantThought(messageEl, chatMessage);
			} else if (chatMessage.type === 'result') {
				this.renderFinalResponse(messageEl, chatMessage);
			} else {
				const contentEl = messageEl.createEl('div', { cls: 'ai-message-content' });
				this.renderMessageContent(contentEl, chatMessage);
			}

			if (chatMessage.timestamp && (chatMessage.isUserInput || chatMessage.type === 'result')) {
				const timestampEl = messageEl.createEl('div', { cls: 'ai-message-timestamp' });
				timestampEl.setText(chatMessage.timestamp.toLocaleTimeString());
			}

			requestAnimationFrame(() => {
				this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
			});
		} catch (error) {
			console.error('Error rendering message:', error, chatMessage);
		}
	}

	getDisplayName(type: string, isUserInput = false): string {
		switch (type) {
			case 'user': return isUserInput ? 'You' : 'Claude';
			case 'assistant': return 'Claude';
			case 'system': return 'System';
			case 'result': return 'Claude';
			default: return type;
		}
	}

	renderMessageContent(container: HTMLElement, chatMessage: ChatMessage) {
		try {
			if (chatMessage.message?.content) {
				chatMessage.message.content.forEach((content: ContentBlock) => {
					if (content.type === 'text') {
						const textEl = container.createEl('div', { cls: 'ai-message-text' });
						textEl.innerHTML = this.formatText((content as TextBlock).text);
					} else if (content.type === 'tool_use') {
						const toolContent = content as ToolUseBlock;
						if (toolContent.name === 'TodoWrite') {
							this.renderTodoCard(container, toolContent);
						} else {
							this.renderCollapsibleTool(container, toolContent);
						}
					} else if (content.type === 'tool_result') {
						const resultEl = container.createEl('div', { cls: 'ai-tool-result' });
						const pre = resultEl.createEl('pre');
						const resultContent = (content as ToolResultBlock).content;
						const resultText = resultContent || 'No content';
						pre.createEl('code', { text: typeof resultText === 'string' ? resultText : JSON.stringify(resultText, null, 2) });
					}
				});
			} else if (chatMessage.result) {
				const resultEl = container.createEl('div', { cls: 'ai-final-result' });
				resultEl.innerHTML = this.formatText(chatMessage.result);
			} else if (chatMessage.subtype === 'init') {
				container.createEl('div', {
					text: 'Cooking...',
					cls: 'ai-system-init'
				});
			} else if (chatMessage.subtype) {
				container.createEl('div', { text: `System: ${chatMessage.subtype}` });
			}
		} catch (error) {
			console.warn('Error rendering message content:', error, chatMessage);
			container.createEl('div', {
				text: 'Error rendering message content',
				cls: 'ai-error-message'
			});
		}
	}

	renderTodoCard(container: HTMLElement, content: ToolUseBlock) {
		const cardEl = container.createEl('div', { cls: 'ai-todo-card' });
		const headerEl = cardEl.createEl('div', { cls: 'ai-todo-header' });
		headerEl.createEl('span', { text: 'Tasks', cls: 'ai-todo-title' });

		const input = content.input as { todos?: Array<{ status: string; content: string }> };
		if (input?.todos) {
			const todosEl = cardEl.createEl('div', { cls: 'ai-todos-list' });
			input.todos.forEach((todo) => {
				const todoEl = todosEl.createEl('div', { cls: 'ai-todo-item' });

				const iconEl = todoEl.createEl('span', { cls: 'ai-todo-status' });
				if (todo.status === 'completed') {
					setIcon(iconEl, 'circle-check');
				} else if (todo.status === 'in_progress') {
					setIcon(iconEl, 'circle-ellipsis');
				} else {
					setIcon(iconEl, 'circle');
				}

				todoEl.createEl('span', { text: todo.content, cls: 'ai-todo-content' });
			});
		}
	}

	renderCollapsibleTool(container: HTMLElement, content: ToolUseBlock) {
		const toolEl = container.createEl('div', { cls: 'ai-tool-collapsible' });
		const headerEl = toolEl.createEl('div', { cls: 'ai-tool-header clickable' });

		headerEl.createEl('span', { text: `Using tool: ${content.name || 'Unknown'}`, cls: 'ai-tool-name' });

		const contentEl = toolEl.createEl('div', { cls: 'ai-tool-content collapsed' });
		if (content.input) {
			const pre = contentEl.createEl('pre');
			pre.createEl('code', { text: JSON.stringify(content.input, null, 2) });
		}

		headerEl.addEventListener('click', () => {
			if (contentEl.hasClass('collapsed')) {
				contentEl.removeClass('collapsed');
			} else {
				contentEl.addClass('collapsed');
			}
		});
	}

	renderThinkingMessage(messageEl: HTMLElement, chatMessage: ChatMessage) {
		const hasToolResults = chatMessage.message?.content?.some(content => content.type === 'tool_result');
		const headerText = hasToolResults ? 'Tool result' : 'Thinking...';

		const headerEl = messageEl.createEl('div', { cls: 'ai-thinking-header clickable' });
		headerEl.createEl('span', { text: headerText, cls: 'ai-thinking-label' });

		const contentEl = messageEl.createEl('div', { cls: 'ai-thinking-content collapsed' });
		this.renderMessageContent(contentEl, chatMessage);

		headerEl.addEventListener('click', () => {
			if (contentEl.hasClass('collapsed')) {
				contentEl.removeClass('collapsed');
			} else {
				contentEl.addClass('collapsed');
			}
		});
	}

	renderAssistantThought(messageEl: HTMLElement, chatMessage: ChatMessage) {
		const contentEl = messageEl.createEl('div', { cls: 'ai-message-content ai-self-thought' });
		this.renderMessageContent(contentEl, chatMessage);
	}

	renderFinalResponse(messageEl: HTMLElement, chatMessage: ChatMessage) {
		const contentEl = messageEl.createEl('div', { cls: 'ai-message-content ai-final-response' });
		this.renderMessageContent(contentEl, chatMessage);
	}

	formatText(text: string): string {
		return text
			.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.*?)\*/g, '<em>$1</em>')
			.replace(/`(.*?)`/g, '<code>$1</code>')
			.replace(/\n/g, '<br>');
	}

	getCurrentFilePath(): string | null {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			const vaultPath = (this.app.vault.adapter as { basePath?: string }).basePath;
			return `${vaultPath}/${activeFile.path}`;
		}
		return null;
	}

	updateFileContextDisplay(textElement: HTMLElement) {
		textElement.setText('Current page');
	}

	handleButtonClick() {
		if (this.isProcessing) {
			this.cancelExecution();
		} else {
			this.handleSendMessage();
		}
	}

	cancelExecution() {
		this.agentService.cancel();
		this.setProcessingState(false);

		const cancelMessage: ChatMessage = {
			type: 'system',
			result: 'Message execution cancelled',
			session_id: this.currentSessionId || `session-${Date.now()}`,
			uuid: `cancel-${Date.now()}`,
			timestamp: new Date()
		};
		this.addMessage(cancelMessage);
	}

	setProcessingState(processing: boolean) {
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

	async handleSendMessage() {
		const messageText = this.inputField.value.trim();
		if (messageText && !this.isProcessing) {
			let finalMessage = messageText;
			if (this.includeFileContext) {
				const currentFile = this.getCurrentFilePath();
				if (currentFile) {
					finalMessage = `Current file context: ${currentFile}\n\n${messageText}`;
				}
			}

			if (this.settings.debugContext) {
				console.log('=== DEBUG CONTEXT START ===');
				console.log('API Key configured:', !!this.settings.apiKey);
				console.log('Model:', this.settings.model);
				console.log('New message context:', {
					originalMessage: messageText,
					finalMessage: finalMessage,
					includeFileContext: this.includeFileContext,
					currentFile: this.includeFileContext ? this.getCurrentFilePath() : null,
					sessionId: this.currentSessionId
				});
				console.log('=== DEBUG CONTEXT END ===');
			}

			const userMessage: ChatMessage = {
				type: 'user',
				message: {
					id: `msg-${Date.now()}`,
					role: 'user',
					content: [{ type: 'text', text: messageText }]
				},
				session_id: `session-${Date.now()}`,
				uuid: `user-${Date.now()}`,
				timestamp: new Date(),
				isUserInput: true
			};

			this.addMessage(userMessage);
			this.inputField.value = '';
			this.autoResizeTextarea();
			this.setProcessingState(true);
			await this.executeCommand(finalMessage);
			this.setProcessingState(false);
		}
	}

	async executeCommand(prompt: string) {
		const vaultPath = (this.app.vault.adapter as { basePath?: string }).basePath || process.cwd();

		try {
			const sessionId = await this.agentService.execute({
				prompt,
				workingDirectory: vaultPath,
				sessionId: this.currentSessionId,
				onMessage: (message: ChatMessage) => {
					// Update session ID from init message
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
					const errorMessage: ChatMessage = {
						type: 'system',
						result: `Error: ${error.message}`,
						session_id: this.currentSessionId || `session-${Date.now()}`,
						uuid: `error-${Date.now()}`,
						timestamp: new Date()
					};
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
			const errorMessage: ChatMessage = {
				type: 'system',
				result: `Failed to execute command: ${error instanceof Error ? error.message : String(error)}`,
				session_id: this.currentSessionId || `session-${Date.now()}`,
				uuid: `error-${Date.now()}`,
				timestamp: new Date()
			};
			this.addMessage(errorMessage);
		}
	}

	startNewChat() {
		if (this.isProcessing) {
			this.cancelExecution();
		}

		this.currentSessionId = null;
		this.messages = [];
		this.messagesContainer.empty();
	}

	addExampleMessages() {
		const exampleSessionId = "4e639301-8fe0-4d70-a47e-db0b0605effa";

		const userMessage: ChatMessage = {
			type: 'user',
			message: {
				id: 'msg-user-001',
				role: 'user',
				content: [{ type: 'text', text: 'Could you make a plan for finding the date, execute the necessary steps, and then tell me the current datetime?' }]
			},
			session_id: exampleSessionId,
			uuid: 'user-example-001',
			timestamp: new Date(),
			isUserInput: true
		};
		this.addMessage(userMessage);

		const systemInitMessage: ChatMessage = {
			type: 'system',
			subtype: 'init',
			session_id: exampleSessionId,
			uuid: 'system-init-001',
			timestamp: new Date()
		};
		this.addMessage(systemInitMessage);

		const assistantTextMessage: ChatMessage = {
			type: 'assistant',
			message: {
				id: 'msg_01QKejYVNzKEvJiLdgsjDnX8',
				role: 'assistant',
				content: [{ type: 'text', text: "I'll help you find the current datetime. Let me create a plan and execute it." }],
				model: 'claude-sonnet-4-20250514',
				usage: {
					input_tokens: 4,
					output_tokens: 7,
					service_tier: 'standard'
				}
			},
			session_id: exampleSessionId,
			uuid: 'assistant-text-001',
			timestamp: new Date()
		};
		this.addMessage(assistantTextMessage);

		const todoToolMessage: ChatMessage = {
			type: 'assistant',
			message: {
				id: 'msg_01TodoExample',
				role: 'assistant',
				content: [{
					type: 'tool_use',
					id: 'toolu_01XraaAU5TbdkpPhUq9Gepry',
					name: 'TodoWrite',
					input: {
						todos: [
							{content: 'Get current datetime using system command', status: 'pending', activeForm: 'Getting current datetime using system command'},
							{content: 'Format and display the result', status: 'pending', activeForm: 'Formatting and displaying the result'}
						]
					}
				}],
				model: 'claude-sonnet-4-20250514'
			},
			session_id: exampleSessionId,
			uuid: 'todo-tool-001',
			timestamp: new Date()
		};
		this.addMessage(todoToolMessage);

		const toolResultMessage: ChatMessage = {
			type: 'user',
			message: {
				id: 'msg-tool-result-001',
				role: 'user',
				content: [{
					tool_use_id: 'toolu_01XraaAU5TbdkpPhUq9Gepry',
					type: 'tool_result',
					content: 'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable'
				}]
			},
			session_id: exampleSessionId,
			uuid: 'tool-result-001',
			timestamp: new Date()
		};
		this.addMessage(toolResultMessage);

		const bashToolMessage: ChatMessage = {
			type: 'assistant',
			message: {
				id: 'msg_01BashExample',
				role: 'assistant',
				content: [{
					type: 'tool_use',
					id: 'toolu_0145mNNv4HW3V7LUTNwitdwd',
					name: 'Bash',
					input: {
						command: 'date',
						description: 'Get current date and time'
					}
				}],
				model: 'claude-sonnet-4-20250514'
			},
			session_id: exampleSessionId,
			uuid: 'bash-tool-001',
			timestamp: new Date()
		};
		this.addMessage(bashToolMessage);

		const bashResultMessage: ChatMessage = {
			type: 'user',
			message: {
				id: 'msg-bash-result-001',
				role: 'user',
				content: [{
					tool_use_id: 'toolu_0145mNNv4HW3V7LUTNwitdwd',
					type: 'tool_result',
					content: 'Wed 27 Aug 2025 09:54:15 EDT',
					is_error: false
				}]
			},
			session_id: exampleSessionId,
			uuid: 'bash-result-001',
			timestamp: new Date()
		};
		this.addMessage(bashResultMessage);

		const todoUpdateMessage: ChatMessage = {
			type: 'assistant',
			message: {
				id: 'msg_01TodoUpdate',
				role: 'assistant',
				content: [{
					type: 'tool_use',
					id: 'toolu_01TodoComplete',
					name: 'TodoWrite',
					input: {
						todos: [
							{content: 'Get current datetime using system command', status: 'completed', activeForm: 'Getting current datetime using system command'},
							{content: 'Format and display the result', status: 'in_progress', activeForm: 'Formatting and displaying the result'}
						]
					}
				}],
				model: 'claude-sonnet-4-20250514'
			},
			session_id: exampleSessionId,
			uuid: 'todo-update-001',
			timestamp: new Date()
		};
		this.addMessage(todoUpdateMessage);

		const finalResultMessage: ChatMessage = {
			type: 'result',
			result: 'The current datetime is: **Wednesday, August 27, 2025 at 9:54:15 AM EDT**',
			session_id: exampleSessionId,
			uuid: 'final-result-001',
			timestamp: new Date()
		};
		this.addMessage(finalResultMessage);
	}

	openSettings() {
		(this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.open();
		(this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.openTabById('obsidian-terminal-ai');
	}

	async onClose() {
		if (this.isProcessing) {
			this.agentService.cancel();
		}
	}

	updateSettings(settings: AIChatSettings) {
		this.settings = settings;
		this.agentService.updateSettings(settings);
	}
}
