# Using the JavaScript core

[Back to the project](../README.md)

## Loading

The files in `src/automato/core` are classic scripts: each one defines globals (`AutomatoSystem`, `AutomatoMqtt`, `AutomatoScriptingJs`, `AutomatoNotifications`, and the helpers of `utils.js` like `json_import`, `read_duration`, `b64_decompress_data`). Load them with `<script>` tags, after their dependencies:

| Dependency | Global | Used for |
|---|---|---|
| [MQTT.js](https://github.com/mqttjs/MQTT.js) | `mqtt` | The broker connection |
| [pako](https://github.com/nodeca/pako) | `pako` | zlib, for compressed metadata (`pako_inflate` is enough for a client) |

The order of the core scripts does not matter, since they only define functions; they must all be loaded before `new AutomatoSystem()`.

Expressions in definitions are run with `eval` and `new Function`: a page with a Content Security Policy must allow `'unsafe-eval'`.

A browser can reach the broker only through websockets: the broker needs a websocket listener (for Mosquitto, `listener 9001` with `protocol websockets`, or a TLS one behind a reverse proxy).

## Configuration

`set_config()` takes the same object as the Python core (see the [Python API](https://github.com/eric-void/automato-core-py/blob/master/docs/python-api.md#configuration)). In a client the useful keys are:

| Key | Description |
|---|---|
| `name` | Name of this client, the node part of local ids (a client usually has no local entries) |
| `entries` | Local definitions, usually `[]` |
| `listen_all_events` | `true`, so every event is computed: a client wants to show everything, and the cost stays in the browser |
| `mqtt` | Connection settings |

MQTT settings are the Python ones, plus `broker_protocol`:

| Key | Default | Description |
|---|---|---|
| `broker_protocol` | `mqtt` | `ws` or `wss` in a browser |
| `broker_host`, `broker_port` | `127.0.0.1`, `1883` | |
| `broker_user`, `broker_pass` | empty | Not sent when empty (brokers with anonymous access refuse empty credentials) |
| `client_id`, `client_id_random_postfix` | `automato-node`, `true` | |

## Loading definitions and events

A client has no definitions of its own: it gets them from the nodes. The master node answers `automato/data/get` with definitions and the last events; every node also publishes `automato/metadata` periodically. See the [MQTT protocol](https://github.com/eric-void/automato-core-py/blob/master/docs/mqtt-protocol.md).

```js
var system = new AutomatoSystem(this);
system.set_config({ 'name': 'my-page', 'listen_all_events': true, 'entries': [], 'mqtt': config_mqtt });
system.boot();

system.on_message(function(message) {
  let entries = null, events = null;
  if (message.topic == 'automato/data') {
    let data = '+' in message.payload ? b64_decompress_data(message.payload['+']) : message.payload;
    entries = data['entries'];
    events = data['events'];
  }
  if (message.topic == 'automato/metadata')
    entries = typeof message.payload['entries'] == 'string' ? b64_decompress_data(message.payload['entries']) : message.payload['entries'];
  if (entries)
    system.entry_load(entries, false, false, false);
  if (events)
    system.events_import(events);
});

system.on_all_events(function(entry, eventname, eventdata, caller, published_message) {
  // update the page
});

system.init(function() {
  system.broker().publish('automato/data/get', '');
});
```

Then:

```js
system.event_get('kitchen_light.output');                     // { value: 1, ... } or null
system.do_action('kitchen_light.output-set', { 'value': 0 });  // publishes the command
```

Things to handle in a real client (see [automato-http-client](https://github.com/eric-void/automato-http-client) for a complete one):

- **Cache**: saving definitions and `events_export()` in `localStorage` lets the page show the last state before the broker answers. Restore events with `events_import(data, -1)`, so they are marked as old.
- **Retained messages before definitions**: retained messages arrive right after the connection, often before `automato/data`. With no definitions they match no entry: keep them and process them again after `entry_load`.
- **No master**: `automato/data` is not retained. If no answer arrives, ask again later; the periodic `automato/metadata` is the fallback.

## Differences from Python

The browser has no threads: the timers that run in threads in Python (response timeouts, event groups, the MQTT queue) run on `setTimeout`. Logging goes to the browser console; the locale is not loaded. See [Alignment with the Python core](alignment.md).
