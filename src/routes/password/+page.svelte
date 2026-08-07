<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Change password · Vitrine</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="wrap" class:standalone={data.forced}>
	<h1>{data.forced ? 'Choose a password' : 'Change password'}</h1>

	{#if data.forced}
		<p class="lede">
			Your account was created from the password in your server configuration. Pick a new one to
			finish setting up.
		</p>
	{/if}

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

		<label for="current">Current password</label>
		<input id="current" name="current" type="password" autocomplete="current-password" required />

		<label for="next">New password</label>
		<input
			id="next"
			name="next"
			type="password"
			autocomplete="new-password"
			minlength="12"
			required
		/>
		<p class="hint">At least 12 characters.</p>

		<label for="confirm">Confirm new password</label>
		<input
			id="confirm"
			name="confirm"
			type="password"
			autocomplete="new-password"
			minlength="12"
			required
		/>

		<button type="submit" disabled={submitting}>
			{submitting ? 'Saving…' : 'Save password'}
		</button>
	</form>
</div>

<style>
	.wrap {
		max-width: 22rem;
	}

	.wrap.standalone {
		display: grid;
		align-content: center;
		min-height: 100svh;
		margin-inline: auto;
		padding: 1.5rem;
	}

	h1 {
		margin: 0 0 0.5rem;
		font-size: 1.25rem;
		font-weight: 600;
		letter-spacing: -0.01em;
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

	.hint {
		margin: 0.15rem 0 0;
		font-size: 0.75rem;
		color: var(--color-ink-subtle);
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
</style>
