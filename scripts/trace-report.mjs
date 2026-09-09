#!/usr/bin/env node
/**
 * Summarises a Chrome DevTools performance trace.
 *
 * Written because the motion problems in this app are not in JavaScript. A CPU
 * profile of a collection opening is 70% idle with no function above 0.7%, so
 * the cost is raster, decode, layout and paint — work a console script cannot
 * see and a CPU profile attributes to nothing. A trace does show it, and this
 * pulls out the parts that matter rather than making someone read 200 MB of
 * JSON.
 *
 *   node scripts/trace-report.mjs <trace.json> [--anchor visible|click|<ms>]
 *
 * Anchoring matters: "is the page slow" is the wrong question, "what is it
 * doing in the two seconds after I come back to the tab" is the right one. By
 * default it anchors on the last `visibilitychange` back to visible, falling
 * back to the start of the trace.
 */

import { readFileSync } from 'node:fs';

const [, , file, ...rest] = process.argv;
if (!file) {
	console.error('usage: node scripts/trace-report.mjs <trace.json> [--anchor visible|click|<ms>]');
	process.exit(1);
}

const anchorArg = rest.includes('--anchor') ? rest[rest.indexOf('--anchor') + 1] : 'visible';

const raw = JSON.parse(readFileSync(file, 'utf8'));
const events = Array.isArray(raw) ? raw : (raw.traceEvents ?? []);
if (events.length === 0) {
	console.error('no trace events found — is this a DevTools performance trace?');
	process.exit(1);
}

/** Complete events are the ones carrying a duration; everything else is a marker. */
const complete = events.filter((e) => e.ph === 'X' && typeof e.dur === 'number');
const t0 = Math.min(...complete.map((e) => e.ts));
const tEnd = Math.max(...complete.map((e) => e.ts + e.dur));
const ms = (ts) => (ts - t0) / 1000;

/** Threads, so raster and GPU work is not mixed in with the main thread's. */
const threadNames = new Map();
for (const e of events) {
	if (e.ph === 'M' && e.name === 'thread_name') {
		threadNames.set(`${e.pid}:${e.tid}`, e.args?.name ?? '?');
	}
}
const threadOf = (e) => threadNames.get(`${e.pid}:${e.tid}`) ?? 'unknown';

// ---------------------------------------------------------------- anchor

function findAnchor() {
	if (/^\d+$/.test(anchorArg)) return Number(anchorArg);

	if (anchorArg === 'visible') {
		/**
		 * The return to the tab. Chrome records this in more than one shape
		 * depending on version, so several are tried before giving up.
		 */
		const candidates = events.filter(
			(e) =>
				e.args?.data?.type === 'visibilitychange' ||
				e.name === 'WebContentsImpl::WasShown' ||
				(e.name === 'EventDispatch' && e.args?.data?.type === 'visibilitychange')
		);
		if (candidates.length) return ms(candidates[candidates.length - 1].ts);
	}

	if (anchorArg === 'click') {
		const click = events.filter(
			(e) => e.name === 'EventDispatch' && e.args?.data?.type === 'click'
		);
		if (click.length) return ms(click[click.length - 1].ts);
	}

	return 0;
}

const anchor = findAnchor();

// ---------------------------------------------------------------- buckets

/**
 * What each kind of work is called in a trace.
 *
 * Grouped by what a person would want to know rather than by Chrome's own
 * taxonomy, because "is this raster or decode" is the question that decides
 * what to change.
 */
const GROUPS = {
	'image decode': ['ImageDecodeTask', 'Decode Image', 'ImageDecodeTaskImpl', 'Decode LazyPixelRef'],
	raster: ['RasterTask', 'Rasterize', 'RasterizerTaskImpl'],
	'layout & style': [
		'Layout',
		'UpdateLayoutTree',
		'ParseAuthorStyleSheet',
		'ScheduledStyleRecalculation'
	],
	paint: ['Paint', 'PrePaint', 'PaintImage'],
	'composite & commit': [
		'CompositeLayers',
		'Commit',
		'ActivateLayerTree',
		'ProxyImpl::ScheduledActionCommit',
		'LayerTreeHostImpl::PrepareToDraw'
	],
	'gpu upload': ['GPUTask', 'TransferToGPU', 'UploadTexture', 'gpu::gles2', 'SkiaGpu'],
	javascript: [
		'FunctionCall',
		'EvaluateScript',
		'V8.Execute',
		'RunMicrotasks',
		'MajorGC',
		'MinorGC'
	],
	'frame work': ['BeginMainThreadFrame', 'DrawFrame', 'BeginFrame']
};

/**
 * Task wrappers, excluded from the per-event list.
 *
 * Every piece of work on a thread is nested inside one of these, so they always
 * top the list by duration while saying nothing about what was slow. Their
 * total is roughly "how busy was this thread", which the thread summary above
 * already gives.
 */
