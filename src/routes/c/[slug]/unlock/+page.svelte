<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>{data.title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<div class="card">
		<h1>{data.title}</h1>
		<p class="lede">This collection is private. Enter the password you were given to view it.</p>

		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			{#if form?.message}
				<p class="error" role="alert">{form.message}</p>
			{/if}

			<label for="password">Password</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input id="password" name="password" type="password" autocomplete="off" autofocus required />

			<button type="submit" disabled={submitting}>{submitting ? 'Checking…' : 'View'}</button>
		</form>
	</div>
</main>

<style>
	main {
		display: grid;
		place-items: center;
		min-height: 100svh;
		padding: 1.5rem;
	}

	.card {
		width: 100%;
		max-width: 21rem;
	}

	h1 {
		margin: 0 0 0.5rem;
		font-size: 1.25rem;
		font-weight: 600;
		letter-spacing: -0.015em;
	}

	.lede {
		margin: 0 0 1.75rem;
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--color-ink-muted);
	}

	form {
		display: grid;
		gap: 0.4rem;
	}

	label {
		font-size: 0.8rem;
		color: var(--color-ink-muted);
	}

	input {
		padding: 0.6rem 0.7rem;
		font: inherit;
		font-size: 0.95rem;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-hairline);
		border-radius: 6px;
	}

	button {
		margin-top: 1rem;
		padding: 0.6rem 1rem;
		font: inherit;
		font-size: 0.9rem;
		color: var(--color-surface-raised);
		background: var(--color-ink);
		border: 0;
		border-radius: 6px;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.error {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		color: #b3261e;
	}
</style>
