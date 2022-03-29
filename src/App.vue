<template>
  <div>
    <button @click="onLogin">登录</button><br /><br />
    <form>
      <input
        type="text"
        name="inputname"
        ref="inputref"
        value=""
        style="width: 500px"
      />
    </form><br />
    <textarea rows="10" cols="30" style="width: 500px"  v-model="notedata"> </textarea><br />
    <button @click="onSend">发送</button>
  </div>
</template>

<script>
export default {
  data() {
    return {
      host: "127.0.0.1",
      port: 8686,
      pomelo: null,
      notedata: ''
    };
  },
  methods: {
    async onLogin() {
      this.pomelo = new this.$PomeloClient();
      await this.pomelo
        .init({ host: this.host, port: this.port })
        .then(() => {
          // 获取逻辑服 地址
          return this.pomelo.request("gate.gateHandler.queryEntry", {
            code: "test",
          });
        })
        .then((data) => {
          if (data.code == 202) {
            throw "服务器维护中";
          }
          this.host = data.host;
          this.port = data.port;
          return this.pomelo.disconnect();
        })
        .then(() => {
          //connenct 逻辑服
          this.pomelo = new this.$PomeloClient();
          return this.pomelo.init({ host: this.host, port: this.port });
        })
        .then(() => {
          //login
          let userInfo = {
            account: "test",
            password: "123456",
          };
          return this.pomelo.request("connector.entryHandler.enter", {
            code: "test",
            userInfo: userInfo,
            platform: "win",
          });
        })
        .then(async (data) => {
          if (data.code == 201) {
            console.log("重连 host:%s port:%s", data.host, data.port);
            // 重定向
            await this.pomelo.disconnect();
            throw "重新登入";
          } else if (data.code == 200) {
            console.log("连接逻辑服成功 info: ", data.info);
          } else {
            throw null;
          }
        })
        .catch((err) => {
          console.error("createConnect err: " + err);
        });
    },

    onSend() {
      let msgname = this.$refs.inputref.value;
      // let msgparam = this.notedata;
      let msgparam = JSON.parse(this.notedata);
      this.pomelo.request(msgname, msgparam);
    },
  },
};
</script>

<style scoped>
</style>
