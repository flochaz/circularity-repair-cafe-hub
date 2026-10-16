<script lang="ts">
  // The open sign-up link for one session. A volunteer opens it on their phone,
  // types their name, and answers yes / if needed / no for each role. No account
  // is needed; their answer is remembered on their own device so they can change
  // it later, the way Framadate does.
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { auth } from '$lib/stores/auth';
  import { locale } from '$lib/i18n';
  import { t, tNow } from '$lib/i18n';
  import { Check, HelpCircle, Loader2, Trash2, Copy } from 'lucide-svelte';

  type Choice = 'yes' | 'if_needed' | 'no';
  interface Role {
    id: string;
    label: string;
    capacity: number | null;
  }
  interface Signup {
    id: string;
    name: string;
    comment: string | null;
    choices: Record<string, Choice>;
  }
  interface Board {
    event: { id: string; name: string; date: string; startTime: string; endTime: string; status: string };
    open: boolean;
    roles: Role[];
    signups: Signup[];
    summary: Record<string, { yes: number; ifNeeded: number; no: number }>;
  }

  $: token = $page.params.token;
  let board: Board | null = null;
  let loadError = '';
  let name = '';
  let comment = '';
  let myChoices: Record<string, Choice> = {};
  let busy = false;
  let saved = false;
  let editToken = '';
  let copied = false;
  let error = '';

  const storeKey = () => `rota:${token}`;

  function readMine(b: Board): void {
    try {
      const raw = localStorage.getItem(storeKey());
      if (!raw) return;
      const mine = JSON.parse(raw) as { signupId: string; editToken: string };
      editToken = mine.editToken;
      const found = b.signups.find((s) => s.id === mine.signupId);
      if (found) {
        name = found.name;
        comment = found.comment ?? '';
        myChoices = { ...found.choices };
        saved = true;
      }
    } catch {
      /* a broken stored answer just means starting fresh */
    }
  }

  async function load(): Promise<void> {
    try {
      board = await api<Board>(`/api/rota/${token}`, { autoRefresh: false });
      if (!name && $auth?.user?.displayName) name = $auth.user.displayName;
      readMine(board);
    } catch (err) {
      loadError = (err as Error)?.message || tNow('Could not load this sign-up');
    }
  }

  onMount(load);

  function setChoice(roleId: string, choice: Choice): void {
    myChoices = myChoices[roleId] === choice ? omit(myChoices, roleId) : { ...myChoices, [roleId]: choice };
  }

  function omit(source: Record<string, Choice>, key: string): Record<string, Choice> {
    const next = { ...source };
    delete next[key];
    return next;
  }

  async function save(): Promise<void> {
    if (!name.trim()) {
      error = tNow('Please add your name');
      return;
    }
    busy = true;
    error = '';
    try {
      const choices = Object.entries(myChoices).map(([roleId, choice]) => ({ roleId, choice }));
      const payload = { name: name.trim(), comment: comment.trim() || null, choices };
      if (editToken) {
        board = await api<Board>(`/api/rota/${token}/signups/${editToken}`, {
          method: 'PUT',
          json: payload,
          autoRefresh: false,
        });
      } else {
        const body = await api<Board & { signupId: string; editToken: string }>(`/api/rota/${token}/signups`, {
          method: 'POST',
          json: payload,
          autoRefresh: false,
        });
        editToken = body.editToken;
        localStorage.setItem(storeKey(), JSON.stringify({ signupId: body.signupId, editToken }));
        board = body;
      }
      saved = true;
    } catch (err) {
      error = (err as Error)?.message || tNow('Could not save your answer');
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (!editToken) return;
    busy = true;
    error = '';
    try {
      board = await api<Board>(`/api/rota/${token}/signups/${editToken}`, { method: 'DELETE', autoRefresh: false });
      localStorage.removeItem(storeKey());
      editToken = '';
      saved = false;
      myChoices = {};
      comment = '';
    } catch (err) {
      error = (err as Error)?.message || tNow('Could not remove your answer');
    } finally {
      busy = false;
    }
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      /* clipboard may be blocked; the address bar still works */
    }
  }

  function longDate(date: string): string {
    const d = new Date(`${date}T12:00:00`);
    return d.toLocaleDateString($locale === 'fr' ? 'fr-FR' : 'en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  function shortTime(time: string): string {
    return time.slice(0, 5);
  }

  const CHOICES: Array<{ value: Choice; key: string; on: string }> = [
    { value: 'yes', key: 'Yes', on: 'bg-emerald-600 text-white border-emerald-600' },
    { value: 'if_needed', key: 'If needed', on: 'bg-amber-500 text-white border-amber-500' },
    { value: 'no', key: 'No', on: 'bg-slate-600 text-white border-slate-600' },
  ];
</script>

<svelte:head>
  <title>{board?.event.name ?? $t('Sign up')}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="min-h-screen bg-slate-100 px-4 py-8">
  <div class="mx-auto max-w-2xl">
    {#if loadError}
      <div class="card p-6 text-center">
        <p class="text-slate-700">{loadError}</p>
      </div>
    {:else if !board}
      <div class="card p-10 text-center text-slate-500">
        <Loader2 class="mx-auto animate-spin" size={22} />
      </div>
    {:else}
      <header class="mb-4">
        <h1 class="text-2xl font-semibold text-slate-900">{$t('Who is coming?')}</h1>
        <p class="mt-1 text-slate-600">{board.event.name}</p>
        <p class="text-sm text-slate-500">
          {longDate(board.event.date)} · {shortTime(board.event.startTime)}–{shortTime(board.event.endTime)}
        </p>
      </header>

      {#if !board.open}
        <div class="card mb-4 border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {$t('This sign-up is closed. You can still see who answered below.')}
        </div>
      {/if}

      {#if board.open && board.roles.length > 0}
        <form class="card p-5" on:submit|preventDefault={save}>
          <h2 class="font-semibold text-slate-900">{$t('Your answer')}</h2>

          <div class="mt-4">
            <label class="label" for="name">{$t('Your name')}</label>
            <input id="name" class="input" type="text" autocomplete="name" maxlength="80" bind:value={name} />
          </div>

          <div class="mt-5 space-y-3">
            {#each board.roles as role (role.id)}
              <div class="rounded-xl border border-slate-200 p-3">
                <div class="flex items-baseline justify-between gap-2">
                  <span class="font-medium text-slate-800">{role.label}</span>
                  {#if role.capacity}<span class="text-xs text-slate-500">{$t('{n} needed', { n: role.capacity })}</span>{/if}
                </div>
                <div class="mt-2 grid grid-cols-3 gap-1.5">
                  {#each CHOICES as option}
                    <button
                      type="button"
                      class="rounded-lg border px-2 py-2 text-sm font-medium transition-colors {myChoices[role.id] === option.value
                        ? option.on
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
                      on:click={() => setChoice(role.id, option.value)}
                    >
                      {$t(option.key)}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>

          <div class="mt-5">
            <label class="label" for="comment">{$t('Comment (optional)')}</label>
            <textarea id="comment" class="input" rows="2" maxlength="500" bind:value={comment}></textarea>
          </div>

          {#if error}<p class="mt-3 text-sm text-rose-600">{error}</p>{/if}

          <div class="mt-5 flex flex-wrap items-center gap-3">
            <button class="btn-primary" type="submit" disabled={busy}>
              {#if busy}<Loader2 class="animate-spin" size={16} />{/if}
              {saved ? $t('Update my answer') : $t('Save my answer')}
            </button>
            {#if saved}
              <button class="btn-ghost text-rose-600" type="button" disabled={busy} on:click={remove}>
                <Trash2 size={16} /> {$t('Remove my answer')}
              </button>
            {/if}
            {#if saved}<span class="text-sm text-emerald-700">{$t('Saved.')}</span>{/if}
          </div>
          {#if saved}
            <p class="mt-2 text-xs text-slate-500">
              {$t('Your answer is kept on this device, so you can come back and change it.')}
            </p>
          {/if}
        </form>
      {:else if board.open}
        <div class="card mb-4 p-4 text-sm text-slate-600">
          {$t('The organiser has not set up any roles yet.')}
        </div>
      {/if}

      {#if board.signups.length > 0}
        <section class="mt-6">
          <h2 class="mb-3 font-semibold text-slate-900">{$t('Who answered')}</h2>
          <div class="space-y-3">
            {#each board.roles as role (role.id)}
              {@const count = board.summary[role.id] ?? { yes: 0, ifNeeded: 0, no: 0 }}
              <div class="card p-4">
                <div class="flex items-baseline justify-between gap-2">
                  <h3 class="font-medium text-slate-800">{role.label}</h3>
                  <span class="text-xs text-slate-500">
                    <span class="font-semibold text-emerald-700">{count.yes}</span> {$t('yes')}
                    {#if count.ifNeeded}· <span class="font-semibold text-amber-600">{count.ifNeeded}</span> {$t('if needed')}{/if}
                    {#if role.capacity}· {$t('{n} needed', { n: role.capacity })}{/if}
                  </span>
                </div>
                <div class="mt-2 space-y-1 text-sm">
                  {#each board.signups as signup (signup.id)}
                    {#if signup.choices[role.id] === 'yes'}
                      <p class="text-emerald-800"><Check class="inline -mt-0.5" size={14} /> {signup.name}</p>
                    {:else if signup.choices[role.id] === 'if_needed'}
                      <p class="text-amber-700"><HelpCircle class="inline -mt-0.5" size={14} /> {signup.name}</p>
                    {/if}
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </section>

        {#if board.signups.some((s) => s.comment)}
          <section class="mt-6">
            <h2 class="mb-3 font-semibold text-slate-900">{$t('Comments')}</h2>
            <div class="space-y-2">
              {#each board.signups as signup (signup.id)}
                {#if signup.comment}
                  <div class="card p-3 text-sm">
                    <p class="font-medium text-slate-700">{signup.name}</p>
                    <p class="text-slate-600">{signup.comment}</p>
                  </div>
                {/if}
              {/each}
            </div>
          </section>
        {/if}
      {/if}

      <div class="mt-6 text-center">
        <button class="btn-ghost text-sm" type="button" on:click={copyLink}>
          <Copy size={14} /> {copied ? $t('Link copied') : $t('Copy this link')}
        </button>
      </div>
    {/if}
  </div>
</main>
