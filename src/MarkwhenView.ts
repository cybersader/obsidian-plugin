import { WorkspaceLeaf, MarkdownView, TFile, Platform } from 'obsidian';
import MarkwhenPlugin from './main';
import { MARKWHEN_ICON } from './icons';
export const VIEW_TYPE_MARKWHEN = 'markwhen-view';
import { getAppState, getMarkwhenState } from './utils/markwhenState';
import {
	ParseResult,
	get,
	isEvent,
	parse,
	toDateRange,
	type Event as MwEvent,
} from '@markwhen/parser';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import {
	MarkwhenCodemirrorPlugin,
	parseResult,
} from './MarkwhenCodemirrorPlugin';

import { type ViewType, getTemplateURL } from './templates';
import { editEventDateRange } from './utils/dateTextInterpolation';
import { dateRangeToString } from './utils/dateTimeUtilities';
import { EventDetailModal } from './EventDetailModal';
import { WysiwygEventModal } from './WysiwygEventModal';
import { eventSourceRange, firstWikilink } from './utils/eventSourceRange';

interface TimelineDate {
	plus: (duration: { hours: number }) => TimelineDate;
}

export class MarkwhenView extends MarkdownView {
	readonly plugin: MarkwhenPlugin;
	editorView: EditorView;
	viewType!: ViewType;
	views: Partial<{ [vt in ViewType]: HTMLIFrameElement }>;
	codemirrorPlugin: ViewPlugin<MarkwhenCodemirrorPlugin>;
	updateId = 0;
	private frameSize: Partial<Record<ViewType, { width: number; height: number }>> = {};
	private frameObserver: ResizeObserver | null = null;
	private timelineAnchor: { width: number } | null = null;
	private pendingAnchor: {
		width: number;
		referenceDate: TimelineDate;
		pageScale: number;
	} | null = null;
	private anchorGeneration = 0;

	constructor(
		leaf: WorkspaceLeaf,
		viewType: ViewType = 'text',
		plugin: MarkwhenPlugin
	) {
		super(leaf);
		this.plugin = plugin;
		this.viewType = viewType;
		this.views = {};
		for (const view of ['timeline', 'calendar', 'oneview'] as ViewType[]) {
			this.views[view] = this.contentEl.createEl('iframe', {
				attr: {
					style: 'height: 100%; width: 100%',
				},
			});
			this.views[view]?.addClass('mw');
		}
		this.codemirrorPlugin = ViewPlugin.fromClass(MarkwhenCodemirrorPlugin);
	}

	createIFrameForViewType(
		viewType: ViewType,
		root: HTMLElement
	): HTMLIFrameElement {
		return root.createEl('iframe', {
			attr: {
				style: 'height: 100%; width: 100%',
				src: getTemplateURL(viewType),
			},
		});
	}

	getDisplayText() {
		return this.file?.name ?? 'Markwhen';
	}

	getIcon() {
		return MARKWHEN_ICON;
	}

	getViewType() {
		// This implements the TextFileView class provided by Obsidian API
		// Don't get confused with Markwhen visualizations
		return VIEW_TYPE_MARKWHEN;
	}

	async split(viewType: ViewType) {
		const leaf = this.app.workspace.getLeaf('split');
		await leaf.open(new MarkwhenView(leaf, viewType, this.plugin));
		await leaf.openFile(this.file!);
		await leaf.setViewState({
			type: VIEW_TYPE_MARKWHEN,
			active: true,
		});
	}

	updateVisualization(mw: ParseResult) {
		const frame = this.activeFrame();
		if (!frame) {
			return;
		}
		frame.contentWindow?.postMessage(
			{
				type: 'appState',
				request: true,
				id: `markwhen_${this.updateId++}`,
				params: getAppState(mw),
			},
			'*'
		);
		frame.contentWindow?.postMessage(
			{
				type: 'markwhenState',
				request: true,
				id: `markwhen_${this.updateId++}`,
				params: getMarkwhenState(mw, this.data),
			},
			'*'
		);
	}

