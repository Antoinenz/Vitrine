import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug, isReservedSlug } from './slug';

describe('slugify', () => {
	it('lowercases and hyphenates', () => {
		expect(slugify('Sierra Nevada')).toBe('sierra-nevada');
	});

	it('strips accents rather than dropping the word', () => {
		expect(slugify('Otoño en Málaga')).toBe('otono-en-malaga');
		expect(slugify('Café')).toBe('cafe');
	});

	it('removes apostrophes without splitting the word', () => {
		expect(slugify("Winter's Edge")).toBe('winters-edge');
		expect(slugify('Winter’s Edge')).toBe('winters-edge');
	});

	it('collapses punctuation and trims stray hyphens', () => {
		expect(slugify('  A — B / C  ')).toBe('a-b-c');
		expect(slugify('!!!Hello!!!')).toBe('hello');
	});

	it('returns empty for input with nothing usable', () => {
		expect(slugify('...')).toBe('');
		expect(slugify('   ')).toBe('');
	});

	it('caps length without leaving a trailing hyphen', () => {
		const slug = slugify('word '.repeat(60));
		expect(slug.length).toBeLessThanOrEqual(80);
		expect(slug.endsWith('-')).toBe(false);
	});

	it('keeps digits', () => {
		expect(slugify('Roll 400 — 2026')).toBe('roll-400-2026');
	});
});

describe('uniqueSlug', () => {
	const none = () => false;

	it('returns the plain slug when free', () => {
		expect(uniqueSlug('Sierra', none)).toBe('sierra');
	});

	it('suffixes until it finds a gap', () => {
		const taken = new Set(['sierra', 'sierra-2', 'sierra-3']);
		expect(uniqueSlug('Sierra', (s) => taken.has(s))).toBe('sierra-4');
	});

	it('falls back for a title that slugifies to nothing', () => {
		expect(uniqueSlug('...', none)).toBe('untitled');
	});

	/**
	 * A collection slugged `admin` would sit at /c/admin, but reserving these
	 * keeps the door shut on route-shaped names generally.
	 */
	it('skips reserved words', () => {
		expect(uniqueSlug('Admin', none)).toBe('admin-2');
		expect(uniqueSlug('API', none)).toBe('api-2');
	});

	it('reports reserved slugs', () => {
		expect(isReservedSlug('admin')).toBe(true);
		expect(isReservedSlug('sierra')).toBe(false);
	});
});
