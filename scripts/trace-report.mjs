#!/usr/bin/env node
/**
 * Summarises a Chrome DevTools performance trace.
 *
 * Written because the motion problems in this app are not in JavaScript. A CPU
 * profile of a collection opening is 70% idle with no function above 0.7%,
 * because the cost is raster, decode and paint — work a console script cannot
 * see and a CPU profile attributes to nothing. A trace does show it, and this
 * pulls out the parts that matter rather than making someone read it by hand.
 *
 *   node scripts/trace-report.mjs <trace.json>              # timeline, to find the moment
 *   node scripts/trace-report.mjs <trace.json> --at 42300   # what happened around it
 *
 * ## Why this streams
 *
 * The first real trace anyone handed me was 172 MB, for 109 seconds of
 * recording with screenshots already turned off. `JSON.parse` on that wants
 * something like 2 GB, which is more than the machine it runs on has. Traces are
 * large by nature — tens of thousands of events a second across a dozen threads
 * — so the event array is read a chunk at a time and only aggregates are kept.
 * Memory stays flat however long the recording ran.
 */

import { createReadStream } from 'node:fs';

const [, , file, ...rest] = process.argv;
if (!file) {
	console.error('usage: node scripts/trace-report.mjs <trace.json> [--at <ms>] [--window <ms>]');
	process.exit(1);
}

const flag = (name, fallback) => {
	const i = rest.indexOf(name);
	return i === -1 ? fallback : Number(rest[i + 1]);
};
const focus = flag('--at', null);
const windowMs = flag('--window', 2000);

/**
 * Yields each object in the `traceEvents` array without holding the file.
 *
 * Object boundaries are found by brace depth, tracking string state so that a
 * brace inside a URL or a function name cannot end an object early.
 */
async function* traceEvents(path) {
	const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 });

	let buf = '';
	let scanFrom = 0;
	let started = false;
	let depth = 0;
	let objStart = -1;
	let inString = false;
	let escaped = false;

	for await (const chunk of stream) {
		buf += chunk;

		if (!started) {
			const key = buf.indexOf('"traceEvents"');
			const open = key === -1 ? -1 : buf.indexOf('[', key);
			if (open === -1) {
				// Keep a tail, so the key can straddle two chunks.
				if (buf.length > 64) buf = buf.slice(-64);
				continue;
			}
			buf = buf.slice(open + 1);
			scanFrom = 0;
			started = true;
		}

		let i = scanFrom;
		for (; i < buf.length; i++) {
			const c = buf[i];

			if (inString) {
				if (escaped) escaped = false;
				else if (c === '\\') escaped = true;
				else if (c === '"') inString = false;
				continue;
			}

			if (c === '"') inString = true;
			else if (c === '{') {
				if (depth === 0) objStart = i;
				depth++;
			} else if (c === '}') {
				depth--;
				if (depth === 0 && objStart >= 0) {
					yield JSON.parse(buf.slice(objStart, i + 1));
					objStart = -1;
				}
			} else if (c === ']' && depth === 0) {
				return;
			}
		}

		// Carry forward only an unfinished object; everything else is spent.
		if (depth > 0 && objStart >= 0) {
			buf = buf.slice(objStart);
			scanFrom = buf.length;
			objStart = 0;
		} else {
			buf = '';
			scanFrom = 0;
		}
	}
}

const GROUPS = {
	'image decode': ['ImageDecodeTask', 'Decode Image', 'Decode LazyPixelRef', 'Draw LazyPixelRef'],
	raster: ['RasterTask', 'Rasterize', 'RasterizerTaskImpl'],
	'layout & style': ['Layout', 'UpdateLayoutTree', 'ParseAuthorStyleSheet'],
	paint: ['Paint', 'PrePaint'],
	'composite & commit': ['CompositeLayers', 'Commit', 'ActivateLayerTree', 'LayerTreeHostImpl'],
	'gpu upload': ['GPUTask', 'TransferToGPU', 'UploadTexture', 'gpu::', 'SkiaGpu'],
	javascript: [
		'FunctionCall',
		'EvaluateScript',
		'V8.Execute',
		'RunMicrotasks',
		'MajorGC',
		'MinorGC'
	]
};

/**
 * Task wrappers. Every piece of work nests inside one, so they always top a
 * duration ranking while saying nothing about what was slow.
 */
const WRAPPERS = new Set([
	'RunTask',
	'ThreadControllerImpl::RunTask',
	'ThreadPool_RunTask',
	'TaskGraphRunner::RunTask',
	'Receive mojo message',
	'SimpleWatcher::OnHandleReady',
	'EpollEvent',
	'MessagePumpLibevent::Run',
	'ThreadControllerImpl::RunTask::ThreadControllerActive'
]);

function groupOf(name) {
	for (const [group, names] of Object.entries(GROUPS)) {
		if (names.some((n) => name === n || name.startsWith(n))) return group;
	}
	return null;
}

// ---------------------------------------------------------------- collect

const threadNames = new Map();
const bins = new Map();
const droppedBySecond = new Map();
const dropped = [];
const markers = [];
const threadTotals = new Map();
const focusNames = new Map();
const focusGroups = new Map();
const focusLong = [];

let minTs = Infinity;
let maxTs = -Infinity;
let count = 0;

