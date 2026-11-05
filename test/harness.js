/**
 * Loads the core scripts as browser-like globals, with an in-memory mqtt client.
 * No dependencies and no broker needed.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EventEmitter = require('events');

const CORE_PATH = path.join(__dirname, '..', 'src', 'automato', 'core');
const CORE_SCRIPTS = ['utils.js', 'mqtt.js', 'notifications.js', 'scripting_js.js', 'system.js'];

class FakeMqttClient extends EventEmitter {
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.published = [];
    this.subscribed = [];
    this.ended = false;
    this.reconnected = 0;
  }
  // Same signature of mqtt.js, and same failure if options is not an object
  publish(topic, message, options, callback) {
    if (options !== undefined && (typeof options != 'object' || options === null))
      throw new Error('mqtt.js publish() wants an options object, got: ' + options);
    if (callback !== undefined && typeof callback != 'function')
      throw new Error('mqtt.js publish() wants a callback function, got: ' + callback);
    this.published.push({ topic: topic, payload: message, qos: options ? options.qos : undefined, retain: options ? options.retain : undefined });
  }
  subscribe(topic) {
    this.subscribed.push(topic);
  }
  end(force, callback) {
    this.ended = true;
    this.emit('close');
    if (callback)
      callback();
  }
  reconnect() {
    this.reconnected ++;
  }
  // Test helpers
  brokerConnects() {
    this.emit('connect', {});
  }
  brokerCloses() {
    this.emit('close');
  }
  brokerReconnecting() {
    this.emit('reconnect');
  }
  brokerSends(topic, payload, retain = false) {
    this.emit('message', topic, Buffer.from(payload), { retain: retain, qos: 0 });
  }
}

// Core scripts are global scripts: they are loaded once in the main context (objects created by tests must be seen as dict by isinstance)
let loaded = false;
const realConsole = console;

function createContext() {
  global.logs = { error: [], warn: [] };
  global.clients = [];
  global.window = global;
  global.console = Object.assign(Object.create(realConsole), {
    debug() {}, info() {}, log() {},
    warn() { global.logs.warn.push(Array.from(arguments).map(String).join(' ')); },
    error() { global.logs.error.push(Array.from(arguments).map(String).join(' ')); },
  });
  global.mqtt = {
    connect(url, options) {
      let client = new FakeMqttClient(url, options);
      global.clients.push(client);
      return client;
    },
  };
  if (!loaded) {
    for (let script of CORE_SCRIPTS)
      vm.runInThisContext(fs.readFileSync(path.join(CORE_PATH, script), 'utf8'), { filename: script });
    loaded = true;
  }
  return global;
}

/**
 * Boot a system as the browser client does (its entries are remote: they are not on the "client" node)
 */
function bootSystem(definitions = {}, config = {}) {
  let context = createContext();
  let system = new context.AutomatoSystem({});
  system.set_config(Object.assign({ 'name': 'client', 'listen_all_events': true, 'mqtt': {} }, config));
  system.boot();
  system.init(function() {});
  let client = context.clients[0];
  client.brokerConnects();
  if (Object.keys(definitions).length)
    system.entry_load(definitions, false, false, false);
  return {
    context: context,
    system: system,
    client: client,
    logs: context.logs,
    receive(topic, payload, retain = false) {
      system._on_mqtt_message(topic, payload, system.broker()._decodePayload(payload), 0, retain, null, system.timems());
    },
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { createContext, bootSystem, sleep, FakeMqttClient, realConsole };
