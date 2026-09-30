<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import Slow from './Slow.vue'

const Async = defineAsyncComponent(
  () => new Promise<typeof Slow>((resolve) => setTimeout(() => resolve(Slow), 20)),
)
</script>

<template lang="brace">
@try {
  <Async />
} @pending {
  <p data-test="pending">Loading…</p>
}
</template>