	registerExtensions() {
		const cm = this.getCodeMirror();
		if (cm) {
			this.editorView = cm;
			const parseListener = EditorView.updateListener.of((update) => {
				update.transactions.forEach((tr) => {
					tr.effects.forEach((effect) => {
						if (effect.is(parseResult)) {
							this.updateVisualization(effect.value);
						}
					});
				});
			});
			this.editorView.dispatch({
				effects: StateEffect.appendConfig.of([
					this.codemirrorPlugin,
					parseListener,
				]),
			});
		}
	}

	async onLoadFile(file: TFile) {
		await super.onLoadFile(file);

		// Idk how else to register these extensions - I don't want to
		// register them in the main file because I need the update listener
		// to dispatch updates to visualizations.
		//
		// Meanwhile the extensions aren't
		// registered when I don't use setTimeout. Is there another hook I can use?
		// Other than onLoadFile or onOpen?
		setTimeout(() => {
			this.registerExtensions();
		}, 500);

		// Force update visualization when file changes
		// Send multiple updates to ensure the iframe properly receives new state
		this.forceRefreshVisualization(file.name);
	}

	/**
	 * Force refresh the visualization with multiple update attempts
	 * This helps when switching between files to ensure the iframe state is properly reset
	 */
	private forceRefreshVisualization(fileName: string) {
		// First update after content is loaded
		setTimeout(() => {
			const mw = this.getMw();
			if (mw) {
				console.log('[Markwhen] File loaded (update 1):', fileName);
				this.updateVisualization(mw);
			}
		}, 100);

		// Second update after extensions are registered
		setTimeout(() => {
			const mw = this.getMw();
			if (mw) {
				console.log('[Markwhen] File loaded (update 2):', fileName);
				this.updateVisualization(mw);
			}
		}, 600);

		// Third update as a final fallback
		setTimeout(() => {
			const mw = this.getMw();
			if (mw) {
				console.log('[Markwhen] File loaded (update 3):', fileName);
				this.updateVisualization(mw);
			}
		}, 1200);
	}

