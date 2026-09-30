<script setup lang="ts">
const props = defineProps<{ shouldThrow: boolean }>()

if (props.shouldThrow) {
  throw new Error('Fragile failed on purpose')
}
</script>

<template>
  <p class="ok">Fragile rendered successfully.</p>
</template>
