<script setup lang="ts">
import { ref } from 'vue'

const tag = ref<'section' | 'article'>('section')
defineExpose({ tag })
</script>

<template lang="brace">
<{tag} data-test="panel">
  // this comment must not become visible text
  <p data-test="inner">inner</p>
</{tag}>
</template>