	async onOpen() {
		super.onOpen();

		const action = (viewType: ViewType) => async (evt: MouseEvent) => {
			if (evt.metaKey || evt.ctrlKey) {
				await this.split(viewType);
			} else if (this.viewType !== viewType) {
				await this.setViewType(viewType);
			}
		};

		this.addAction(
			'calendar',
			`Click to view calendar\n${
				Platform.isMacOS ? '⌘' : 'Ctrl'
			}+Click to open to the right`,
			action('calendar')
		);

		this.addAction(
			MARKWHEN_ICON,
			`Click to view timeline\n${
				Platform.isMacOS ? '⌘' : 'Ctrl'
			}+Click to open to the right`,
			action('timeline')
		);

		this.addAction(
			'oneview',
			`Click to view vertical timeline\n${
				Platform.isMacOS ? '⌘' : 'Ctrl'
			}+Click to open to the right`,
			action('oneview')
		);

		// Hook for resume view

		// this.addAction(
		// 	'file-text',
		// 	`Click to view resume\n${
		// 		Platform.isMacOS ? '⌘' : 'Ctrl'
		// 	}+Click to open to the right`,
		// 	action('resume')
		// );

		this.addAction(
			'pen-line',
			`Click to edit text\n${
				Platform.isMacOS ? '⌘' : 'Ctrl'
			}+Click to open to the right`,
			action('text')
		);

		this.setViewType(this.viewType);
		this.frameObserver = new ResizeObserver(() => this.syncFrameParking());
		this.frameObserver.observe(this.containerEl);
		this.register(() => this.frameObserver?.disconnect());
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => this.syncFrameParking())
		);
		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.syncFrameParking())
		);
		this.registerDomEvent(window, 'message', async (e) => {
			// Debug: Log ALL messages to find what pencil button sends
			console.log('[Markwhen] ANY message received:', {
				type: e.data?.type,
				request: e.data?.request,
				params: e.data?.params,
				fromActiveFrame: e.source === this.activeFrame()?.contentWindow,
				data: e.data
			});

			if (
				e.source == this.activeFrame()?.contentWindow &&
				e.data.request
			) {
				if (e.data.type === 'newEvent') {
					const { dateRangeIso, granularity } = e.data.params;
					const newEventString = `\n${dateRangeToString(
						toDateRange(dateRangeIso),
						granularity
							? granularity === 'instant'
								? 'minute'
								: granularity
							: 'day'
					)}: new event`;
					this.getCodeMirror()?.dispatch({
						changes: {
							from: this.data.length,
							to: this.data.length,
							insert: newEventString,
						},
					});
				} else if (
					e.data.type === 'markwhenState' ||
					e.data.type === 'appState'
				) {
					this.updateVisualization(this.getMw()!);
				} else if (e.data.type === 'editEventDateRange') {
					const events = this.getMw()?.events;
					if (!events) {
						return;
					}
					const { path, range, scale, preferredInterpolationFormat } =
						e.data.params;
					const event = get(events, path);
					if (!event || !isEvent(event)) {
						return;
					}
					const newText = editEventDateRange(
						event,
						toDateRange(range),
						scale,
						preferredInterpolationFormat
					);
					if (newText) {
						this.getCodeMirror()?.dispatch({
							changes: {
								from: event.textRanges.datePart.from,
								to: event.textRanges.datePart.to,
								insert: newText,
							},
						});
					}
				} else if (e.data.type === 'setDetailPath' || e.data.type === 'showInEditor') {
					// Handle event click (pencil button sends 'showInEditor')
					const path = e.data.params;
					console.log('[Markwhen] Event detail request received:', e.data.type, 'path:', path);

					if (!path) {
						console.log('[Markwhen] No path provided');
						return;
					}

					const events = this.getMw()?.events;
					if (!events) {
						console.log('[Markwhen] No events found');
						return;
					}

					const event = get(events, path);
					if (!event || !isEvent(event)) {
						console.log('[Markwhen] Event not found at path:', path);
						return;
					}

					console.log('[Markwhen] Opening detail for event:', event);
					void this.openEventDetail(event);
				}
			}
		});
	}

	async openEventDetail(event: MwEvent) {
		const opened = await this.openLinkedNote(event);
		if (!opened) {
			this.showEventDetailModal(event);
		}
	}

	/**
	 * Open the first wikilink in this event when it points at a vault note.
	 * Web links and unresolved links leave the caller to show the modal.
	 */
	async openLinkedNote(event: MwEvent): Promise<boolean> {
		const sourcePath = this.file?.path;
		if (!sourcePath) {
			return false;
		}
		const { lineStart, eventEnd } = eventSourceRange(this.data, event);
		const linkpath = firstWikilink(this.data.slice(lineStart, eventEnd));
		if (!linkpath) {
			return false;
		}
		const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
		if (!dest || dest.extension !== 'md') {
			console.log('[Markwhen] Wikilink did not resolve to a note:', linkpath);
			return false;
		}
		console.log('[Markwhen] Opening linked note:', dest.path);
		const leaf = this.leafForLinkedNote();
		await leaf.openFile(dest);
		return true;
	}

	/**
	 * Open the note to the right of the timeline, reusing that pane when it
	 * is already there so the timeline leaf stays on screen.
	 */
	leafForLinkedNote(): WorkspaceLeaf {
		const key = this.file?.path ?? '';
		const existing = this.plugin.linkedNoteLeaves.get(key);
		if (existing?.parent && existing !== this.leaf) {
			return existing;
		}
		this.app.workspace.setActiveLeaf(this.leaf, { focus: false });
		const leaf = this.app.workspace.getLeaf('split', 'vertical');
		if (key) {
			this.plugin.linkedNoteLeaves.set(key, leaf);
		}
		return leaf;
	}

	showEventDetailModal(event: MwEvent) {
		const editorMode = this.plugin.settings.editorMode || 'wysiwyg';

		if (editorMode === 'wysiwyg') {
			const modal = new WysiwygEventModal(
				this.app,
				event,
				this.data,
				(newTitle: string, newDescription: string, newDateRange?: string) => {
					this.updateEventTitleDescriptionAndDate(event, newTitle, newDescription, newDateRange);
				}
			);
			modal.open();
		} else {
			const modal = new EventDetailModal(
				this.app,
				event,
				this.data,
				(newDescription: string) => {
					this.updateEventDescription(event, newDescription);
				}
			);
			modal.open();
		}
	}

	/**
	 * Update event with new title, description, and optionally date range
	 */
	updateEventTitleDescriptionAndDate(event: MwEvent, newTitle: string, newDescription: string, newDateRange?: string) {
		const cm = this.getCodeMirror();
		if (!cm) return;

		const { lineStart, eventEnd, dateTo, firstLine } = eventSourceRange(
			this.data,
			event
		);

		// Find the colon AFTER the date part ends, not the first colon
		const dateEndInLine = dateTo - lineStart;
		const afterDatePart = firstLine.substring(dateEndInLine);
		const colonInRest = afterDatePart.indexOf(':');

		// Get the original date part (for fallback if no new date provided)
		const originalDatePart = firstLine.substring(0, dateEndInLine);

		// Use new date range if provided, otherwise keep original
		const datePart = newDateRange || originalDatePart;

		let tagsPart = '';
		if (colonInRest !== -1) {
			const afterColon = afterDatePart.substring(colonInRest + 1);
			const tagMatches = afterColon.match(/#\w+/g);
			if (tagMatches) {
				tagsPart = ' ' + tagMatches.join(' ');
			}
		} else {
			const tagMatches = afterDatePart.match(/#\w+/g);
			if (tagMatches) {
				tagsPart = ' ' + tagMatches.join(' ');
			}
		}

		// Build new event text
		let newFirstLine = `${datePart}: ${newTitle}${tagsPart}`;
		let newEventText = newFirstLine;
		if (newDescription && newDescription.trim()) {
			newEventText += '\n' + newDescription;
		}

		// Replace in editor
		cm.dispatch({
			changes: {
				from: lineStart,
				to: eventEnd,
				insert: newEventText + '\n',
			},
		});
	}

	updateEventTitleAndDescription(event: MwEvent, newTitle: string, newDescription: string) {
		// Delegate to the new method without date change
		this.updateEventTitleDescriptionAndDate(event, newTitle, newDescription);
	}

	updateEventDescription(event: MwEvent, newDescription: string) {
		const cm = this.getCodeMirror();
		if (!cm) return;

		const { lineStart, eventEnd, firstLine } = eventSourceRange(this.data, event);

		// Build new event text
		let newEventText = firstLine;
		if (newDescription && newDescription.trim()) {
			newEventText += '\n' + newDescription;
		}

		// Replace in editor
		cm.dispatch({
			changes: {
				from: lineStart,
				to: eventEnd,
				insert: newEventText + '\n',
			},
		});
	}

	activeFrame() {
		const current = this.viewType === 'text' ? undefined : this.views[this.viewType];
		if (
			current &&
			(current.hasClass('active') || current.dataset.mwParked === '1')
		) {
			return current;
		}
		for (let i = 0; i < this.contentEl.children.length; i++) {
			const el = this.contentEl.children.item(i);
			if (el?.nodeName === 'IFRAME' && el.hasClass('active')) {
				return el as HTMLIFrameElement;
			}
		}
	}

	/**
	 * A hidden tab gives the timeline a width of 0. Its own resize handler then
	 * recenters on a date far in the past. Keep the iframe at its last real
	 * size until the leaf is visible again.
	 */
	syncFrameParking() {
		if (this.viewType === 'text') {
			return;
		}
		const frame = this.views[this.viewType];
		if (!frame?.src) {
			return;
		}
		const width = this.containerEl.clientWidth;
		const height = this.containerEl.clientHeight;
		if (width > 0 && height > 0) {
			this.frameSize[this.viewType] = { width, height };
			this.restoreFrame(frame);
			this.holdTimelineEdge(frame);
			return;
		}
		if (this.frameSize[this.viewType]) {
			this.parkFrame(frame, this.viewType);
		}
	}

	timelineStore(frame: HTMLIFrameElement): {
		referenceDate: TimelineDate;
		pageScale: number;
	} | null {
		const root = frame.contentDocument?.querySelector('#app') as {
			__vue_app__?: {
				config: { globalProperties: { $pinia?: { _s: Map<string, unknown> } } };
			};
		} | null;
		const store = root?.__vue_app__?.config.globalProperties.$pinia?._s.get('timeline') as {
			referenceDate?: TimelineDate;
			pageScale?: number;
		} | undefined;
		if (!store?.referenceDate || typeof store.referenceDate.plus !== 'function') {
			return null;
		}
		if (typeof store.pageScale !== 'number' || store.pageScale <= 0) {
			return null;
		}
		return store as { referenceDate: TimelineDate; pageScale: number };
	}

	timelineScroller(frame: HTMLIFrameElement): HTMLElement | null {
		return frame.contentDocument?.querySelector('.overflow-scroll') ?? null;
	}

	/**
	 * The timeline recenters when its width changes, which walks the view
	 * toward BC as the note pane closes. Keep the date at the left edge fixed.
	 */
	holdTimelineEdge(frame: HTMLIFrameElement) {
		if (this.viewType !== 'timeline' || frame.dataset.mwParked === '1') {
			return;
		}
		const scroller = this.timelineScroller(frame);
		const store = this.timelineStore(frame);
		const width = scroller?.clientWidth ?? 0;
		if (!scroller || !store || width <= 0) {
			return;
		}
		if (!this.timelineAnchor) {
			this.timelineAnchor = { width };
			return;
		}
		if (Math.abs(width - this.timelineAnchor.width) < 2) {
			if (!this.pendingAnchor) {
				this.timelineAnchor = { width };
			}
			return;
		}
		if (!this.pendingAnchor) {
			this.pendingAnchor = {
				width: this.timelineAnchor.width,
				referenceDate: store.referenceDate,
				pageScale: store.pageScale,
			};
		}
		const generation = ++this.anchorGeneration;
		const pending = this.pendingAnchor;
		this.applyTimelineEdge(frame, pending, generation, false);
		window.setTimeout(() => this.applyTimelineEdge(frame, pending, generation, true), 400);
	}

	applyTimelineEdge(
		frame: HTMLIFrameElement,
		pending: NonNullable<MarkwhenView['pendingAnchor']>,
		generation: number,
		final: boolean
	) {
		if (generation !== this.anchorGeneration) {
			return;
		}
		const scroller = this.timelineScroller(frame);
		const store = this.timelineStore(frame);
		const width = scroller?.clientWidth ?? 0;
		if (!scroller || !store || width <= 0) {
			return;
		}
		const hours = ((width - pending.width) * 12) / pending.pageScale;
		const next = pending.referenceDate.plus({ hours });
		store.referenceDate = next;
		scroller.scrollLeft = width * 1.5;
		if (final) {
			this.timelineAnchor = { width };
			this.pendingAnchor = null;
		}
	}

	parkKey(viewType: ViewType): string {
		return `${this.file?.path ?? ''}::${viewType}`;
	}

	parkFrame(frame: HTMLIFrameElement, viewType: ViewType) {
		if (frame.dataset.mwParked === '1' || !this.file) {
			return;
		}
		const size = this.frameSize[viewType];
		if (!size) {
			return;
		}
		const host = this.plugin.ensureParkHost();
		frame.dataset.mwParked = '1';
		frame.style.position = 'fixed';
		frame.style.left = '0';
		frame.style.top = '0';
		frame.style.width = `${size.width}px`;
		frame.style.height = `${size.height}px`;
		frame.style.visibility = 'hidden';
		frame.style.pointerEvents = 'none';
		host.appendChild(frame);
		this.plugin.parkedFrames.set(this.parkKey(viewType), frame);
	}

	restoreFrame(frame: HTMLIFrameElement) {
		if (frame.dataset.mwParked !== '1') {
			return;
		}
		delete frame.dataset.mwParked;
		frame.setAttr('style', 'height: 100%; width: 100%');
		frame.addClass('mw');
		frame.addClass('active');
		this.contentEl.appendChild(frame);
		if (this.file) {
			this.plugin.parkedFrames.delete(this.parkKey(this.viewType));
		}
	}

	adoptParkedFrame(viewType: ViewType) {
		if (!this.file) {
			return;
		}
		const parked = this.plugin.parkedFrames.get(this.parkKey(viewType));
		if (!parked) {
			return;
		}
		const placeholder = this.views[viewType];
		if (placeholder && placeholder !== parked) {
			placeholder.remove();
		}
		delete parked.dataset.mwParked;
		parked.setAttr('style', 'height: 100%; width: 100%');
		parked.addClass('mw');
		parked.addClass('active');
		this.views[viewType] = parked;
		this.contentEl.appendChild(parked);
		this.plugin.parkedFrames.delete(this.parkKey(viewType));
	}

	async onClose() {
		this.frameObserver?.disconnect();
		for (const viewType of ['timeline', 'calendar', 'oneview'] as ViewType[]) {
			const frame = this.views[viewType];
			if (frame?.src) {
				this.parkFrame(frame, viewType);
			}
		}
		await super.onClose();
	}

	onload() {
		this.plugin.app.workspace.onLayoutReady(() => {
			this.contentEl.addClass('markwhen-view');
		});
		super.onload();
	}

	async setViewType(viewType?: ViewType) {
		if (!viewType) {
			return;
		}
		this.viewType = viewType;
		if (viewType !== 'text') {
			this.adoptParkedFrame(viewType);
		}
		if (this.viewType === 'text') {
			for (const vt of ['timeline', 'oneview', 'calendar']) {
				this.views[vt as ViewType]?.removeClass('mw-active');
			}
			Array.from(this.contentEl.children).forEach((el) => {
				if (el?.nodeName === 'IFRAME') {
					el.addClass('mw-hidden');
				} else {
					el?.removeClass('mw-hidden');
				}
			});
		} else {
			for (const vt of ['timeline', 'calendar', 'oneview']) {
				if (vt === viewType) {
					const frame = this.views[viewType];
					if (frame) {
						if (!frame.src) {
							frame.setAttrs({
								src: getTemplateURL(vt),
							});
						}
						frame.addClass('active');
					}
				} else {
					this.views[vt as ViewType]?.removeClass('active');
				}
			}
			for (let i = 0; i < this.contentEl.children.length; i++) {
				const el = this.contentEl.children.item(i);
				if (el?.nodeName === 'IFRAME' && el.hasClass('active')) {
					el.removeClass('mw-hidden');
				} else {
					el?.addClass('mw-hidden');
				}
			}
		}
		this.updateVisualization(this.getMw()!);
	}

	getCodeMirror(): EditorView | undefined {
		// @ts-ignore
		return this.editor.cm;
	}

	getMw(): ParseResult | undefined {
		return (
			this.getCodeMirror()?.plugin(this.codemirrorPlugin)?.markwhen ??
			parse(this.data)
		);
	}

	//Avoid loading Markdown file in Markwhen view (action icons, favicons, etc.)
	canAcceptExtension(extension: string) {
		return extension === 'mw';
	}
}
