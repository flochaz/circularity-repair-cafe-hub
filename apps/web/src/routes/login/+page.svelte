<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api, restoreSession, type ApiError } from '$lib/api';
  import { auth, type AuthUser } from '$lib/stores/auth';
  import { safeNext } from '$lib/staff/nav';
  import { LogIn, KeyRound } from 'lucide-svelte';
  import { t, tNow } from '$lib/i18n';

  // Two ways in: sign in with an existing password, or — first time only —
  // claim an account the café imported by choosing a password. No reset link
  // and no email for an organiser to send.
  let mode: 'signin' | 'activate' = 'signin';
  let email = '';
  let password = '';
  let confirm = '';
  let busy = false;
  let error = '';

  // Back to the page that sent you here, if you may open it. Otherwise your
  // usual starting page: the dashboard for admins, the queue for repairers.
  function destinationFor(user: AuthUser): string {
    return safeNext($page.url.searchParams.get('next'), user);
  }

  onMount(async () => {
    // If the user still has a valid session, skip the form.
    await restoreSession();
    if ($auth) goto(destinationFor($auth.user), { replaceState: true });
  });

  // The same rules the server checks, so people get the answer before a round trip.
  function passwordProblem(pw: string): string {
    if (pw.length < 10) return tNow('Use at least 10 characters.');
    if (!/[A-Z]/.test(pw)) return tNow('Add an uppercase letter.');
    if (!/[a-z]/.test(pw)) return tNow('Add a lowercase letter.');
    if (!/[0-9]/.test(pw)) return tNow('Add a number.');
    return '';
  }

  function switchMode(next: 'signin' | 'activate') {
    mode = next;
    error = '';
    confirm = '';
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      if (mode === 'activate') {
        const problem = passwordProblem(password);
        if (problem) {
          error = problem;
          return;
        }
        if (password !== confirm) {
          error = tNow('The two passwords do not match.');
          return;
        }
      }
      const body = await api<{ accessToken: string; user: any }>(
        mode === 'activate' ? '/api/auth/activate' : '/api/auth/login',
        {
          method: 'POST',
          json: { email: email.trim(), password },
          autoRefresh: false,
        }
      );
      auth.set({ accessToken: body.accessToken, user: body.user });
      goto(destinationFor(body.user), { replaceState: true });
    } catch (err) {
      const apiError = err as ApiError;
      // The account exists but has never been activated: send them to the
      // "choose a password" form rather than dead-ending on the password field.
      if (apiError?.code === 'auth/not_activated') mode = 'activate';
      error = tNow(apiError?.message || 'Could not sign in');
    } finally {
      busy = false;
    }
  }
</script>

<main class="min-h-screen grid place-items-center bg-slate-100 px-4 py-12">
  <form on:submit={submit} class="card p-8 w-full max-w-sm">
    <h1 class="text-2xl font-semibold">{mode === 'activate' ? $t('Choose your password') : $t('Sign in')}</h1>
    <p class="mt-1 text-sm text-slate-600">
      {mode === 'activate'
        ? $t('First time here? Enter the email the repair café has for you and pick a password.')
        : $t('For repairers and admins.')}
    </p>
    {#if mode === 'signin' && $page.url.searchParams.get('next')}
      <p class="mt-3 text-sm rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-slate-700">{$t('Sign in to carry on where you were.')}</p>
    {/if}
    <div class="mt-6 space-y-4">
      <div>
        <label class="label" for="email">{$t('Email')}</label>
        <input id="email" class="input" type="email" autocomplete="email" required bind:value={email} />
      </div>
      <div>
        <label class="label" for="password">{$t('Password')}</label>
        <input
          id="password"
          class="input"
          type="password"
          autocomplete={mode === 'activate' ? 'new-password' : 'current-password'}
          required
          bind:value={password}
        />
        {#if mode === 'activate'}
          <p class="mt-1 text-xs text-slate-500">{$t('At least 10 characters, with an uppercase letter, a lowercase letter and a number.')}</p>
        {/if}
      </div>
      {#if mode === 'activate'}
        <div>
          <label class="label" for="confirm">{$t('Confirm password')}</label>
          <input id="confirm" class="input" type="password" autocomplete="new-password" required bind:value={confirm} />
        </div>
      {/if}
      {#if error}<p class="text-sm text-rose-600">{error}</p>{/if}
      <button class="btn-primary w-full" disabled={busy} type="submit">
        {#if mode === 'activate'}
          <KeyRound size={18} /> {$t('Save password and sign in')}
        {:else}
          <LogIn size={18} /> {$t('Sign in')}
        {/if}
      </button>
      <button
        type="button"
        class="w-full text-center text-sm text-slate-500 hover:underline"
        on:click={() => switchMode(mode === 'activate' ? 'signin' : 'activate')}
      >
        {mode === 'activate' ? $t('I already have a password — sign in') : $t('First time here? Choose your password')}
      </button>
    </div>
    <a href="/" class="block text-center mt-6 text-sm text-slate-500 hover:underline">{$t('Back to home')}</a>
  </form>
</main>