const WRAPPERS = new Set([
	'RunTask',
	'ThreadControllerImpl::RunTask',
	'ThreadPool_RunTask',
	'TaskGraphRunner::RunTask',
	'ThreadControllerImpl::RunTask::ThreadControllerActive',
	'Receive mojo message',
	'SimpleWatcher::OnHandleReady',
	'EpollEvent',
	'MessagePumpLibevent::Run'
]);

function groupOf(name) {
	for (const [group, names] of Object.entries(GROUPS)) {
		if (names.some((n) => name === n || name.startsWith(n))) return group;
	}
	return null;
}

function summarise(from, to, label) {
	const inWindow = complete.filter((e) => {
		const start = ms(e.ts);
		return start >= from && start <= to;
	});

	const byGroup = new Map();
	const byName = new Map();
	for (const e of inWindow) {
		const d = e.dur / 1000;
		const g = groupOf(e.name);
		if (g) byGroup.set(g, (byGroup.get(g) ?? 0) + d);
		byName.set(e.name, (byName.get(e.name) ?? 0) + d);
	}

	console.log(`\n=== ${label} (${from.toFixed(0)}ms → ${to.toFixed(0)}ms) ===`);

	const groups = [...byGroup].sort((a, b) => b[1] - a[1]);
	if (groups.length === 0) {
		console.log('  nothing recorded in this window');
		return;
	}
	console.log('  by kind of work (total ms across all threads):');
	for (const [g, d] of groups) console.log('   ', d.toFixed(0).padStart(7) + 'ms', g);

	console.log('  busiest individual events:');
	for (const [n, d] of [...byName]
		.filter(([n]) => !WRAPPERS.has(n))
		.sort((a, b) => b[1] - a[1])
		.slice(0, 12)) {
		console.log('   ', d.toFixed(0).padStart(7) + 'ms', n);
	}

	/**
	 * The symptom itself, rather than a proxy for it. Chrome records a
	 * `DroppedFrame` when it fails to present one, so this is the line that says
	 * whether a window actually stuttered or was merely busy.
	 */
	const dropped = events.filter(
		(e) => e.name === 'DroppedFrame' && ms(e.ts) >= from && ms(e.ts) <= to
	);
	console.log(`  dropped frames: ${dropped.length}`);
	if (dropped.length) {
		console.log('   at ' + dropped.map((e) => `${(ms(e.ts) - anchor).toFixed(0)}ms`).join(' '));
	}

	const longest = inWindow
		.filter((e) => e.dur > 20000 && !WRAPPERS.has(e.name))
		.sort((a, b) => b.dur - a.dur)
		.slice(0, 10);
	if (longest.length) {
		console.log('  single events over 20ms:');
		for (const e of longest) {
			console.log(
				'   ',
				(e.dur / 1000).toFixed(0).padStart(6) + 'ms',
				`at ${ms(e.ts).toFixed(0)}ms`.padEnd(12),
				e.name.slice(0, 34).padEnd(36),
				threadOf(e).slice(0, 24)
			);
		}
	}
}

// ---------------------------------------------------------------- output

console.log(`trace: ${file}`);
console.log(`events: ${events.length}, span: ${ms(tEnd).toFixed(0)}ms`);
console.log(`anchor (${anchorArg}): ${anchor.toFixed(0)}ms`);

const threads = new Map();
for (const e of complete) {
	const name = threadOf(e);
	threads.set(name, (threads.get(name) ?? 0) + e.dur / 1000);
}
console.log('\nbusiest threads over the whole trace:');
for (const [n, d] of [...threads].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
	console.log('   ', d.toFixed(0).padStart(7) + 'ms', n);
}

if (anchor > 0) summarise(anchor - 1000, anchor, 'the second BEFORE the anchor');
summarise(anchor, anchor + 2000, 'the 2s AFTER the anchor');
summarise(anchor + 2000, anchor + 6000, '2s to 6s after the anchor');

/**
 * Long frames, as the compositor saw them.
 *
 * The user-visible symptom is dropped frames, so this is the line that says
 * whether a window was actually janky rather than merely busy.
 */
const draws = events
	.filter((e) => e.name === 'DrawFrame' || e.name === 'BeginFrame')
	.map((e) => ms(e.ts))
	.sort((a, b) => a - b);
if (draws.length > 1) {
	const gaps = [];
	for (let i = 1; i < draws.length; i++) gaps.push([draws[i], draws[i] - draws[i - 1]]);
	const bad = gaps.filter(([at, g]) => g > 25 && at >= anchor && at <= anchor + 8000);
	console.log(`\nframe gaps over 25ms in the 8s after the anchor: ${bad.length}`);
	console.log(
		'  ' + bad.map(([at, g]) => `${(at - anchor).toFixed(0)}:${g.toFixed(0)}ms`).join(' ')
	);
}
