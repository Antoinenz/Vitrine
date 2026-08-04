import { describe, it, expect } from 'vitest';
import { renderBlocks } from './legal';

describe('renderBlocks', () => {
	it('splits paragraphs on blank lines', () => {
		expect(renderBlocks('One.\n\nTwo.')).toEqual([
			{ type: 'paragraph', text: 'One.' },
			{ type: 'paragraph', text: 'Two.' }
		]);
	});

	it('reads a leading # as a heading', () => {
		expect(renderBlocks('# Privacy')).toEqual([{ type: 'heading', text: 'Privacy' }]);
	});

	/**
	 * Writing a heading directly above its opening sentence is the natural thing
	 * to do; folding the two together produced one enormous heading.
	 */
	it('separates a heading from text on the next line', () => {
		expect(renderBlocks('# Privacy\nThis page explains things.')).toEqual([
			{ type: 'heading', text: 'Privacy' },
			{ type: 'paragraph', text: 'This page explains things.' }
		]);
	});

	it('joins wrapped lines into one paragraph', () => {
		expect(renderBlocks('A sentence\nwrapped over lines.')).toEqual([
			{ type: 'paragraph', text: 'A sentence wrapped over lines.' }
		]);
	});

	it('ignores blank and whitespace-only chunks', () => {
		expect(renderBlocks('\n\n  \n\nOnly this.\n\n')).toEqual([
			{ type: 'paragraph', text: 'Only this.' }
		]);
	});

	/**
	 * No HTML is ever interpreted — markup arrives as literal text and Svelte
	 * escapes it on output, so an operator can't inject script into a public page.
	 */
	it('treats markup as literal text', () => {
		const blocks = renderBlocks('<script>alert(1)</script> hello');
		expect(blocks).toEqual([{ type: 'paragraph', text: '<script>alert(1)</script> hello' }]);
	});

	it('returns nothing for empty content', () => {
		expect(renderBlocks('')).toEqual([]);
		expect(renderBlocks('   \n  ')).toEqual([]);
	});
});
