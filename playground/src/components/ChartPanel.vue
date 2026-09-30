<script setup lang="ts">
defineProps<{ count: number }>()
</script>

<template>
  <p class="ok">Chart rendered with {{ count }} data point(s).</p>
</template>
