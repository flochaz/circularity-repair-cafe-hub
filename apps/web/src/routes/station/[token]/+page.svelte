<script lang="ts">
  // The shared volunteer station. An organiser publishes this link or its QR
  // code; a volunteer opens it, taps their name and lands in the queue without
  // a password. See apps/cloudflare/src/routes/station.ts.
  //
  // The station is deliberately a list, not a remembered session: the next
  // volunteer picks their own name on the same device.
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, restoreSession } from '$lib/api';
  import { auth } from '$lib/stores/auth';
  import LanguageSwitch from '$lib/components/LanguageSwitch.svelte';
  import { locale, t, tNow } from '$lib/i18n';
  import { ArrowRight, Wrench } from 'lucide-svelte';

  interface StationData {
    cafeName: string;
    users: Array<{ id: string; displayName: string }>;
    event: { name: string; date: string } | null;
  }

  $: token = $page.params.token ?? '';
  let data: StationData | null = null;
  let loading = true;
  let error = '';
  let busyId = '';

  onMount(async () => {
    // Let a session left by the previous volunteer finish restoring first, so
    // it cannot land on top of the name chosen here.
    await restoreSession();
    await load();
  });

  async function load() {
    loading = true;
    error = '';
    try {
      data = await api<StationData>(`/api/station/${encodeURIComponent(token)}`, { autoRefresh: false });
    } catch (err: any) {
      if (err?.status === 404) {
        try {
          localStorage.removeItem('hub.station');
        } catch {
          /* private mode */
        }
      }
      error =
        err?.status === 404
          ? tNow('This volunteer link is not valid. Ask the organiser for the current one.')
          : err?.message ?? tNow('Could not load the volunteer list');
    } finally {
      loading = false;
    }
  }

  async function choose(user: { id: string; displayName: string }) {
    busyId = user.id;
    error = '';
    try {
      const res = await api<{ accessToken: string; user: any }>(
        `/api/station/${encodeURIComponent(token)}/select`,
        { method: 'POST', json: { userId: user.id }, autoRefresh: false },
      );
      auth.set({ accessToken: res.accessToken, user: res.user });
      // Remember where the station is, so the menu can offer "switch volunteer"
      // without asking anyone to scan the code again.
      try {
        localStorage.setItem('hub.station', token);
      } catch {
        /* private mode; the link still works */
      }
      goto('/repairer');
    } catch (err: any) {
      error =
        err?.status === 404
          ? tNow('This volunteer link is not valid. Ask the organiser for the current one.')
          : err?.message ?? tNow('Could not open the queue. Try again.');
      busyId = '';
    }
  }

  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  $: eventDate = data?.event
    ? new Date(`${data.event.date}T12:00:00`).toLocaleDateString($locale === 'fr' ? 'fr-FR' : 'en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    : '';
</script>

<main class="min-h-screen bg-slate-100 px-4 py-10">
  <div class="fixed top-3 right-3 z-40"><LanguageSwitch /></div>
  <div class="max-w-lg mx-auto">
    <div class="card p-6">
      <div class="flex items-center gap-3">
        <span class="h-11 w-11 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0"><Wrench size={22} /></span>
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">{$t('Volunteer station')}</p>
          <h1 class="text-xl font-semibold truncate">{data?.cafeName ?? ''}</h1>
        </div>
      </div>

      {#if data?.event}
        <p class="mt-4 text-sm text-slate-600">
          {$t('Current session: {name}', { name: data.event.name })} · {eventDate}
        </p>
      {/if}

      <h2 class="mt-6 text-lg font-semibold">{$t('Who are you?')}</h2>
      <p class="mt-1 text-sm text-slate-600">{$t('Tap your name to open the repair queue. No password needed.')}</p>

      {#if loading}
        <p class="mt-5 text-slate-500">{$t('Loading…')}</p>
      {:else if error}
        <div class="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
        <button type="button" class="btn-secondary mt-4" on:click={load}>{$t('Try again')}</button>
      {:else if !data?.users.length}
        <p class="mt-5 text-slate-500">{$t('No volunteers are in the hub yet. Ask an organiser to add the team.')}</p>
      {:else}
        <div class="mt-4 grid gap-2">
          {#each data.users as u (u.id)}
            <button
              type="button"
              class="w-full flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left ring-1 ring-slate-200 bg-white hover:bg-slate-50 transition disabled:opacity-60"
              disabled={busyId !== ''}
              on:click={() => choose(u)}
            >
              <span class="font-medium text-slate-900">{u.displayName}</span>
              <span class="text-sm text-slate-500 flex items-center gap-1 shrink-0">
                {busyId === u.id ? $t('Opening…') : $t('Open the queue')} <ArrowRight size={16} />
              </span>
            </button>
          {/each}
        </div>
      {/if}

      <p class="mt-6 text-center text-xs text-slate-400">
        <a href="/login" class="underline underline-offset-2 hover:text-slate-600">{$t('Organiser? Sign in with a password')}</a>
      </p>
    </div>
  </div>
</main>
