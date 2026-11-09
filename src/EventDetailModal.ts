import { App, Modal, MarkdownRenderer, TextAreaComponent, ButtonComponent, Component } from 'obsidian';
import { type Event as MwEvent } from '@markwhen/parser';
import { eventSourceRange } from './utils/eventSourceRange';

/**
 * EventDetailModal - Modal for viewing and editing Markwhen event details
 * Adapted for @markwhen/parser 0.10.15 API (editFromTimeline branch)
 */
export class EventDetailModal extends Modal {
	event: MwEvent;
	sourceData: string;
	eventTitle: string;
	eventDescription: string;
	onSave: (newDescription: string) => void;
	isEditing: boolean = false;
	isExpanded: boolean = false;
	isSplitView: boolean = true;
	textArea: TextAreaComponent | null = null;
	renderComponent: Component | null = null;

	constructor(
		app: App,
		event: MwEvent,
		sourceData: string,
		onSave: (newDescription: string) => void
	) {
		super(app);
		this.event = event;
		this.sourceData = sourceData;
		this.onSave = onSave;

		// Extract title and description from source
		const { title, description } = this.parseEventFromSource();
		this.eventTitle = title;
		this.eventDescription = description;
	}

	/**
	 * Parse event title and description from source text
	 * Old parser API doesn't provide these directly
	 */
	parseEventFromSource(): { title: string; description: string } {
		const { title, description } = eventSourceRange(this.sourceData, this.event);
		return { title, description };
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('markwhen-event-detail-modal');

		// Modal title
		const titleEl = contentEl.createEl('h2', { text: 'Event Details' });
		titleEl.addClass('markwhen-modal-title');

		// Event title
		const eventTitleEl = contentEl.createEl('h3', { text: this.eventTitle });
		eventTitleEl.addClass('markwhen-event-title');

		// Date range display
		const dateRangeEl = contentEl.createEl('div');
		dateRangeEl.addClass('markwhen-date-range');
		dateRangeEl.createEl('strong', { text: 'Date: ' });
		dateRangeEl.createSpan({ text: this.formatDateRange() });

		// Tags display
		const event = this.event as any;
		if (event.tags && event.tags.length > 0) {
			const tagsEl = contentEl.createEl('div');
			tagsEl.addClass('markwhen-tags');
			tagsEl.createEl('strong', { text: 'Tags: ' });
			const tagsContainer = tagsEl.createSpan();
			event.tags.forEach((tag: string, index: number) => {
				const tagSpan = tagsContainer.createSpan({ text: '#' + tag });
				tagSpan.addClass('markwhen-tag');
				if (index < event.tags.length - 1) {
					tagsContainer.createSpan({ text: ' ' });
				}
			});
		}

		// Description section
		const descriptionContainer = contentEl.createDiv();
		descriptionContainer.addClass('markwhen-description-container');

		// Buttons container
		const buttonContainer = contentEl.createDiv();
		buttonContainer.addClass('markwhen-button-container');

		const expandButton = new ButtonComponent(buttonContainer);
		expandButton.setButtonText('Expand')
			.onClick(() => {
				this.toggleExpand();
				expandButton.setButtonText(this.isExpanded ? 'Shrink' : 'Expand');
			});

		const editButton = new ButtonComponent(buttonContainer);
		editButton.setButtonText('Edit')
			.onClick(() => {
				this.toggleEditMode(descriptionContainer);
			});

		const closeButton = new ButtonComponent(buttonContainer);
		closeButton.setButtonText('Close')
			.onClick(() => {
				this.close();
			});

		// Initial render in view mode
		this.renderViewMode(descriptionContainer);
	}

	renderViewMode(container: HTMLElement) {
		container.empty();
		this.isEditing = false;

		if (this.renderComponent) {
			this.renderComponent.unload();
			this.renderComponent = null;
		}

		const viewContainer = container.createDiv();
		viewContainer.addClass('markwhen-description-view');

		if (this.eventDescription && this.eventDescription.trim()) {
			this.renderComponent = new Component();
			this.renderComponent.load();

			MarkdownRenderer.render(
				this.app,
				this.eventDescription,
				viewContainer,
				'',
				this.renderComponent
			);
		} else {
			viewContainer.createEl('p', {
				text: 'No description available.',
				cls: 'markwhen-no-description'
			});
		}
	}

	toggleExpand() {
		this.isExpanded = !this.isExpanded;
		if (this.isExpanded) {
			this.modalEl.addClass('markwhen-modal-expanded');
		} else {
			this.modalEl.removeClass('markwhen-modal-expanded');
		}
	}

	renderEditMode(container: HTMLElement) {
		container.empty();
		this.isEditing = true;

		if (this.renderComponent) {
			this.renderComponent.unload();
			this.renderComponent = null;
		}

		const editContainer = container.createDiv();
		editContainer.addClass('markwhen-description-edit');

		// Mode toggle buttons
		const modeToggle = editContainer.createDiv();
		modeToggle.addClass('markwhen-mode-toggle');

		const splitViewBtn = new ButtonComponent(modeToggle);
		splitViewBtn.setButtonText('Split View')
			.onClick(() => {
				if (!this.isSplitView) {
					this.isSplitView = true;
					this.renderEditMode(container);
				}
			});
		if (this.isSplitView) splitViewBtn.setCta();

		const sourceOnlyBtn = new ButtonComponent(modeToggle);
		sourceOnlyBtn.setButtonText('Source Only')
			.onClick(() => {
				if (this.isSplitView) {
					this.isSplitView = false;
					this.renderEditMode(container);
				}
			});
		if (!this.isSplitView) sourceOnlyBtn.setCta();

		if (this.isSplitView) {
			this.renderSplitView(editContainer);
		} else {
			this.renderSourceOnly(editContainer);
		}

		// Save and Cancel buttons
		const actionButtons = editContainer.createDiv();
		actionButtons.addClass('markwhen-edit-actions');

		const saveButton = new ButtonComponent(actionButtons);
		saveButton.setButtonText('Save')
			.setCta()
			.onClick(() => {
				this.saveChanges();
			});

		const cancelButton = new ButtonComponent(actionButtons);
		cancelButton.setButtonText('Cancel')
			.onClick(() => {
				this.renderViewMode(container);
			});
	}

