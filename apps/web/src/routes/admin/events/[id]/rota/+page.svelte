<script lang="ts">
  // The organiser's side of the sign-up board: set the roles, share the link or
  // QR, watch who answered, and close it when the session is full.
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { auth } from '$lib/stores/auth';
  import { get } from 'svelte/store';
  import { ArrowLeft, Copy, Plus, Trash2, Download, Loader2, Lock, Unlock, ExternalLink } from 'lucide-svelte';

  $: id = $page.params.id;

  interface Role {
    id: string;
    label: string;
    capacity: number | null;
    sortOrder: number;
  }
  interface Signup {
    id: string;
    name: string;
    comment: string | null;
    choices: Record<string, string>;
  }
  interface Board {
    event: { id: string; name: string; date: string; startTime: string; endTime: string };
    open: boolean;
    roles: Role[];
    signups: Signup[];
    summary: Record<string, { yes: number; ifNeeded: number; no: number }>;
    shareUrl: string | null;
    signupToken: string | null;
  }

  let board: Board | null = null;
  let busy = false;
  let error = '';
  let copied = false;
  let newRole = '';

  async function load(): Promise<void> {
    error = '';
    try {
      board = await api<Board>(`/api/admin/events/${id}/rota`);
    } catch (err) {
      error = (err as Error)?.message || 'Could not load the sign-up board';
    }
  }
  onMount(load);

  async function toggleOpen(open: boolean): Promise<void> {
    busy = true;
    error = '';
    try {
      board = await api<Board>(`/api/admin/events/${id}/rota/open`, { method: 'POST', json: { open } });
    } catch (err) {
      error = (err as Error)?.message || 'Could not change the sign-up';
    } finally {
      busy = false;
    }
  }

  async function addRole(): Promise<void> {
    if (!newRole.trim()) return;
    busy = true;
    error = '';
    try {
      await api(`/api/admin/events/${id}/rota/roles`, { method: 'POST', json: { label: newRole.trim() } });
      newRole = '';
      await load();
    } catch (err) {
      error = (err as Error)?.message || 'Could not add that role';
    } finally {
      busy = false;
    }
  }

  async function saveRole(role: Role, patch: { label?: string; capacity?: number | null }): Promise<void> {
    try {
      await api(`/api/admin/events/${id}/rota/roles/${role.id}`, { method: 'PATCH', json: patch });
      await load();
    } catch (err) {
      error = (err as Error)?.message || 'Could not save that role';
    }
  }

  async function removeRole(role: Role): Promise<void> {
    if (!confirm(`Remove the role “${role.label}”? Everyone's answer for it goes too.`)) return;
    busy = true;
    try {
      await api(`/api/admin/events/${id}/rota/roles/${role.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      error = (err as Error)?.message || 'Could not remove that role';
    } finally {
      busy = false;
    }
  }

  async function removeSignup(signup: Signup): Promise<void> {
    if (!confirm(`Remove ${signup.name}'s answer?`)) return;
    busy = true;
    try {
      await api(`/api/admin/events/${id}/rota/signups/${signup.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      error = (err as Error)?.message || 'Could not remove that answer';
    } finally {
      busy = false;
    }
  }

  async function copyLink(): Promise<void> {
    if (!board?.shareUrl) return;
    try {
      await navigator.clipboard.writeText(board.shareUrl);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      /* clipboard may be blocked; the field can be selected by hand */
    }
  }

  async function exportCsv(): Promise<void> {
    const token = get(auth)?.accessToken;
    const res = await fetch(`/api/admin/events/${id}/rota/export.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    if (!res.ok) {
      error = 'Could not export the CSV';
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rota-${board?.event.date ?? 'session'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function cell(choice: string | undefined): string {
    return choice === 'yes' ? 'Oui' : choice === 'if_needed' ? 'Si besoin' : choice === 'no' ? 'Non' : '';
  }
  function cellClass(choice: string | undefined): string {
    if (choice === 'yes') return 'text-emerald-700 font-semibold';
    if (choice === 'if_needed') return 'text-amber-600';
    if (choice === 'no') return 'text-slate-400';
    return 'text-slate-300';
  }
</script>

<div class="mx-auto max-w-5xl p-4">
  <a href={`/admin/events/${id}`} class="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
    <ArrowLeft size={15} /> Back to the session
  </a>

  <h1 class="text-2xl font-semibold">Volunteer sign-up</h1>
  {#if board}
    <p class="mt-1 text-slate-600">
      {board.event.name} · {board.event.date} · {board.event.startTime.slice(0, 5)}–{board.event.endTime.slice(0, 5)}
    </p>
  {/if}

  {#if error}<p class="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>{/if}

  {#if !board}
    <div class="card mt-4 p-8 text-center text-slate-500"><Loader2 class="mx-auto animate-spin" size={20} /></div>
  {:else if !board.signupToken}
    <div class="card mt-4 p-6">
      <h2 class="font-semibold">Not open yet</h2>
      <p class="mt-1 text-sm text-slate-600">
        Open the sign-up and volunteers get one link to answer. The usual roles
        (accueil, installation, réparation, couture, navette, gâteau, sortie) are added for you —
        edit them afterwards.
      </p>
      <button class="btn-primary mt-4" disabled={busy} on:click={() => toggleOpen(true)}>
        <Unlock size={16} /> Open the sign-up
      </button>
    </div>
  {:else}
    <div class="card mt-4 p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="inline-flex items-center gap-2 text-sm font-medium {board.open ? 'text-emerald-700' : 'text-slate-500'}">
          {#if board.open}<Unlock size={15} /> Sign-up is open{:else}<Lock size={15} /> Sign-up is closed{/if}
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="btn-ghost" disabled={busy} on:click={() => toggleOpen(!(board?.open ?? false))}>
            {#if board.open}<Lock size={15} /> Close{/if}{#if !board.open}<Unlock size={15} /> Reopen{/if}
          </button>
          <button class="btn-ghost" on:click={exportCsv}><Download size={15} /> Export CSV</button>
        </div>
      </div>

      {#if board.shareUrl}
        <div class="mt-4 grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <label class="label" for="share">Share this link</label>
            <div class="flex gap-2">
              <input id="share" class="input" readonly value={board.shareUrl} on:focus={(e) => e.currentTarget.select()} />
              <button class="btn-ghost" type="button" on:click={copyLink}><Copy size={15} /> {copied ? 'Copied' : 'Copy'}</button>
            </div>
            <a href={board.shareUrl} target="_blank" rel="noopener noreferrer" class="mt-2 inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline">
              <ExternalLink size={14} /> Open the volunteer page
            </a>
          </div>
          {#if board.signupToken}
            <img src={`/api/rota/${board.signupToken}/qr.png`} alt="QR code for the sign-up" class="h-32 w-32 rounded-lg border border-slate-200" />
          {/if}
        </div>
      {/if}
    </div>

    <!-- Roles -->
    <section class="card mt-4 p-5">
      <h2 class="font-semibold">Roles</h2>
      <div class="mt-3 space-y-2">
        {#each board.roles as role (role.id)}
          <div class="flex items-center gap-2">
            <input
              class="input flex-1"
              value={role.label}
              on:blur={(e) => e.currentTarget.value.trim() && e.currentTarget.value !== role.label && saveRole(role, { label: e.currentTarget.value.trim() })}
            />
            <input
              class="input w-20"
              type="number"
              min="0"
              max="99"
              placeholder="—"
              value={role.capacity ?? ''}
              on:blur={(e) => {
                const v = e.currentTarget.value === '' ? null : Number(e.currentTarget.value);
                if (v !== role.capacity) saveRole(role, { capacity: v });
              }}
            />
            <button class="btn-ghost text-rose-600" type="button" title="Remove role" on:click={() => removeRole(role)}>
              <Trash2 size={15} />
            </button>
          </div>
        {/each}
      </div>
      <div class="mt-3 flex gap-2">
        <input class="input flex-1" placeholder="Add a role…" bind:value={newRole} on:keydown={(e) => e.key === 'Enter' && addRole()} />
        <button class="btn-ghost" type="button" disabled={busy} on:click={addRole}><Plus size={15} /> Add</button>
      </div>
      <p class="mt-2 text-xs text-slate-500">The number is how many helpers the role wants. Leave it empty for “as many as turn up”.</p>
    </section>

    <!-- Answers -->
    <section class="card mt-4 overflow-x-auto p-5">
      <h2 class="font-semibold">Who answered ({board.signups.length})</h2>
      {#if board.signups.length === 0}
        <p class="mt-2 text-sm text-slate-500">Nobody has answered yet. Share the link above.</p>
      {:else}
        <table class="mt-3 w-full text-sm">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-slate-400">
              <th class="py-2 pr-3">Name</th>
              {#each board.roles as role (role.id)}<th class="px-2 py-2">{role.label}</th>{/each}
              <th class="py-2 pl-3">Comment</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each board.signups as signup (signup.id)}
              <tr class="border-t border-slate-100">
                <td class="py-2 pr-3 font-medium text-slate-800">{signup.name}</td>
                {#each board.roles as role (role.id)}
                  <td class="px-2 py-2 {cellClass(signup.choices[role.id])}">{cell(signup.choices[role.id])}</td>
                {/each}
                <td class="py-2 pl-3 text-slate-500">{signup.comment ?? ''}</td>
                <td class="py-2 text-right">
                  <button class="text-slate-400 hover:text-rose-600" type="button" title="Remove" on:click={() => removeSignup(signup)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            {/each}
            <tr class="border-t border-slate-200 text-xs text-slate-500">
              <td class="py-2 pr-3">Need</td>
              {#each board.roles as role (role.id)}
                {@const count = board.summary[role.id] ?? { yes: 0, ifNeeded: 0, no: 0 }}
                <td class="px-2 py-2">
                  <span class="font-semibold text-emerald-700">{count.yes}</span>{#if count.ifNeeded}<span class="text-amber-600"> +{count.ifNeeded}</span>{/if}
                  {#if role.capacity}<span class="text-slate-400"> / {role.capacity}</span>{/if}
                </td>
              {/each}
              <td colspan="2"></td>
            </tr>
          </tbody>
        </table>
      {/if}
    </section>
  {/if}
</div>
