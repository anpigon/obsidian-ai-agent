import { Plugin, WorkspaceLeaf, MarkdownView } from 'obsidian';
import { AIChatView, VIEW_TYPE_AI_CHAT } from './ChatView';
import { AIChatSettingTab } from './SettingsTab';
import { AIChatSettings, DEFAULT_SETTINGS } from './types';

// 빠른 프롬프트 타입
interface QuickPrompt {
	id: string;
	name: string;
	prompt: string;
	icon?: string;
}

export default class AIChatPlugin extends Plugin {
	settings: AIChatSettings;

	// Phase 1-D: 빠른 프롬프트 정의
	private quickPrompts: QuickPrompt[] = [
		{ id: 'summarize', name: 'AI: Summarize document', prompt: 'Please summarize this document concisely.', icon: 'file-text' },
		{ id: 'explain', name: 'AI: Explain selection', prompt: 'Please explain the selected text in detail.', icon: 'help-circle' },
		{ id: 'improve', name: 'AI: Improve writing', prompt: 'Please improve the writing style and fix any grammar or spelling errors.', icon: 'edit' },
		{ id: 'translate-ko', name: 'AI: Translate to Korean', prompt: 'Please translate this text to Korean.', icon: 'languages' },
		{ id: 'translate-en', name: 'AI: Translate to English', prompt: 'Please translate this text to English.', icon: 'languages' },
		{ id: 'code-review', name: 'AI: Review code', prompt: 'Please review this code and suggest improvements.', icon: 'code' },
	];

	async onload() {
		await this.loadSettings();

		// Register the custom view
		this.registerView(
			VIEW_TYPE_AI_CHAT,
			(leaf) => new AIChatView(leaf, this.settings)
		);

		// Open the view in the right sidebar by default
		if (this.app.workspace.layoutReady) {
			await this.activateView();
		} else {
			this.app.workspace.onLayoutReady(async () => {
				await this.activateView();
			});
		}

		// Phase 1-D: 명령어 팔레트 통합
		this.registerCommands();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AIChatSettingTab(this.app, this));
	}

	// Phase 1-D: 명령어 등록
	private registerCommands(): void {
		// 기본 명령어
		this.addCommand({
			id: 'open-ai-chat',
			name: 'Open AI Chat',
			callback: () => this.activateView()
		});

		this.addCommand({
			id: 'new-chat',
			name: 'Start new chat',
			callback: () => this.startNewChat()
		});

		this.addCommand({
			id: 'save-conversation',
			name: 'Save current conversation',
			callback: () => this.saveCurrentConversation()
		});

		// 빠른 프롬프트 명령어 등록
		for (const prompt of this.quickPrompts) {
			this.addCommand({
				id: `quick-${prompt.id}`,
				name: prompt.name,
				editorCallback: (editor) => {
					const selection = editor.getSelection();
					this.sendQuickPrompt(prompt.prompt, selection);
				}
			});
		}
	}

	// Phase 1-D: 빠른 프롬프트 전송
	private async sendQuickPrompt(prompt: string, selection?: string): Promise<void> {
		await this.activateView();

		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AI_CHAT);
		if (leaves.length > 0) {
			const view = leaves[0].view as AIChatView;
			const fullPrompt = selection
				? `${prompt}\n\nText:\n${selection}`
				: prompt;
			view.sendMessage(fullPrompt);
		}
	}

	// Phase 1-D: 새 채팅 시작
	private startNewChat(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AI_CHAT);
		if (leaves.length > 0) {
			const view = leaves[0].view as AIChatView;
			view.startNewChatFromCommand();
		}
	}

	// Phase 2-B: 현재 대화 저장
	private saveCurrentConversation(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AI_CHAT);
		if (leaves.length > 0) {
			const view = leaves[0].view as AIChatView;
			view.saveConversation();
		}
	}

	onunload() {
		// Detach leaves with our view type when unloading
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_AI_CHAT);
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_AI_CHAT);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use it
			leaf = leaves[0];
		} else {
			// Our view doesn't exist, create a new leaf in the right sidebar
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_AI_CHAT, active: true });
			}
		}

		// Reveal the leaf in case it's hidden
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
