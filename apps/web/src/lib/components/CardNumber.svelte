<script lang="ts">
  // The number on the card handed to the visitor, shown beside the job number
  // wherever a repair is listed. Cafes that do not use cards have no number,
  // and then this draws nothing.
  import { t } from '$lib/i18n';

  export let number: number | null | undefined = null;
</script>

{#if number != null}
  <span
    class="inline-flex items-center whitespace-nowrap rounded-md bg-sky-100 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-sky-800 align-middle"
    title={$t('Card number')}
  >{$t('Card {n}', { n: number })}</span>
{/if}
