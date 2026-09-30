import './assets/main.css'

import { createApp } from 'vue'
import { installBrace } from '@vue-brace/brace-template'
import App from './App.vue'
import router from './router'

const app = createApp(App)

installBrace(app)
app.use(router)

app.mount('#app')
