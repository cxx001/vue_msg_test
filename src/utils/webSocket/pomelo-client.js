import utils from '@/utils/utils';
import Protocol from './protocol';
import Protobuf from './protobuf';

const EventEmitter = require('events').EventEmitter;
const Package = Protocol.Package;
const Message = Protocol.Message;
const JS_WS_CLIENT_TYPE = 'js-websocket';
const JS_WS_CLIENT_VERSION = '0.0.1';
const RES_OK = 200;
const RES_OLD_CLIENT = 501;

class PomeloClient extends EventEmitter {
    constructor() {
        super();
        this.disconnectCb = null;
        this.socket = null;
        this.reqId = 0;
        this.callbacks = {};
        this.handlers = {};
        this.routeMap = {};

        this.heartbeatInterval = 5000;
        this.heartbeatTimeout = this.heartbeatInterval * 2;
        this.nextHeartbeatTimeout = 0;
        this.gapThreshold = 100; // heartbeat gap threshold
        this.heartbeatId = null;
        this.heartbeatTimeoutId = null;
        this.handshakeCallback = null;

        this.handshakeBuffer = {
            'sys': {
                type: JS_WS_CLIENT_TYPE,
                version: JS_WS_CLIENT_VERSION
            },
            'user': {}
        };
        this.initCallback = null;

        this.handlers[Package.TYPE_HANDSHAKE] = this._handshake.bind(this);
        this.handlers[Package.TYPE_HEARTBEAT] = this._heartbeat.bind(this);
        this.handlers[Package.TYPE_DATA] = this._onData.bind(this);
        this.handlers[Package.TYPE_KICK] = this._onKick.bind(this);
    }

    /**
     * 
     * @param {host,port,user} params 
     * @param {*} cb 
     * @returns 
     */
    async init(params, cb) {
        if (cb === undefined) {
            let p0 = new Promise((resolve, reject) => {
                let callback = (data) => {
                    resolve(true);
                };
                this._init(params, callback);
            });
            let p1 = utils.sleep(10 * 1000);
            let r = await Promise.race([p0, p1]);
            if (r) {
                return r;
            }
            else {
                console.error('websocket init timeout:' + params);
                throw err;
            }
        } else {
            this._init(params, cb);
        }
    }

    _init(params, cb) {
        this.initCallback = cb;
        let host = params.host;
        let port = params.port;
        let url = 'ws://' + host;
        if (port) {
            url += ':' + port;
        }

        console.info('init websocket');
        this.handshakeBuffer.user = params.user;
        this.handshakeCallback = params.handshakeCallback;
        this._initWebSocket(url);
    }

    _initWebSocket(url) {
        console.info("=====" + url);
        let onopen = (event) => {
            console.info("===onopen");
            let obj = Package.encode(Package.TYPE_HANDSHAKE, Protocol.strencode(JSON.stringify(this.handshakeBuffer)));
            this._send(obj);
        };
        let onmessage = (data) => {
            console.info("===onmessage");
            this._processPackage(Package.decode(data));
            // new package arrived, update the heartbeat timeout
            if (this.heartbeatTimeout) {
                this.nextHeartbeatTimeout = Date.now() + this.heartbeatTimeout;
            }
        };
        let onerror = (event) => {
            console.info("===onerror" + event);
            this.emit('io-error', event);
        };
        let onclose = (event) => {
            console.info("===onclose");
            this.emit('close', event);
            let disconnectCb = this.disconnectCb;
            disconnectCb && disconnectCb();
            this.disconnectCb = null;
            this.removeAllListeners();
        };
        this.socket = new WebSocket(url);
        this.socket.binaryType = 'arraybuffer';

        this.socket.onopen = onopen;
        this.socket.onmessage = onmessage;
        this.socket.onerror = onerror;
        this.socket.onclose = onclose;

        // this.socket.on("open", onopen);
        // this.socket.on("close", onclose);
        // this.socket.on("error", onerror);
        // this.socket.on("message", onmessage);
    };

