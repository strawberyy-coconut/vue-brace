<script setup lang="ts">
defineProps<{ status: string }>()
</script>

<template lang="brace">
@switch (status) {
  @case 'loading': {
    <p data-test="loading">loading</p>
  }
  @case 'success': {
    <p data-test="success">success</p>
  }
  @default: {
    <p data-test="default">unknown</p>
  }
}
</template>
