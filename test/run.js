#!/usr/bin/env node
/**
 * Unit tests of the JS core: node automato-core-js/test/run.js [filter]
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createContext, bootSystem, sleep, realConsole } = require('./harness.js');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// Compare by value (regexp groups have no prototype, for example)
function plain(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
function same(actual, expected) {
  assert.deepStrictEqual(plain(actual), plain(expected));
}

const LIGHT = {
  'light@lab': {
    'type': 'item',
    'caption': 'Light',
    'publish': {
      'home/light': {
        'type': 'object',
        'notify': 'Light is {payload[state]}',
        'events': {
          'output': "js:({ value: payload['state'], timer_to: 'timer' in payload ? payload['timer'] : 0, label: 'L' + payload['state'] })",
        },
      },
    },
    'subscribe': {
      'home/light/set': {
        'response': ['home/light'],
        'actions': {
          'output-set': { 'payload': "js:({ state: params['value'] })", 'qos': 1, 'retain': true },
        },
      },
      'home/light/get': {
        'response': ['home/light'],
        'actions': {
          'output-get': { 'payload': '' },
        },
      },
    },
  },
};

const SENSOR = {
  'sensor@lab': {
    'type': 'device',
    'publish': {
      '/^home/sensor/([0-9]+)$/': {
        'type': 'object',
        'events': {
          'temperature': "js:({ port: matches[1], value: payload['t'], unit: 'C' })",
        },
      },
    },
  },
};

//
// Entries lifecycle
//

test('on_entry_load_batch and on_entry_init_batch register their handlers', () => {
  let { system } = bootSystem();
  let batches = [];
  system.on_entry_load_batch(function(defs) { batches.push(['load', Object.keys(defs)]); });
  system.on_entry_init_batch(function(defs) { batches.push(['init', Object.keys(defs)]); });
  system.entry_load(LIGHT, false, false, false);
  same(batches, [['load', ['light@lab']], ['init', ['light@lab']]]);
});

test('on_entries_change handlers are called on load and unload', () => {
  let { system } = bootSystem();
  let calls = [];
  system.on_entries_change(function(loaded, unloaded) { calls.push([loaded, unloaded]); });
  system.entry_load(LIGHT, false, false, false);
  system.entry_unload('light@lab');
  same(calls, [[['light@lab'], []], [[], ['light@lab']]]);
});

test('on_entry_load_batch can ask to reload other entries', () => {
  let { system } = bootSystem(LIGHT);
  let done = false;
  system.on_entry_load_batch(function(defs) {
    if (!done) {
      done = true;
      return ['light@lab'];
    }
  });
  let inits = [];
  system.on_entry_init(function(entry) { inits.push(entry.id); });
  system.entry_load(SENSOR, false, false, false);
  same(inits.sort(), ['light@lab', 'sensor@lab']);
});

test('entry_unload really removes the entry and its index references', () => {
  let { system } = bootSystem(LIGHT);
  assert.ok(system.entry_get('light@lab'));
  system.entry_unload('light@lab');
  assert.strictEqual(system.entry_get('light@lab'), null);
  same(system.index_topic_published['home/light']['entries'], []);
});

test('a changed definition replaces the entry, with no duplicates in indexes', () => {
  let { system } = bootSystem(LIGHT);
  let changed = JSON.parse(JSON.stringify(LIGHT));
  changed['light@lab']['caption'] = 'New caption';
  system.entry_load(changed, false, false, false);
  assert.strictEqual(system.entry_get('light@lab').caption, 'New caption');
  same(system.index_topic_published['home/light']['entries'], ['light@lab']);
});

test('entry_load with unload_other_from_node unloads missing entries once', () => {
  let { system } = bootSystem(Object.assign({}, LIGHT, SENSOR));
  let calls = [];
  system.on_entries_change(function(loaded, unloaded) { calls.push(unloaded); });
  system.entry_load(LIGHT, 'lab', true, false);
  assert.strictEqual(system.entry_get('sensor@lab'), null);
  assert.ok(system.entry_get('light@lab'));
  same(calls, [['sensor@lab']]);
});

test('entry_reload reloads the entry', () => {
  let { system } = bootSystem(LIGHT);
  let before = system.entry_get('light@lab');
  let calls = [];
  system.on_entries_change(function(loaded, unloaded) { calls.push([loaded, unloaded]); });
  system.entry_reload('light@lab');
  let after = system.entry_get('light@lab');
  assert.ok(after);
  assert.notStrictEqual(after, before);
  same(calls, [[['light@lab'], ['light@lab']]]);
});

test('entry_unload_node_entries unloads the node entries', () => {
  let { system } = bootSystem(LIGHT);
  let calls = [];
  system.on_entries_change(function(loaded, unloaded) { calls.push(unloaded); });
  system.entry_unload_node_entries('lab');
  assert.strictEqual(system.entry_get('light@lab'), null);
  same(calls, [['light@lab']]);
});

test('destroy terminates', () => {
  let { system } = bootSystem(LIGHT);
  system.destroy();
});

test('entry id from definition follows the python priority (module, device, item)', () => {
  let { system } = bootSystem();
  system.entry_load([{ 'item': 'i', 'device': 'd' }], 'lab', false, true);
  assert.ok(system.entry_get('d@lab'));
});

test('events with :group in published topics can be loaded and are grouped', () => {
  let { system, receive } = bootSystem({
    'grouped@lab': { 'publish': { 'a/b': { 'type': 'object', 'events': { 'ev': "js:({ value: payload['v'] })", 'ev:group': 60 } } } },
  });
  assert.ok(system.entry_get('grouped@lab'));
  assert.ok('grouped@lab.ev' in system.events_groups);
  receive('a/b', '{"v": 1}');
  assert.strictEqual(system.event_get('grouped@lab.ev'), null);
});

//
// Indexes and topic definitions
//

test('merged definitions in topic indexes are built', () => {
  let { system } = bootSystem(Object.assign({}, LIGHT, {
    'other@lab': { 'publish': { 'home/light': { 'description': 'desc', 'type': 'object' } } },
  }));
  let def = system.topic_published_definition('home/light', null, true);
  assert.strictEqual(def['description'], 'desc');
  assert.strictEqual(def['type'], 'object, object');
  same(system.topic_published_definition('home/light')['description'], 'desc');
});

test('topic_published_definition and topic_subscription_definition with no match return null', () => {
  let { system } = bootSystem(LIGHT);
  assert.strictEqual(system.topic_published_definition('no/match'), null);
  assert.strictEqual(system.topic_subscription_definition('no/match'), null);
});

test('topic_subscription_definition works in non-strict mode', () => {
  let { system } = bootSystem(LIGHT);
  assert.ok(system.topic_subscription_definition('home/light/set'));
  assert.strictEqual(system.topic_subscription_is_internal('home/light/set'), false);
});

test('topic_subscription_list returns the topics', () => {
  let { system } = bootSystem(LIGHT);
  same(system.topic_subscription_list().sort(), ['home/light/get', 'home/light/set']);
});

test('entry_is_publisher_of and entry_is_subscribed_to use non strict matching', () => {
  let { system } = bootSystem(Object.assign({}, LIGHT, {
    'wild@lab': { 'publish': { 'wild/#': { 'type': 'object' } }, 'subscribe': { 'cmd/+/set': { 'description': 'x' } } },
  }));
  let light = system.entry_get('light@lab');
  let wild = system.entry_get('wild@lab');
  assert.strictEqual(system.entry_is_publisher_of(light, 'home/light'), true);
  assert.strictEqual(system.entry_is_publisher_of(light, 'home/other'), false);
  assert.strictEqual(system.entry_is_publisher_of(wild, 'wild/a/b'), true);
  assert.strictEqual(system.entry_is_subscribed_to(wild, 'cmd/x/set'), true);
  assert.strictEqual(system.entry_is_subscribed_to(wild, 'cmd/x/get'), false);
});

test('a catchall rule with no priority does not publish what the entry is subscribed to', () => {
  let { system } = bootSystem({
    'catch@lab': { 'publish': { 'base/#': {} }, 'subscribe': { 'base/set': { 'description': 'x' } } },
  });
  same(Object.keys(system.entries_publishers_of('base/set')), []);
  same(Object.keys(system.entries_publishers_of('base/other')), ['catch@lab']);
});

test('regexp topic rules are anchored at start, like re.match in python', () => {
  let { system } = bootSystem({
    'rx@lab': { 'publish': { '/sensor/([0-9]+)/': { 'type': 'object' } } },
  });
  assert.strictEqual(system.topic_matches('/sensor/([0-9]+)/', 'sensor/1/x')['matched'], true);
  assert.strictEqual(system.topic_matches('/sensor/([0-9]+)/', 'home/sensor/1/x')['matched'], false);
});

test('an invalid regexp in a topic rule does not break message handling', () => {
  let { system, logs } = bootSystem();
  assert.strictEqual(system.topic_matches('/(/', 'a/b')['matched'], false);
  assert.strictEqual(logs.error.length, 1);
  logs.error.length = 0;
});

test('response definitions are normalized from topic list', () => {
  let { system } = bootSystem(LIGHT);
  same(system.entry_get('light@lab').definition['subscribe']['home/light/set']['response'], [{ 'topic': 'home/light' }]);
});

//
// Messages
//

test('message matches are empty for simple topics and regexp groups otherwise', () => {
  let { system } = bootSystem(Object.assign({}, LIGHT, SENSOR));
  let simple = new system.Message(system, 'home/light', {});
  same(simple.publishedMessages()[0].matches, []);
  let regexp = new system.Message(system, 'home/sensor/12', {});
  same(regexp.publishedMessages()[0].matches, ['home/sensor/12', '12']);
  let subscribed = new system.Message(system, 'home/light/set', {});
  same(subscribed.subscribedMessages()[0].matches, []);
  assert.ok(subscribed.subscribedMessages()[0].copy().entry);
});

test('ignore_interval is handled', () => {
  let { system, receive } = bootSystem({
    'slow@lab': { 'ignore_interval': 60, 'publish': { 'a/slow': { 'type': 'object', 'events': { 'ev': "js:({ value: payload['v'] })" } } } },
  });
  receive('a/slow', '{"v": 1}');
  receive('a/slow', '{"v": 2}');
  assert.strictEqual(system.event_get('slow@lab.ev')['value'], 1);
});

//
// Events
//

test('entry.on calls the listener', () => {
  let { system, receive } = bootSystem(LIGHT);
  let got = [];
  let entry = system.entry_get('light@lab');
  entry.on('output', function(e, eventname, eventdata) { got.push([e.id, eventname, eventdata['params']['value']]); }, null, entry);
  receive('home/light', '{"state": 1}');
  same(got, [['light@lab', 'output', 1]]);
});

test('a listener can publish events without breaking the running loop', () => {
  let { system, receive } = bootSystem(Object.assign({}, LIGHT, SENSOR));
  let seen = [];
  let light = system.entry_get('light@lab');
  light.on('output', function() {
    seen.push('first');
    receive('home/sensor/1', '{"t": 20}');
  }, null, light);
  light.on('output', function() { seen.push('second'); }, null, light);
  receive('home/light', '{"state": 1}');
  same(seen, ['first', 'second']);
});

test('event_get with condition and keys', () => {
  let { system, receive } = bootSystem(Object.assign({}, LIGHT, SENSOR));
  receive('home/light', '{"state": 1, "timer": 30}');
  assert.strictEqual(system.event_get('light@lab.output(params["value"] == 1)')['timer_to'], 30);
  assert.strictEqual(system.event_get('light@lab.output(params["value"] == 2)'), null);
  assert.strictEqual(system.event_get('light@lab.output', null, ['value']), 1);
  same(system.event_get('light@lab.output', null, ['value', 'nokey', 'timer_to']), [1, null, 30]);
  assert.strictEqual(system.event_get('light@lab.output', null, ['nokey']), null);
  same(system.event_get('light@lab.nothing', null, ['a', 'b']), [null, null]);
});

test('event_get keeps string values', () => {
  let { system, receive } = bootSystem(LIGHT);
  receive('home/light', '{"state": 1}');
  assert.strictEqual(system.event_get('light@lab.output', null, ['label']), 'L1');
  same(system.event_get('light@lab.output', null, ['label', 'value']), ['L1', 1]);
  assert.strictEqual(system.event_get('light@lab.output')['label'], 'L1');
});

test('event_get_time and entry_event_get_time return the event time', () => {
  let { system, receive } = bootSystem(LIGHT);
  receive('home/light', '{"state": 1}');
  let now = system.time();
  assert.ok(Math.abs(system.event_get_time('light@lab.output') - now) <= 1);
  assert.ok(Math.abs(system.entry_event_get_time('light@lab', 'output') - now) <= 1);
});

test('changed_params does not contain event keys', () => {
  let { system, receive } = bootSystem(SENSOR);
  let got = [];
  system.on_all_events(function(entry, eventname, eventdata) { got.push(eventdata); });
  receive('home/sensor/1', '{"t": 20}');
  receive('home/sensor/1', '{"t": 21}');
  same(Object.keys(got[0]['changed_params']).sort(), ['unit', 'value']);
  same(got[1]['changed_params'], { 'value': 21 });
  same(got[1]['keys'], { 'port': '1' });
});

test('events are kept per key, and events_export/events_import round trip', () => {
  let a = bootSystem(SENSOR);
  a.receive('home/sensor/1', '{"t": 20}');
  a.receive('home/sensor/2', '{"t": 30}');
  assert.strictEqual(a.system.event_get("sensor@lab.temperature(params['port'] == '2')")['value'], 30);
  let exported = plain(a.system.events_export());
  let b = bootSystem(SENSOR);
  b.system.events_import(exported, -1);
  let port2 = b.system.event_get("sensor@lab.temperature(params['port'] == '2')");
  assert.strictEqual(port2['value'], 30);
  assert.ok(b.system.event_get_time("sensor@lab.temperature(params['port'] == '2')") < 0);
});

test('keys_index has the same format of python: imported and received events are the same event', () => {
  let { system, receive } = bootSystem(SENSOR);
  assert.strictEqual(system.entry_event_keys_index({ 'port': '1', 'a': 2 }), '{"a": 2, "port": "1"}');
  system.events_import({ 'sensor@lab': { 'temperature': { '{"port": "1"}': { 'name': 'temperature', 'time': 100, 'params': { 'port': '1', 'value': 20 }, 'changed_params': {}, 'keys': { 'port': '1' } } } } });
  receive('home/sensor/1', '{"t": 21}');
  same(Object.keys(system.entry_events_published('sensor@lab')['temperature']), ['{"port": "1"}']);
});

test('decode references return plain objects with null for missing groups', () => {
  let { system, context } = bootSystem();
  same(system.decode_event_reference('a@b.ev'), { entry: 'a@b', event: 'ev', condition: null });
  assert.strictEqual(context.isinstance(system.decode_event_reference('a@b.ev'), 'dict'), true);
  same(system.decode_action_reference('a@b.ac(x)'), { entry: 'a@b', action: 'ac', init: 'x' });
});

test('transform references between actions and events', () => {
  let { system } = bootSystem();
  assert.strictEqual(system.transform_action_reference_to_event_reference("a@b.x-set(js: params['x'] = 1; params['y'] = 2;)"), "a@b.x(js: params['x'] == 1&& params['y'] == 2)");
  same(system.transform_action_reference_to_event_reference('a@b.x-set', true), { entry: 'a@b', event: 'x', condition: null });
  assert.strictEqual(system.transform_event_reference_to_action_reference("a@b.x(js: params['x'] == 1 && params['y'] == 2)"), "a@b.x-set(js: params['x'] = 1 ; params['y'] = 2)");
  same(system.transform_event_reference_to_action_reference('a@b', true), { entry: 'a@b', action: null, init: null });
});

//
// Actions
//

test('do_action, entry_do_action and entry.do publish with action qos and retain', () => {
  let { system, client } = bootSystem(LIGHT);
  let entry = system.entry_get('light@lab');
  assert.strictEqual(system.do_action('light@lab.output-set', { 'value': 1 }), true);
  assert.strictEqual(system.entry_do_action(entry, 'output-set', { 'value': 2 }), true);
  assert.strictEqual(entry.do('output-set', { 'value': 3 }), true);
  same(client.published, [1, 2, 3].map(v => ({ topic: 'home/light/set', payload: JSON.stringify({ state: v }), qos: 1, retain: true })));
  assert.strictEqual(entry.do('unknown'), false);
});

test('an action with no payload publishes an empty message', () => {
  let { system, client } = bootSystem(LIGHT);
  assert.strictEqual(system.entry_get('light@lab').do('output-get'), true);
  same(client.published, [{ topic: 'home/light/get', payload: '', qos: 0, retain: false }]);
});

test('do_action_lambda uses the entry as default', () => {
  let { system, client } = bootSystem(LIGHT);
  let action = system.do_action_lambda(system.entry_get('light@lab'));
  assert.strictEqual(action('.output-set', { 'value': 1 }), true);
  assert.strictEqual(client.published.length, 1);
});

test('action reference init code is applied', () => {
  let { system, client } = bootSystem(LIGHT);
  assert.strictEqual(system.do_action("light@lab.output-set(params['value'] = 5)", {}), true);
  same(JSON.parse(client.published[0].payload), { state: 5 });
});

test('if_event_not_match skips the action only if the event matches', () => {
  let { system, client, receive } = bootSystem(LIGHT);
  receive('home/light', '{"state": 1}');
  assert.strictEqual(system.do_action('light@lab.output-set', { 'value': 1 }, null, 'light@lab.output'), true);
  assert.strictEqual(client.published.length, 0);
  receive('home/light', '{"state": 1}');
  assert.strictEqual(system.do_action('light@lab.output-set', { 'value': 2 }, null, 'light@lab.output'), true);
  assert.strictEqual(client.published.length, 1);
  receive('home/light', '{"state": 1}');
  assert.strictEqual(system.do_action('light@lab.output-set(params["value"] = 1)', {}, null, true), true);
});

test('an action invalidates the event cache', () => {
  let { system, receive } = bootSystem(LIGHT);
  receive('home/light', '{"state": 1}');
  assert.ok(system.event_get('light@lab.output'));
  system.do_action('light@lab.output-set', { 'value': 2 });
  assert.strictEqual(system.event_get('light@lab.output'), null);
});

test('entry.publish uses the default topic and response callbacks', async () => {
  let { system, client, receive } = bootSystem(LIGHT);
  let entry = system.entry_get('light@lab');
  system.entry_publish_current_default_topic('home/light/set');
  let responses = [];
  entry.publish('', { 'state': 1 }, null, null, function(e, id, message, final) { responses.push([message.topic, final]); });
  assert.strictEqual(client.published[0].topic, 'home/light/set');
  receive('home/light', '{"state": 1}');
  same(responses, [['home/light', true]]);
  system.destroy();
});

test('no_response_callback is called when the response does not arrive', async () => {
  let { system } = bootSystem(Object.assign({}, LIGHT, {
    'quick@lab': { 'subscribe': { 'q/set': { 'response': [{ 'topic': 'q/state', 'duration': 0 }] } } },
  }));
  let entry = system.entry_get('quick@lab');
  let missing = [];
  entry.publish('q/set', 'x', null, null, null, function(e, id, message) { missing.push(message.topic); });
  await sleep(1100);
  same(missing, ['q/set']);
  system.destroy();
});

test('subscribe_response returns false if no response is declared', () => {
  let { system } = bootSystem(LIGHT);
  let message = new system.Message(system, 'not/declared', null);
  assert.strictEqual(system.subscribe_response(system.entry_get('light@lab'), message, function() {}), false);
});

//
// Scripting
//

test('script_eval has the python signature, and scripts have their helpers', () => {
  let { context, system } = bootSystem();
  let sc = new context.AutomatoScriptingJs(system, {});
  assert.strictEqual(sc.script_eval('js: a + 1', { 'a': 1 }, true, true), 2);
  assert.strictEqual(sc.script_eval('js: uniqid().split(":")[0]'), 'client');
  assert.strictEqual(sc.script_eval('js: array_sum([1, 2, null])'), 3);
  assert.strictEqual(sc.script_eval('js: array_sum([1.26, 1.26], 1)'), 2.5);
});

test('script_exec returns only the requested variables', () => {
  let { context, system } = bootSystem();
  let sc = new context.AutomatoScriptingJs(system, {});
  same(sc.script_exec('js: a = 2; b = 3;', { 'a': 1, 'b': 1 }, ['a']), { 'a': 2 });
  assert.strictEqual(sc.script_exec('js: a = 2;', { 'a': 1 })['a'], 2);
});

test('nan_remove, len and read_duration', () => {
  let context = createContext();
  assert.strictEqual(context.nan_remove('text'), 'text');
  assert.strictEqual(context.nan_remove(NaN), null);
  same(context.nan_remove({ 'a': NaN, 'b': 'x', 'c': [NaN, 1] }), { 'a': null, 'b': 'x', 'c': [null, 1] });
  assert.strictEqual(context.len(null), 0);
  assert.strictEqual(context.read_duration('2m'), 120);
});

//
// Notifications
//

test('notifications are built from message definition', () => {
  let { system } = bootSystem(LIGHT);
  let pm = new system.Message(system, 'home/light', { 'state': 1 }).publishedMessages()[0];
  assert.strictEqual(pm.notificationString(), 'Light is 1');
  assert.strictEqual(pm.notificationLevelString(), 'info');
});

test('notifications ignore a "notify" that is not a string, and parse list contexts', () => {
  let { system } = bootSystem({
    'no@lab': { 'publish': { 'n/o': { 'type': 'object', 'notify': true } } },
    'list@lab': { 'publish': { 'n/l': { 'type': 'object', 'notify': '{payload[1]}' } } },
  });
  assert.strictEqual(new system.Message(system, 'n/o', {}).publishedMessages()[0].notificationString(), null);
  assert.strictEqual(new system.Message(system, 'n/l', ['a', 'b']).publishedMessages()[0].notificationString(), 'b');
});

//
// Mqtt
//

test('credentials are sent only if configured', () => {
  let anonymous = bootSystem();
  assert.ok(!('username' in anonymous.client.options));
  assert.ok(!('password' in anonymous.client.options));
  let auth = bootSystem({}, { 'mqtt': { 'broker_user': 'u', 'broker_pass': 'p' } });
  assert.strictEqual(auth.client.options.username, 'u');
  assert.strictEqual(auth.client.options.password, 'p');
});

test('empty writes are not sent to the stream, even after the stream is rebuilt', () => {
  let context = createContext();
  let writes = [];
  let streamNumber = 0;
  let client = {
    stream: null,
    _setupStream() {
      let number = ++streamNumber;
      this.stream = { write(chunk) { writes.push([number, chunk]); return 'written'; } };
    },
  };
  client._setupStream();
  let broker = new context.AutomatoMqtt({});
  broker._skipEmptyWrites(client);
  assert.strictEqual(client.stream.write('a'), 'written');
  assert.strictEqual(client.stream.write(''), true);
  assert.strictEqual(client.stream.write(Buffer.alloc(0)), true);
  client._setupStream();
  client.stream.write('b');
  client.stream.write('');
  same(writes, [[1, 'a'], [2, 'b']]);
});

test('connection phases follow the real state of the connection', () => {
  let { system, client } = bootSystem();
  let broker = system.broker();
  assert.strictEqual(broker.connected, 2);
  assert.ok(broker.connected_since > 0);
  client.brokerSends('a/b', 'x');
  assert.strictEqual(broker.connected, 3);
  client.brokerCloses();
  assert.strictEqual(broker.connected, 0);
  assert.strictEqual(broker.connected_since, 0);
  client.brokerReconnecting();
  assert.strictEqual(broker.connected, 1);
  client.brokerConnects();
  assert.strictEqual(broker.connected, 2);
});

test('the init callback is called at every connection', () => {
  let context = createContext();
  let system = new context.AutomatoSystem({});
  system.set_config({ 'name': 'client', 'mqtt': {} });
  system.boot();
  let connections = 0;
  system.init(function() { connections ++; });
  let client = context.clients[0];
  client.brokerConnects();
  client.brokerCloses();
  client.brokerReconnecting();
  client.brokerConnects();
  assert.strictEqual(connections, 2);
});

test('messages published while disconnected are queued and sent at reconnection', () => {
  let { system, client } = bootSystem(LIGHT);
  client.brokerCloses();
  system.do_action('light@lab.output-set', { 'value': 1 });
  system.do_action('light@lab.output-set', { 'value': 2 });
  assert.strictEqual(client.published.length, 0);
  client.brokerReconnecting();
  client.brokerConnects();
  same(client.published, [{ topic: 'home/light/set', payload: JSON.stringify({ state: 2 }), qos: 1, retain: true }]);
  assert.strictEqual(system.broker().disconnect_queue.length, 0);
});

test('disconnect resets the state', () => {
  let { system } = bootSystem();
  system.broker().disconnect();
  assert.strictEqual(system.broker().connected, 0);
});

test('topic_filter_ignore ignores only matching topics', () => {
  let { system, client } = bootSystem({}, { 'mqtt': { 'topic_filter_ignore': ['ignored/#', '/^rx[0-9]$/'] } });
  let queue = system.broker().mqtt_communication_queue;
  client.brokerSends('ignored/a', 'x');
  client.brokerSends('rx1', 'x');
  assert.strictEqual(queue.length, 0);
  client.brokerSends('other/a', 'x');
  assert.strictEqual(queue.length, 1);
  queue.length = 0;
});

test('specific topics are subscribed and dispatched, and queue delay is tracked', async () => {
  let context = createContext();
  let broker = new context.AutomatoMqtt({ time() { return Math.floor(Date.now() / 1000); }, timems() { return Date.now(); } });
  let got = [];
  broker.init({
    'subscribe': {
      'a/+': function(topic, source, payload) { got.push(['a', topic, payload]); },
      '/^b([0-9])$/': function(topic, source, payload, qos, retain, matches) { got.push(['b', matches[1]]); },
      '/^nomatch$/': function() { got.push(['nomatch']); },
      '[else]': function(topic) { got.push(['else', topic]); },
    },
    'client_id_random_postfix': false,
  });
  broker.connect();
  let client = context.clients[0];
  client.brokerConnects();
  same(client.subscribed, ['a/+', '/^b([0-9])$/', '/^nomatch$/']);
  client.brokerSends('a/x', '{"v": 1}');
  client.brokerSends('b1', 'y');
  client.brokerSends('c', 'z');
  await sleep(250);
  got.sort((x, y) => x[0] < y[0] ? -1 : 1);
  same(got, [['a', 'a/x', { 'v': 1 }], ['b', '1'], ['else', 'c']]);
  broker.mqtt_communication_recent_delay = 0;
  client.emit('message', 'a/y', Buffer.from('1'), { retain: false, qos: 0 });
  broker.mqtt_communication_queue[0]['timems'] -= 2000;
  await sleep(250);
  assert.ok(broker.queueDelay() >= 2000);
  broker.destroy();
});

test('payload decoding follows python rules', () => {
  let { system } = bootSystem();
  let broker = system.broker();
  same(broker._decodePayload('{"a": 1}'), { 'a': 1 });
  same(broker._decodePayload('[1]'), [1]);
  assert.strictEqual(broker._decodePayload('{not closed'), '{not closed');
  assert.strictEqual(broker._decodePayload('21.5'), '21.5');
  assert.strictEqual(broker._timePayload('2020-01-02T03:04:05'), Math.floor(new Date('2020-01-02T03:04:05').getTime() / 1000));
  assert.strictEqual(broker._timePayload('1600000000000'), 1600000000);
  assert.strictEqual(broker._timePayload('text'), null);
});

//
// Call alignment with python core
//

const JS_ONLY = {
  'system': ['Entry', 'Message', 'PublishedMessage', 'SubscribedMessage', 'set_config', '_topic_matches_for_message', '_re_groupdict'],
  'mqtt': ['_onReconnect', '_skipEmptyWrites', 'cachePrint'],
};
const PY_ONLY = {
  'system': [],
  'mqtt': ['_magicCast', 'getLogger'],
};
const DIFFERENT_PARAMS = {
  'system': { 'entry_definition_add_default': 'default is a reserved word in js', 'entry_get': 'obsolete parameter "local" is ignored in python' },
  'mqtt': { '_onConnect': 'callback of the library', '_onDisconnect': 'callback of the library', '_onMessage': 'callback of the library', 'get': 'default is a reserved word in js', 'getTime': 'default is a reserved word in js' },
};

function pyFunctions(source) {
  let res = {};
  for (let m of source.matchAll(/^( *)def ([a-zA-Z_0-9]+)\(([^)]*)\)/gm))
    if (m[1].length <= 2 && m[2] != '__init__' && !(m[1].length == 2 && ['copy', 'events', 'publishedMessages', 'firstPublishedMessage', 'subscribedMessages', 'notificationString', 'notificationLevel', 'notificationLevelString', '_notificationBuild', '_refresh_definition_based_properties'].includes(m[2])))
      res[m[2]] = paramNames(m[3], 'self');
  return res;
}

function jsFunctions(source) {
  let res = {};
  for (let m of source.matchAll(/^ {2}this\.([a-zA-Z_0-9]+) = (?:async )?function\s*\(([^)]*)\)/gm))
    res[m[1]] = paramNames(m[2]);
  return res;
}

function paramNames(params, skip) {
  return params.split(',').map(p => p.split('=')[0].trim()).filter(p => p && p != skip);
}

function compareApi(module, py, js) {
  let problems = [];
  for (let name in py)
    if (!(name in js) && !(PY_ONLY[module] || []).includes(name))
      problems.push(name + ' missing in js');
  for (let name in js)
    if (!(name in py) && !(JS_ONLY[module] || []).includes(name))
      problems.push(name + ' missing in python');
  for (let name in py)
    if (name in js && py[name].join() != js[name].join() && !(name in (DIFFERENT_PARAMS[module] || {})))
      problems.push(name + ': python(' + py[name] + ') js(' + js[name] + ')');
  return problems;
}

for (let module of ['system', 'mqtt'])
  test('functions and parameters are aligned with python: ' + module, () => {
    let pyPath = path.join(__dirname, '..', '..', 'automato-core-py', 'src', 'automato', 'core', module + '.py');
    let jsPath = path.join(__dirname, '..', 'src', 'automato', 'core', module + '.js');
    assert.ok(fs.existsSync(pyPath), 'automato-core-py must be a sibling of automato-core-js');
    same(compareApi(module, pyFunctions(fs.readFileSync(pyPath, 'utf8')), jsFunctions(fs.readFileSync(jsPath, 'utf8'))), []);
  });

//
// Runner
//

(async function() {
  let filter = process.argv[2];
  let failed = 0, run = 0;
  for (let t of tests) {
    if (filter && t.name.indexOf(filter) < 0)
      continue;
    run ++;
    try {
      await t.fn();
      realConsole.log('ok   - ' + t.name);
    } catch (e) {
      failed ++;
      realConsole.log('FAIL - ' + t.name + '\n       ' + String(e.stack || e).split('\n').slice(0, 12).join('\n       '));
    }
  }
  realConsole.log('\n' + (run - failed) + '/' + run + ' passed');
  process.exit(failed ? 1 : 0);
})();
