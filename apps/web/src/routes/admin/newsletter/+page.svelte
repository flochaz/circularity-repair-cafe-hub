<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { auth } from '$lib/stores/auth';
  import { get } from 'svelte/store';
  import { Download, Loader2, Mail } from 'lucide-svelte';

  let since = '';
  let count: number | null = null;
  let lastOptInAt: number | null = null;
  let busy = false;
  let error = '';

  async function load(): Promise<void> {
    error = '';
    try {
      const q = since ? `?since=${since}` : '';
      const res = await api<{ count: number; lastOptInAt: number | null }>(`/api/admin/newsletter${q}`);
      count = res.count;
      lastOptInAt = res.lastOptInAt;
    } catch (err) {
      error = (err as Error)?.message || 'Could not load the count';
    }
  }

  onMount(load);

  async function download(): Promise<void> {
    busy = true;
    error = '';
    try {
      const token = get(auth)?.accessToken;
      const q = since ? `?since=${since}` : '';
      const res = await fetch(`/api/admin/newsletter/export.csv${q}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Could not export the CSV');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'newsletter.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      error = (err as Error)?.message || 'Could not export the CSV';
    } finally {
      busy = false;
    }
  }

  function fmt(ms: number | null): string {
    return ms ? new Date(ms).toLocaleDateString() : '—';
  }
</script>

<div class="mx-auto max-w-3xl p-4">
  <h1 class="flex items-center gap-2 text-2xl font-semibold"><Mail size={22} /> Newsletter</h1>
  <p class="mt-1 text-slate-600">
    People who explicitly asked for the newsletter when they brought something in to be repaired.
    Only that consent counts — the "storing my details" consent is not used here.
  </p>

  {#if error}<p class="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>{/if}

  <div class="mt-5 grid gap-4 sm:grid-cols-2">
    <div class="card p-5">
      <p class="text-xs uppercase tracking-wide text-slate-500">Opted-in contacts</p>
      <p class="mt-1 text-3xl font-bold">{count ?? '—'}</p>
      <p class="mt-1 text-xs text-slate-500">Last opt-in: {fmt(lastOptInAt)}</p>
    </div>
    <div class="card p-5">
      <label class="label" for="since">Only opt-ins since (optional)</label>
      <div class="flex gap-2">
        <input id="since" class="input" type="date" bind:value={since} on:change={load} />
        <button class="btn-ghost" type="button" on:click={load}>Apply</button>
      </div>
      <p class="mt-2 text-xs text-slate-500">Leave empty to export everyone who opted in.</p>
    </div>
  </div>

  <div class="card mt-4 p-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="font-semibold">Export for Yapla</h2>
        <p class="mt-1 text-sm text-slate-600">
          A CSV with exactly two columns — <code class="rounded bg-slate-100 px-1">email</code> and
          <code class="rounded bg-slate-100 px-1">Newsletter</code> = <code class="rounded bg-slate-100 px-1">yes</code> —
          ready to paste into your Newsletter list.
        </p>
      </div>
      <button class="btn-primary" type="button" disabled={busy || count === 0} on:click={download}>
        {#if busy}<Loader2 class="animate-spin" size={16} />{:else}<Download size={16} />{/if}
        Download CSV
      </button>
    </div>
  </div>

  <div class="card mt-4 p-5 text-sm text-slate-600">
    <h2 class="font-semibold text-slate-800">How to import it</h2>
    <ol class="mt-2 list-decimal space-y-1 pl-5">
      <li>In Yapla Newsletters, go to <strong>Audience → Contacts</strong>.</li>
      <li>Select your <strong>Newsletter</strong> list (left column).</li>
      <li>Click <strong>(+) → Import contacts → Existing</strong>, choose the list, continue.</li>
      <li>Choose <strong>Copy/paste from spreadsheet</strong>, and paste the CSV contents (open it in Excel/Numbers and copy both columns).</li>
      <li>Check the columns map to <code>email</code> and <code>Newsletter</code>, confirm the permission, import.</li>
    </ol>
    <p class="mt-3 text-xs text-slate-500">
      Nobody is included unless they ticked the box. If someone unsubscribes in Yapla, keep them out of
      later imports (Yapla normally keeps the unsubscribed status when the address already exists).
    </p>
  </div>
</div>
