import { type Event as MwEvent } from '@markwhen/parser';

export interface EventSourceRange {
	lineStart: number;
	lineEnd: number;
	eventEnd: number;
	dateFrom: number;
	dateTo: number;
	firstLine: string;
	title: string;
	description: string;
}

/**
 * The parser stores the event span on textRanges.whole. The heading line is
 * recovered from the date part, and the description is everything after that
 * line up to the next event.
 */
export function eventSourceRange(source: string, event: MwEvent): EventSourceRange {
	const dateFrom = event.textRanges.datePart.from;
	const dateTo = event.textRanges.datePart.to;

	let lineStart = dateFrom;
	while (lineStart > 0 && source[lineStart - 1] !== '\n') {
		lineStart--;
	}

	let lineEnd = dateTo;
	while (lineEnd < source.length && source[lineEnd] !== '\n') {
		lineEnd++;
	}

	const eventEnd = Math.min(
		Math.max(event.textRanges.whole.to, lineEnd),
		source.length
	);
	const firstLine = source.substring(lineStart, lineEnd);

	const dateEndInLine = dateTo - lineStart;
	const afterDatePart = firstLine.substring(Math.max(0, dateEndInLine));
	const colonInRest = afterDatePart.indexOf(':');

	let title = 'Event';
	if (colonInRest !== -1) {
		const afterColon = afterDatePart.substring(colonInRest + 1).trim();
		title = afterColon.replace(/#\w+/g, '').trim() || 'Event';
	} else {
		const restTrimmed = afterDatePart.trim();
		if (restTrimmed) {
			title = restTrimmed.replace(/#\w+/g, '').trim() || 'Event';
		}
	}

	const descriptionStart = lineEnd + 1;
	const description =
		descriptionStart >= eventEnd
			? ''
			: source.substring(descriptionStart, eventEnd).trim();

	return {
		lineStart,
		lineEnd,
		eventEnd,
		dateFrom,
		dateTo,
		firstLine,
		title,
		description,
	};
}

/** First Obsidian wikilink path in the text, without an anchor or alias. */
export function firstWikilink(text: string): string | undefined {
	const match = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/.exec(text);
	const linkpath = match?.[1]?.trim();
	return linkpath || undefined;
}
