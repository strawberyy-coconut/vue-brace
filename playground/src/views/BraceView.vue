<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import FragileChild from '@/components/FragileChild.vue'
import ChartPanel from '@/components/ChartPanel.vue'

type Status = 'loading' | 'success' | 'error'

const status = ref<Status>('success')
const tag = ref<'section' | 'article'>('section')
const fragile = ref(true)
const attempts = ref(0)

const items = ref([
  { id: 1, title: 'Ginsu', price: 12 },
  { id: 2, title: 'Cleaver', price: 30 },
])

// Resolves late so `@pending` has something to show.
const AsyncChart = defineAsyncComponent(
  () => new Promise<typeof ChartPanel>((resolve) => setTimeout(() => resolve(ChartPanel), 800)),
)

/** `retry` comes from the `@catch (e, retry)` slot prop. */
function retryFragile(retry: () => void) {
  fragile.value = false
  attempts.value += 1
  retry()
}
</script>

<template lang="brace">
<section class="brace-demo">
  <h1><code>lang="brace"</code></h1>

  <p class="controls">
    <button type="button" @click="status = 'loading'">loading</button>
    <button type="button" @click="status = 'success'">success</button>
    <button type="button" @click="status = 'error'">error</button>
    <button type="button" @click="items = []">clear items</button>
    <button type="button" @click="items = [{ id: 3, title: 'New', price: 5 }]">one item</button>
    <button type="button" @click="tag = tag === 'section' ? 'article' : 'section'">swap tag</button>
  </p>

  <h2>@if · @else if · @else · @for · @empty</h2>
  @if (status === 'loading') {
    <p class="muted">Loading…</p>
  } @else if (status === 'error') {
    <p class="err">Something went wrong.</p>
  } @else {
    <ul class="list">
      @for (item of items; index i; key item.id) {
        <li class="row">{{ i + 1 }} · {{ item.title }} — {{ item.price }}</li>
      } @empty {
        <li class="row muted">Sold out</li>
      }
    </ul>
  }

  <h2>@switch</h2>
  @switch (status) {
    @case 'loading': {
      <p class="muted">Switching: still loading…</p>
    }
    @case 'success': {
      <p class="ok">Switching: done</p>
    }
    @default: {
      <p>Switching: unknown status.</p>
    }
  }

  <h2>@try · @catch</h2>
  @try {
    <FragileChild :should-throw="fragile" />
  } @catch (e, retry) {
    <p class="err">{{ e.message }}</p>
    <button type="button" @click="retryFragile(retry)">Try again</button>
  }
  <p class="muted">retries: {{ attempts }}</p>

  <h2>@try · @pending</h2>
  @try {
    <AsyncChart :count="items.length" />
  } @pending {
    <p class="muted">Loading chart…</p>
  }

  <h2>dynamic tags · comments</h2>
  <{tag} class="panel">
    // This tag name comes from a ref, not from markup.
    <p>Rendered as &lt;{{ tag }}&gt;.</p>
  </{tag}>
</section>
</template>

<style scoped>
.brace-demo {
  max-width: 40rem;
  margin: 0 auto;
  padding: 1rem;
  text-align: left;
}

h2 {
  font-size: 1rem;
  margin-top: 2rem;
  border-bottom: 1px solid var(--color-border);
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.list {
  list-style: none;
  padding: 0;
}

.row {
  border-bottom: 1px solid var(--color-border);
}

.panel {
  border: 1px dashed var(--color-border);
  padding: 0.5rem 1rem;
}

.muted {
  color: var(--color-text);
  opacity: 0.7;
}

.err {
  color: #c0392b;
}

.ok {
  color: #1e8449;
}
</style>
