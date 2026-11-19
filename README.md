# automato-core-js

JavaScript core of **Automato**, a home automation framework built on MQTT, for browser clients.

It is the JavaScript implementation of [automato-core-py](https://github.com/eric-void/automato-core-py): the same entry/event/action model, the same definitions and the same MQTT protocol. A client built on it loads the definitions published by the nodes, decodes every MQTT message into events and calls actions, exactly like a node does. [automato-http-client](https://github.com/eric-void/automato-http-client) is built on it.

## The Automato projects

| Repository | What it is |
|---|---|
| [automato-core-py](https://github.com/eric-void/automato-core-py) | Python core, and the reference documentation of the model and the protocol |
| **automato-core-js** (this one) | The same core in JavaScript |
| [automato-node-py](https://github.com/eric-void/automato-node-py) | The node: runs entries and modules (devices, services, automations) |
| [automato-http-client](https://github.com/eric-void/automato-http-client) | A static web client, built on this core (in progress) |

## Documentation

The model is documented once, in the Python core: [concepts](https://github.com/eric-void/automato-core-py/blob/master/docs/concepts.md), [entry definitions](https://github.com/eric-void/automato-core-py/blob/master/docs/entry-definition.md), [events and actions](https://github.com/eric-void/automato-core-py/blob/master/docs/events-and-actions.md), [scripting](https://github.com/eric-void/automato-core-py/blob/master/docs/scripting.md), [notifications](https://github.com/eric-void/automato-core-py/blob/master/docs/notifications.md), [MQTT protocol](https://github.com/eric-void/automato-core-py/blob/master/docs/mqtt-protocol.md) and the [API](https://github.com/eric-void/automato-core-py/blob/master/docs/python-api.md). Function names and parameters are the same in both cores.

This repository adds:

- [Using the JavaScript core](docs/usage.md): loading it in a page, configuration, an example
- [Alignment with the Python core](docs/alignment.md): how the two cores are kept equal, and the known differences

## Quick start

The core is a set of plain scripts that define globals (no modules, no build step). It needs [MQTT.js](https://github.com/mqttjs/MQTT.js) for the connection and [pako](https://github.com/nodeca/pako) to decompress node metadata:

```html
<script src="lib/mqtt.min.js"></script>
<script src="lib/pako_inflate.min.js"></script>
<script src="automato-core-js/src/automato/core/system.js"></script>
<script src="automato-core-js/src/automato/core/utils.js"></script>
<script src="automato-core-js/src/automato/core/scripting_js.js"></script>
<script src="automato-core-js/src/automato/core/notifications.js"></script>
<script src="automato-core-js/src/automato/core/mqtt.js"></script>
<script>
  var system = new AutomatoSystem(this);
  system.set_config({
    'name': 'my-page',
    'listen_all_events': true,
    'mqtt': { 'broker_protocol': 'wss', 'broker_host': 'mqtt.example.org', 'broker_port': 443 },
    'entries': [],
  });
  system.boot();
  system.on_all_events(function(entry, eventname, eventdata) {
    console.log(entry.id, eventname, eventdata['params']);
  });
  system.init(function() {
    // Connected: ask the master node for definitions and events
    system.broker().publish('automato/data/get', '');
  });
</script>
```

See [Using the JavaScript core](docs/usage.md) for loading the `automato/data` response.

## Tests

No dependencies are needed: the tests use only Node.js built-ins, with an in-memory MQTT client instead of a broker.

```sh
node test/run.js
```

`test/run.js` also checks that every function has the same name and parameters as in the Python core.

The parity test runs the same scenario ([test/parity/scenario.json](test/parity/scenario.json)) on both cores and compares the results. The Python side runs in the `automato-node:local` docker image (built from [automato-node-py](https://github.com/eric-void/automato-node-py)), using the sources of the `automato-core-py` checkout next to this one:

```sh
node test/parity/run.js
```

`test/index.html` is an old browser harness, based on APIs that no longer exist.

## Repository layout

| Path | Content |
|---|---|
| `src/automato/core/system.js` | `AutomatoSystem`: entries, definitions, topic matching, events, actions |
| `src/automato/core/mqtt.js` | `AutomatoMqtt`: connection through MQTT.js, message queue, payload decoding |
| `src/automato/core/scripting_js.js` | Evaluation of `js:`/`jsf:` expressions |
| `src/automato/core/notifications.js` | Notification strings and levels |
| `src/automato/core/utils.js` | Global helpers: durations, dates, JSON, compression |
| `test` | Unit tests, parity test |
| `docs` | Documentation; `py_conversion.txt` has historical notes on porting Python code |

## License

[MIT](LICENSE)
