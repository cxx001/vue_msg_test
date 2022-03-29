import Vue from 'vue'
import App from './App.vue'
import PomeloClient from './utils/webSocket/pomelo-client'

Vue.config.productionTip = false
Vue.prototype.$PomeloClient = PomeloClient;

new Vue({
  render: h => h(App),
}).$mount('#app')
