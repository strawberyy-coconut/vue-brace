<script setup lang="ts">
import { ref } from 'vue'
import Explodes from './Explodes.vue'

const boom = ref(true)
const retries = ref(0)

function retryFailing(reset: () => void) {
  boom.value = false
  retries.value += 1
  reset()
}
</script>

<template lang="brace">
@try {
  <Explodes :should-throw="boom" />
} @catch (e, reset) {
  <p data-test="catch">{{ e.message }}</p>
  <button data-test="retry" @click="retryFailing(reset)">retry</button>
}
<p data-test="retries">{{ retries }}</p>
</template>
