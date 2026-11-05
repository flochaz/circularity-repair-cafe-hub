<script lang="ts">
  // A compact French / English switch. The choice goes into a cookie so the
  // server renders the next request in the same language, then the page reloads
  // so server-rendered text (and <html lang>) change too.
  import { locale, t } from '$lib/i18n';
  import { Languages } from 'lucide-svelte';

  function choose(next: 'fr' | 'en'): void {
    if ($locale === next) return;
    document.cookie = `lang=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    window.location.reload();
  }
</script>

<div
  class="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 text-xs"
  role="group"
  aria-label={$t('Language')}
>
  <Languages size={14} class="ml-1 text-slate-400" aria-hidden="true" />
  <button
    type="button"
    class="rounded-md px-2 py-1 font-semibold {$locale === 'fr' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}"
    aria-pressed={$locale === 'fr'}
    on:click={() => choose('fr')}
  >FR</button>
  <button
    type="button"
    class="rounded-md px-2 py-1 font-semibold {$locale === 'en' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}"
    aria-pressed={$locale === 'en'}
    on:click={() => choose('en')}
  >EN</button>
</div>