    _disconnect(cb) {
        this.disconnectCb = null;
        if (this.socket) {
            this.disconnectCb = cb;

            if (this.socket.disconnect) this.socket.disconnect();
            if (this.socket.close) this.socket.close();
            console.info('===disconnect.');
            this.socket = null;
        }

        if (this.heartbeatId) {
            clearTimeout(this.heartbeatId);
            this.heartbeatId = null;
        }
        if (this.heartbeatTimeoutId) {
            clearTimeout(this.heartbeatTimeoutId);
            this.heartbeatTimeoutId = null;
        }
    };
    async disconnect(cb) {
        if (cb === undefined) {
            let p0 = new Promise((resolve, reject) => {
                let callback = (data) => {
                    resolve(true);
                };
                this._disconnect(callback);
            });
            let p1 = utils.sleep(10 * 1000);
            let r = await Promise.race([p0, p1]);
            if (r) {
                return r;
            }
            else {
                let err = 'pomelo disconnect timeout';
                logger.error(err);
                throw err;
            }
        } else {
            this._disconnect(cb);
        }
    };

    _request(route, msg, cb) {
        msg = msg || {};
        route = route || msg.route;
        if (!route) {
            console.info('===fail to send request without route.');
            return;
        }
        this.reqId++;
        this._sendMessage(this.reqId, route, msg);
        this.callbacks[this.reqId] = cb;
        this.routeMap[this.reqId] = route;
    };
    async request(route, msg, cb) {
        if (cb === undefined) {
            let p0 = new Promise((resolve, reject) => {
                let callback = (data) => {
                    resolve(data);
                };
                this._request(route, msg, callback);
            });
            let p1 = utils.sleep(8 * 1000);
            let r = await Promise.race([p0, p1]);
            if (r) {
                return r;
            }
            else {
                let err = 'pomelo request timeout:' + route + ':' + msg;
                console.error(err);
                throw err;
            }
        } else {
            this._request(route, msg, cb);
        }
    }
    notify(route, msg) {
        msg = msg || {};
        this._sendMessage(0, route, msg);
    };
    _sendMessage(reqId, route, msg) {
        console.info("@@@send:", route, JSON.stringify(msg));
        var type = reqId ? Message.TYPE_REQUEST : Message.TYPE_NOTIFY;
        //compress message by protobuf
        var protos = !!this.data.protos ? this.data.protos.client : {};
        if (!!protos[route]) {
            msg = Protobuf.encode(route, msg);
        } else {
            msg = Protocol.strencode(JSON.stringify(msg));
        }

        var compressRoute = 0;
        if (this.dict && this.dict[route]) {
            route = this.dict[route];
            compressRoute = 1;
        }
        msg = Message.encode(reqId, type, compressRoute, route, msg);
        var packet = Package.encode(Package.TYPE_DATA, msg);
        this._send(packet);
    };

    _send(packet) {
        if (this.socket) {
            this.socket.send(packet.buffer || packet, { binary: true, mask: true });
        }
    };

