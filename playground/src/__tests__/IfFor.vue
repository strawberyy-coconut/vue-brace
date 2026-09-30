<script setup lang="ts">
interface Item {
  id: number
  title: string
}

defineProps<{
  status: 'loading' | 'error' | 'success'
  items: Item[]
}>()
</script>

<template lang="brace">
@if (status === 'loading') {
  <p data-test="loading">Loading…</p>
} @else if (status === 'error') {
  <p data-test="error">Something went wrong.</p>
} @else {
  <ul data-test="list">
    @for (item of items; index i; key item.id) {
      <li :data-test="`row-${item.id}`">{{ i + 1 }} · {{ item.title }}</li>
    } @empty {
      <li data-test="empty">Sold out</li>
    }
  </ul>
}
</template>
