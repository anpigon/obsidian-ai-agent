import { App, PluginSettingTab, Setting } from 'obsidian';
import type AIChatPlugin from './main';
import { AVAILABLE_MODELS } from './types';

export class AIChatSettingTab extends PluginSettingTab {
	plugin: AIChatPlugin;

	constructor(app: App, plugin: AIChatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'AI Agent Settings' });

		// API Key setting
		new Setting(containerEl)
			.setName('Anthropic API Key')
			.setDesc('Your Anthropic API key for Claude. Get one at console.anthropic.com')
			.addText(text => text
				.setPlaceholder('sk-ant-...')
				.setValue(this.plugin.settings.apiKey || '')
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
					this.updateViews();
				}));

		// Model selection
		new Setting(containerEl)
			.setName('Model')
			.setDesc('Select the Claude model to use')
			.addDropdown(dropdown => {
				AVAILABLE_MODELS.forEach(model => {
					dropdown.addOption(model.value, model.label);
				});
				dropdown
					.setValue(this.plugin.settings.model || 'claude-sonnet-4-20250514')
					.onChange(async (value) => {
						this.plugin.settings.model = value;
						await this.plugin.saveSettings();
						this.updateViews();
					});
			});

		// Debug context
		new Setting(containerEl)
			.setName('Debug mode')
			.setDesc('Enable debug logging for troubleshooting (logs to browser console)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debugContext || false)
				.onChange(async (value) => {
					this.plugin.settings.debugContext = value;
					await this.plugin.saveSettings();
					this.updateViews();
				}));

		// Info section
		containerEl.createEl('h3', { text: 'About' });
		const infoEl = containerEl.createEl('div', { cls: 'ai-settings-info' });
		infoEl.createEl('p', {
			text: 'This plugin uses the Claude Agent SDK to provide AI-powered assistance directly within Obsidian.'
		});
		infoEl.createEl('p', {
			text: 'The agent can read files, execute commands, and help with various tasks in your vault.'
		});
	}

	private updateViews(): void {
		// Update all open chat views with new settings
		this.app.workspace.getLeavesOfType('ai-chat-view').forEach(leaf => {
			const view = leaf.view;
			if (view && 'updateSettings' in view && typeof view.updateSettings === 'function') {
				(view as { updateSettings: (settings: typeof this.plugin.settings) => void }).updateSettings(this.plugin.settings);
			}
		});
	}
}