    _heartbeat(data) {
        var obj = Package.encode(Package.TYPE_HEARTBEAT);
        if (this.heartbeatTimeoutId) {
            clearTimeout(this.heartbeatTimeoutId);
            this.heartbeatTimeoutId = null;
        }

        if (this.heartbeatId) {
            // already in a heartbeat interval
            return;
        }
        this.heartbeatId = setTimeout(() => {
            this.heartbeatId = null;
            this._send(obj);
            this.nextHeartbeatTimeout = Date.now() + this.heartbeatTimeout;
            this.heartbeatTimeoutId = setTimeout(this._heartbeatTimeoutCb.bind(this), this.heartbeatTimeout);
        }, this.heartbeatInterval);
    };
    _heartbeatTimeoutCb() {
        var gap = this.nextHeartbeatTimeout - Date.now();
        if (gap > this.gapThreshold) {
            this.heartbeatTimeoutId = setTimeout(this._heartbeatTimeoutCb.bind(this), gap);
        } else {
            console.error('server heartbeat timeout');
            this.emit('heartbeat timeout');
            this._disconnect();
        }
    };
    _handshake(data) {
        data = JSON.parse(Protocol.strdecode(data));
        if (data.code === RES_OLD_CLIENT) {
            console.error('error', 'client version not fullfill');
            this.emit('error', 'client version not fullfill');
            return;
        }

        if (data.code !== RES_OK) {
            console.error('error', 'handshake fail');
            this.emit('error', 'handshake fail');
            return;
        }
        this._handshakeInit(data);
        var obj = Package.encode(Package.TYPE_HANDSHAKE_ACK);
        this._send(obj);
        if (this.initCallback) {
            this.initCallback(this.socket);
            this.initCallback = null;
        }
    };
    _onData(data) {
        //probuff decode
        var msg = Message.decode(data);
        if (msg.id > 0) {
            msg.route = this.routeMap[msg.id];
            delete this.routeMap[msg.id];
            if (!msg.route) {
                return;
            }
        }
        msg.body = this._deCompose(msg);
        this._processMessage(msg);
    };
    _onKick(data) {
        console.log('onKick');
        this.emit('onKick');
    };
    _processPackage(msgs) {
        if (Array.isArray(msgs)) {
            for (var i = 0; i < msgs.length; i++) {
                var msg = msgs[i];
                this.handlers[msg.type](msg.body);
            }
        } else {
            this.handlers[msgs.type](msgs.body);
        }
    };
    _processMessage(msg) {
        if (!msg || !msg.id) {
            // server push message
            console.info("x~~push_msg:", msg.route, msg.body);//, JSON.stringify(msg.body)); 
            this.emit(msg.route, msg.body);
            return;
        }

        console.info("--resp_msg:", this.routeMap[msg.id], JSON.stringify(msg.route), JSON.stringify(msg.body));

        //if have a id then find the callback function with the request
        var cb = this.callbacks[msg.id];
        delete this.callbacks[msg.id];
        if (typeof cb !== 'function') {
            return;
        }
        cb(msg.body);
        return;
    };
    /*processMessageBatch  ( msgs) {
        for (var i = 0, l = msgs.length; i < l; i++) {
            this.processMessage( msgs[i]);
        }
    }; */
    _deCompose(msg) {
        var protos = !!this.data.protos ? this.data.protos.server : {};
        var abbrs = this.data.abbrs;
        var route = msg.route;
        try {
            //Decompose route from dict
            if (msg.compressRoute) {
                if (!abbrs[route]) {
                    console.error('illegal msg!');
                    return {};
                }
                route = msg.route = abbrs[route];
            }
            if (!!protos[route]) {
                return Protobuf.decode(route, msg.body);
            } else {
                return JSON.parse(Protocol.strdecode(msg.body));
            }
        } catch (ex) {
            console.error('route, body = ' + route + ", " + msg.body);
        }
        return msg;
    };
    _handshakeInit(data) {
        if (data.sys && data.sys.heartbeat) {
            this.heartbeatInterval = data.sys.heartbeat * 1000;  // heartbeat interval
            this.heartbeatTimeout = this.heartbeatInterval * 2; // max heartbeat timeout
        } else {
            this.heartbeatInterval = 0;
            this.heartbeatTimeout = 0;
        }
        this._initData(data);
        let handshakeCallback = this.handshakeCallback;
        if (typeof handshakeCallback === 'function') {
            handshakeCallback(data.user);
        }
    };
    _initData(data) {
        if (!data || !data.sys) {
            return;
        }
        this.data = this.data || {};
        var dict = data.sys.dict;
        var protos = data.sys.protos;
        //Init compress dict
        if (!!dict) {
            this.data.dict = dict;
            this.data.abbrs = {};
            for (var route in dict) {
                this.data.abbrs[dict[route]] = route;
            }
        }
        //Init protobuf protos
        if (protos) {
            this.data.protos = {
                server: protos.server || {},
                client: protos.client || {}
            };
            if (Protobuf) {
                Protobuf.init({ encoderProtos: protos.client, decoderProtos: protos.server });
            }
        }
    };
}

export default PomeloClient;
