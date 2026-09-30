import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginOxlint from 'eslint-plugin-oxlint'
import skipFormatting from 'eslint-config-prettier/flat'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    name: 'app/brace-template',
    // `lang="brace"` is invisible to `vue-eslint-parser`, which falls back to parsing the
    // raw brace text as HTML. No template node registers a usage, so `no-unused-vars`
    // fires for every binding the template consumes, and `eslint-plugin-vue`'s template
    // rules can never fire. The proper fix is a processor that runs the brace transform
    // (which is line-preserving) before parsing, so rules see real directives with
    // correct line numbers; until then these files opt out.
    files: ['src/views/BraceView.vue', 'src/__tests__/**'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'vue/multi-word-component-names': 'off',
    },
  },

  ...pluginOxlint.buildFromOxlintConfigFile('.oxlintrc.json'),

  skipFormatting,
)