for await (const e of traceEvents(file)) {
	count++;

	if (e.ph === 'M' && e.name === 'thread_name') {
		threadNames.set(`${e.pid}:${e.tid}`, e.args?.name ?? '?');
		continue;
	}

	if (typeof e.ts !== 'number' || e.ts === 0) continue;
	if (e.ts < minTs) minTs = e.ts;
	if (e.ts > maxTs) maxTs = e.ts;

	const second = Math.floor(e.ts / 1e6);

	if (e.name === 'DroppedFrame') {
		dropped.push(e.ts);
		droppedBySecond.set(second, (droppedBySecond.get(second) ?? 0) + 1);
		continue;
	}

	const type = e.args?.data?.type;
	if (type === 'visibilitychange' || type === 'click') markers.push([e.ts, type]);
	else if (e.name === 'navigationStart') markers.push([e.ts, 'navigation']);

	if (e.ph !== 'X' || typeof e.dur !== 'number') continue;

	const d = e.dur / 1000;
	threadTotals.set(`${e.pid}:${e.tid}`, (threadTotals.get(`${e.pid}:${e.tid}`) ?? 0) + d);

	const group = groupOf(e.name);
	if (group) {
		let row = bins.get(second);
		if (!row) bins.set(second, (row = new Map()));
		row.set(group, (row.get(group) ?? 0) + d);
	}
}

const ms = (ts) => (ts - minTs) / 1000;
const base = Math.floor(minTs / 1e6);

/**
 * A second pass rather than a buffer.
 *
 * The window is expressed relative to the trace's start, and the start is only
 * known once the whole file has been read — so keeping candidate events during
 * the first pass would mean keeping nearly all of them, which is the thing this
 * script exists to avoid. Reading 172 MB twice costs a few seconds of I/O and no
 * memory at all.
 */
if (focus !== null) {
	for await (const e of traceEvents(file)) {
		if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
		const at = ms(e.ts);
		if (at < focus || at > focus + windowMs) continue;

		const d = e.dur / 1000;
		const group = groupOf(e.name);
		if (group) focusGroups.set(group, (focusGroups.get(group) ?? 0) + d);
		if (!WRAPPERS.has(e.name)) {
			focusNames.set(e.name, (focusNames.get(e.name) ?? 0) + d);
			if (e.dur > 15000) focusLong.push(e);
		}
	}
}

// ---------------------------------------------------------------- report

console.log(`trace:  ${file}`);
console.log(`events: ${count.toLocaleString()}, span: ${(ms(maxTs) / 1000).toFixed(1)}s`);
console.log(`dropped frames: ${dropped.length}`);

console.log('\nbusiest threads (total ms of recorded work):');
for (const [k, d] of [...threadTotals].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
	console.log('   ', d.toFixed(0).padStart(8) + 'ms', threadNames.get(k) ?? k);
}

if (markers.length) {
	console.log('\nmarkers:');
	for (const [ts, name] of markers.slice(0, 40)) {
		console.log('   ', (ms(ts) / 1000).toFixed(2).padStart(8) + 's', name);
	}
	if (markers.length > 40) console.log(`    … and ${markers.length - 40} more`);
}

console.log('\nper-second timeline — "drop" is frames Chrome failed to present');
console.log('   time   drop   raster  decode  layout   paint  compos     gpu      js');
const seconds = [...new Set([...bins.keys(), ...droppedBySecond.keys()])].sort((a, b) => a - b);
for (const s of seconds) {
	const row = bins.get(s) ?? new Map();
	const drop = droppedBySecond.get(s) ?? 0;
	const busy = [...row.values()].reduce((a, b) => a + b, 0);
	if (drop === 0 && busy < 5) continue;
	const cell = (g) => (row.get(g) ?? 0).toFixed(0).padStart(7);
	console.log(
		'  ' + `${s - base}s`.padStart(5),
		String(drop).padStart(5),
		cell('raster'),
		cell('image decode'),
		cell('layout & style'),
		cell('paint'),
		cell('composite & commit'),
		cell('gpu upload'),
		cell('javascript')
	);
}

if (focus !== null) {
	console.log(`\n=== ${focus}ms → ${focus + windowMs}ms ===`);
	console.log('  by kind of work:');
	for (const [g, d] of [...focusGroups].sort((a, b) => b[1] - a[1])) {
		console.log('   ', d.toFixed(0).padStart(7) + 'ms', g);
	}
	console.log('  busiest events:');
	for (const [n, d] of [...focusNames].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
		console.log('   ', d.toFixed(0).padStart(7) + 'ms', n);
	}
	console.log(
		`  dropped frames: ${dropped.filter((ts) => ms(ts) >= focus && ms(ts) <= focus + windowMs).length}`
	);
	const long = focusLong.sort((a, b) => b.dur - a.dur).slice(0, 12);
	if (long.length) {
		console.log('  single events over 15ms:');
		for (const e of long) {
			console.log(
				'   ',
				(e.dur / 1000).toFixed(0).padStart(6) + 'ms',
				`at ${ms(e.ts).toFixed(0)}ms`.padEnd(12),
				e.name.slice(0, 32).padEnd(34),
				(threadNames.get(`${e.pid}:${e.tid}`) ?? '?').slice(0, 22)
			);
		}
	}
}
