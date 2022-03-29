<template>
  <div>
    <button @click="onClick">click</button>
  </div>
</template>

<script>
export default {
  data() {
    return {
      host: "127.0.0.1",
      port: 8686,
    };
  },
  methods: {
    async onClick() {
      let pomelo = new this.$PomeloClient();
      await pomelo
        .init({ host: this.host, port: this.port })
        .then(() => {
          // 获取逻辑服 地址
          return pomelo.request("gate.gateHandler.queryEntry", { code: "123" });
        })
        .then((data) => {
          if (data.code == 202) {
            throw "服务器维护中";
          }
          this.host = data.host;
          this.port = data.port;
          return pomelo.disconnect();
        })
        .then(() => {
          //connenct 逻辑服
          pomelo = new this.$PomeloClient();
          return pomelo.init({ host: this.host, port: this.port });
        })
        .then(() => {
          //login
          let userInfo = {
            name: "123",
            avatarUrl: "",
            gender: 1,
          };
          return pomelo.request("connector.entryHandler.enter", {
            code: "123",
            userInfo: userInfo,
            platform: "win",
          });
        })
        .then(async (data) => {
          if (data.code == 201) {
            console.log("重连 host:%s port:%s", data.host, data.port);
            // 重定向
            await pomelo.disconnect();
            throw "重新登入";
          } else if (data.code == 200) {
            console.log("连接逻辑服成功 info: ", data.info);

            // 服务端主动推送消息
            pomelo.on("onTest", (data) => {
              console.log("server push: ", data);
            });
          } else {
            throw null;
          }
        })
        .catch((err) => {
          console.error("createConnect err: " + err);
        });
    },
  },
};
</script>

<style scoped>
</style>
