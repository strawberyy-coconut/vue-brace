<script setup lang="ts">
const props = defineProps<{ shouldThrow: boolean }>()

if (props.shouldThrow) {
  throw new Error('boom')
}
</script>

<template>
  <p data-test="ok">fine</p>
</template>