	private renderSplitView(editContainer: HTMLElement) {
		const splitContainer = editContainer.createDiv();
		splitContainer.addClass('markwhen-split-view');

		// Left side: Source editor
		const editorPane = splitContainer.createDiv();
		editorPane.addClass('markwhen-editor-pane');
		editorPane.createEl('div', { text: 'Source', cls: 'markwhen-pane-label' });

		this.textArea = new TextAreaComponent(editorPane);
		this.textArea.setValue(this.eventDescription);
		this.textArea.inputEl.addClass('markwhen-description-textarea');
		this.textArea.inputEl.rows = 15;
		this.textArea.inputEl.placeholder = 'Enter markdown here...';

		// Right side: Live preview
		const previewPane = splitContainer.createDiv();
		previewPane.addClass('markwhen-preview-pane');
		previewPane.createEl('div', { text: 'Preview', cls: 'markwhen-pane-label' });

		const previewContent = previewPane.createDiv();
		previewContent.addClass('markwhen-preview-content');

		this.updatePreview(previewContent);

		this.textArea.inputEl.addEventListener('input', () => {
			this.updatePreview(previewContent);
		});
	}

	private renderSourceOnly(editContainer: HTMLElement) {
		const sourceContainer = editContainer.createDiv();
		sourceContainer.addClass('markwhen-source-only');

		this.textArea = new TextAreaComponent(sourceContainer);
		this.textArea.setValue(this.eventDescription);
		this.textArea.inputEl.addClass('markwhen-description-textarea');
		this.textArea.inputEl.addClass('markwhen-source-only-textarea');
		this.textArea.inputEl.rows = 20;
		this.textArea.inputEl.placeholder = 'Enter markdown here...';
	}

	private updatePreview(previewEl: HTMLElement) {
		previewEl.empty();

		const content = this.textArea?.getValue() || '';

		if (content.trim()) {
			if (this.renderComponent) {
				this.renderComponent.unload();
			}

			this.renderComponent = new Component();
			this.renderComponent.load();

			MarkdownRenderer.render(
				this.app,
				content,
				previewEl,
				'',
				this.renderComponent
			);
		} else {
			previewEl.createEl('p', {
				text: 'Preview will appear here...',
				cls: 'markwhen-no-description'
			});
		}
	}

	toggleEditMode(container: HTMLElement) {
		if (this.isEditing) {
			this.renderViewMode(container);
		} else {
			this.renderEditMode(container);
		}
	}

	saveChanges() {
		if (this.textArea) {
			const newDescription = this.textArea.getValue();
			this.eventDescription = newDescription;
			this.onSave(newDescription);

			const container = this.contentEl.querySelector('.markwhen-description-container') as HTMLElement;
			if (container) {
				this.renderViewMode(container);
			}
		}
	}

	formatDateRange(): string {
		const event = this.event as any;
		const fromIso = event.dateRangeIso?.fromDateTimeIso;
		const toIso = event.dateRangeIso?.toDateTimeIso;

		const formatDateTime = (isoString: string | undefined) => {
			if (!isoString) return { date: '', time: '', hasTime: false };
			try {
				const date = new Date(isoString);
				const dateStr = date.toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'short',
					day: 'numeric'
				});

				const hours = date.getHours();
				const minutes = date.getMinutes();
				const hasTime = hours !== 0 || minutes !== 0;

				let timeStr = '';
				if (hasTime) {
					timeStr = date.toLocaleTimeString('en-US', {
						hour: 'numeric',
						minute: '2-digit',
						hour12: true
					});
				}

				return { date: dateStr, time: timeStr, hasTime };
			} catch {
				return { date: isoString.split('T')[0] || '', time: '', hasTime: false };
			}
		};

		const from = formatDateTime(fromIso);
		const to = formatDateTime(toIso);

		let fromStr = from.date;
		if (from.hasTime) {
			fromStr += ` at ${from.time}`;
		}

		let toStr = to.date;
		if (to.hasTime) {
			toStr += ` at ${to.time}`;
		}

		if (from.date === to.date && from.time === to.time) {
			return fromStr;
		}

		if (from.date === to.date && (from.hasTime || to.hasTime)) {
			if (from.hasTime && to.hasTime) {
				return `${from.date} ${from.time} → ${to.time}`;
			}
			return fromStr;
		}

		return `${fromStr} → ${toStr}`;
	}

	close() {
		if (this.renderComponent) {
			try {
				this.renderComponent.unload();
			} catch (e) {
				// Ignore cleanup errors
			}
			this.renderComponent = null;
		}

		try {
			super.close();
		} catch (e) {
			console.debug('[Markwhen] Modal close error (suppressed):', e);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
