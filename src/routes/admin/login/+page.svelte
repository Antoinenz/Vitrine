<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Sign in · Vitrine</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<div class="card">
		<h1>Vitrine</h1>

		{#if !data.hasAccount}
			<p class="notice">
				No account exists yet. Set <code>ADMIN_EMAIL</code> and <code>ADMIN_PASSWORD</code> in your environment
				and restart to create one.
			</p>
		{:else}
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

				<label for="email">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="username"
					required
					value={form?.email ?? ''}
				/>

				<label for="password">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
				/>

				<button type="submit" disabled={submitting}>
					{submitting ? 'Signing in…' : 'Sign in'}
				</button>
			</form>
		{/if}
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
		max-width: 22rem;
	}

	h1 {
		margin: 0 0 2rem;
		font-size: 1.25rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	form {
		display: grid;
		gap: 0.4rem;
	}

	label {
		font-size: 0.8rem;
		color: var(--color-ink-muted);
	}

	label:not(:first-of-type) {
		margin-top: 0.75rem;
	}

	input {
		padding: 0.6rem 0.7rem;
		font: inherit;
		font-size: 0.95rem;
		color: var(--color-ink);
		background: var(--color-surface-raised);
		border: 1px solid var(--color-hairline);
		border-radius: 6px;
	}

	button {
		margin-top: 1.25rem;
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

	.notice {
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--color-ink-muted);
	}

	code {
		padding: 0.1em 0.3em;
		font-size: 0.85em;
		background: var(--color-surface-sunken);
		border-radius: 3px;
	}
</style>
