/**
 * REFERENCE:
 * https://github.com/mqttjs/MQTT.js
 */

// require('mqtt')

AutomatoMqtt = function(system) {
  this.settings = {};
  this.connected = 0;
  this.connected_since = 0;
  this.client = false;
  this.cache = {};
  this.disconnect_queue = [];
  this.destroyed = false;

  // To avoid deadlocks and race conditions con mqtt client (possible in multi-thread environment with on_message and publish calls collisions) we use a "communication queue" to serialize all calls to on_message and publish
  // Javascript on chrome specific: when a tab is in background, each setTimeout is slower (at least 1 second), so _mqtt_communication_thread is slower. To avoid this, i create more "simulated threads" in parallel.
  this.mqtt_communication_threads = [];
  this.mqtt_communication_threads_count = 10;
  this.mqtt_communication_queue = null;
  this.mqtt_communication_queue_only_subscribe = true; // False = use queue for publish and subscribe, True = use it only for subscribe

  // Used by test environment, to "pause" the mqtt listening thread
  // TODO JS: UNSUPPORTED
  // this.mqtt_subscribe_pause_on_topic = null;
  
  this.init = function(lsettings) {
    this.settings = {
      'client_id': 'device',
      'client_id_random_postfix': true,
      'broker_protocol': 'mqtt',
      'broker_host': '127.0.0.1',
      'broker_port': 1883,
      'broker_user': '',
      'broker_pass': '',
      'publish_before_connection_policy': 'connect', // connect, queue, error
      'message-logger': '',
      'warning_slow_queue_ms': 5000,
      // all: True,
      // check_broken_connection: 5, // Number of seconds that a message published should be self-received. If not, the connection is considered broken and a reconnect attempt will be made. Use only with "all" = True
    };
    this.connected = 0;
    this.connected_since = 0;
    this.client = false;
    this.cache = {};
    this.disconnect_queue = [];
    this.destroyed = false;

    this.mqtt_communication_queue = []
    for (let i = 0; i < this.mqtt_communication_threads_count; i++)
      this.mqtt_communication_threads.push(thread_start(this._mqtt_communication_thread, true, this));

    if (lsettings)
      this.config(lsettings)
  }
  
  this.destroy = function() {
    if (this.mqtt_communication_threads) {
      for (let t of this.mqtt_communication_threads)
        thread_end(t);
      this.mqtt_communication_threads = [];
    }
    if (this.connected)
      this.disconnect();
    this.destroyed = true;
  }

  this.config = function(lsettings) {
    Object.assign(this.settings, lsettings);
  }
  
  // callback(phase): 1 = connection started, 2 = connection established, 3 = first message received
  this.connect = function(callback = null) {
    this.settings['_connect_callback'] = callback
    client_id = this.settings['client_id'];
    if (this.settings['client_id_random_postfix'])
      client_id = client_id + '-' + Math.random().toString(36).substring(2, 7);
    console.debug('connecting to mqtt broker {proto}://{host}:{port}, with client_id: {client_id} ...'.format({proto: this.settings['broker_protocol'], host: this.settings['broker_host'], port: this.settings['broker_port'], client_id: client_id}));
    this.client = mqtt.connect(this.settings['broker_protocol'] + '://' + this.settings['broker_host'] + ':' + this.settings['broker_port'], {clientId: client_id, username: this.settings['broker_user'], password: this.settings['broker_pass'], connectTimeout: 10 * 1000, clean: true});
    this.client.on('connect', this._onConnect.bind(this));
    this.client.on('disconnect', this._onDisconnect.bind(this));
    this.client.on('message', this._onMessage.bind(this));
    this.connected = 1
    this.connected_since = 0
    if ('_connect_callback' in this.settings && this.settings['_connect_callback'])
      this.settings['_connect_callback'](this.connected)
  }

  this._onConnect = function(connact) {
    console.debug('connected');
    if ("all" in this.settings && this.settings['all'])
      this.client.subscribe("#");
    else if ("subscribe" in this.settings)
      for (v in settings["subscribe"])
        if (v != "[all]" && v != "[else]")
          this.client.subscribe(v);
    this.connected = 2;
    this.connected_since = system.time();
    if ('_connect_callback' in this.settings && this.settings['_connect_callback'])
      this.settings['_connect_callback'](this.connected);
    if (this.disconnect_queue.length) {
      console.debug("there is something to publish in the queue");
      for (q of this.disconnect_queue)
        this.publish(q[0], q[1], q[2], q[3]);
      this.disconnect_queue = [];
    }
  }

  this._onDisconnect = function(packet) {
    this.connected = 0
    this.connected_since = 0
    //if rc != 0:
    //  console.error('unexpected disconnection from mqtt broker');
    //else
      console.debug('disconnected from mqtt broker');
  }
  
  /**
   * @return ms of delay in current messages queue
   */
  this.queueDelay = function() {
    try {
      return this.mqtt_communication_queue.length ? system.timems() - this.mqtt_communication_queue[0]['timems'] : 0;
    } catch (exception) {
      return 0;
    }
  }

  this._mqtt_communication_thread = async function() {
    //console.warn("_mqtt_communication_thread");
    while (thread_check(this)) {
      let d = this.context.mqtt_communication_queue.shift();
      if (d) {
        let delay = system.timems() - d['timems'];
        // Ignoring first 60 seconds from mqtt connections for warnings: i can receive a lot of retained messages, a slowdown is normal!
        let slow = system.time() > this.context.connected_since + 60 && delay > this.context.settings['warning_slow_queue_ms']
        if (slow)
          console.warn("Slow mqtt_communication_queue, last message fetched in {ms} ms: {msg}".format({ms: delay, msg: d}));
        if (d['type'] == 'publish')
          this.context._mqtt_communication_publish(d['topic'], d['payload'], d['qos'], d['retain']);

        else if (d['type'] == 'subscribe') {
          try {
            let decoded = this.context._decodePayload(d['payload']);
            // TODO getLogger(settings["message-logger"]).
            console[slow ? 'warn' : 'debug']('received message{retained} {topic} = {payload}{delay}'.format({topic: d['topic'], payload: d['payload'], retained: d['retain'] ? ' (retained)' : '', delay: delay > 0 ? ' (' + delay + 'ms)' : ''}));
            
            if ("cache" in this.context.settings && this.context.settings['cache'])
              this.context.cache[d['topic']] = decoded;
            if ("subscribe" in this.context.settings) {
              let done = false;
              for (v in this.context.settings["subscribe"]) {
                if (v != "[all]" && v != "[else]" && callable(settings["subscribe"][v])) {
                  let is_regex = v.startsWith("/") && v.endsWith("/");
                  let matches = is_regex ? this.context._topicMatchesToList(d['topic'].match(v.slice(1,-1))) : [];
                  if ((!is_regex && this.context.topicMatchesMQTT(v, d['topic'])) || (is_regex && matches)) {
                    this.context.settings["subscribe"][v](d['topic'], d['payload'], deepcopy(decoded), d['qos'], d['retain'], matches, d['timems']);
                    done = true;
                  }
                }
              }
              if (!done && "[else]" in this.context.settings["subscribe"])
                this.context.settings["subscribe"]["[else]"](d['topic'], d['payload'], deepcopy(decoded), d['qos'], d['retain'], null, d['timems']);
              if ("[all]" in this.context.settings["subscribe"])
                this.context.settings["subscribe"]["[all]"](d['topic'], d['payload'], deepcopy(decoded), d['qos'], d['retain'], null, d['timems']);
            }
          } catch (exception) {
            console.error('error in message handling', exception);
          }
          // TODO JS: UNSUPPORTED mqtt_subscribe_pause_on_topic 
          // if (this.context.mqtt_subscribe_pause_on_topic && d['topic'] == mqtt_subscribe_pause_on_topic) {
          //   while (this.context.mqtt_subscribe_pause_on_topic && d['topic'] == mqtt_subscribe_pause_on_topic)
          //     system.sleep(.1);
          //   system.sleep(.1);
          // }
        }
      }
      await thread_sleep(.1);
    }
  }

  this._mqtt_communication_publish = function(topic, payload, qos, retain) {
    console.debug("publishing on broker {topic} (qos = {qos}, retain = {retain})".format({topic: topic, qos: qos, retain: retain}));
    // TODO
    // if settings["message-logger"] != '':
    //   console.getLogger(settings["message-logger"]).info("publishing on broker {topic} = {payload} (qos = {qos}, retain = {retain})".format(topic = topic, payload = str(payload), qos = qos, retain = retain))
    try {
      this.client.publish(topic, payload, qos, retain);
    } catch (exception) {
      console.exception("error publishing topic on broker", exception);
    }
  }

  this._onMessage = function(topic, payload, packet) {
    this.mqtt_communication_queue.push({'type': 'subscribe', 'topic': topic, 'payload': payload.toString(), 'retain': packet.retain, 'qos': packet.qos, 'timems': system.timems()});
    if (this.connected < 3) {
      this.connected = 3;
      if ('_connect_callback' in this.settings && this.settings['_connect_callback'])
        this.settings['_connect_callback'](this.connected)
    }
    if (packet.retain && this.connected_since > 0 && system.time() > this.connected_since + 30)
      console.error("MQTT> Received a retained messages at boot finished: {topic} = {payload}".format({topic: topic, payload: payload}));
  }

  this.topicMatches = function(topic, pattern) {
    var is_regex = pattern.startsWith("/") && pattern.endsWith("/");
    if (is_regex)
      return this._topicMatchesToList(topic.match(pattern.slice(1, -1)));
    return this.topicMatchesMQTT(pattern, topic) ? [true] : [];
  }
  
  this.topicMatchesMQTT = function(pattern, topic) {
    if (pattern == "#")
      return true;
    if (pattern.endsWith("/#"))
      pattern = pattern.slice(0, -2) + "($|/.*$)";
    else
      pattern += "$";
    return new RegExp("^" + pattern.replace(/\+/g, '[^/]+')).exec(topic) ? true : false;
  }

  this._topicMatchesToList = function(m) {
    return m ? m : [];
  }

  this._decodePayload = function(v) {
    if (typeof(v) == "string" && v.length && (v[0] == '{' || v[0] == '['))
      try {
        return json_import(v);
      } catch (e) {
      }
    //f = parseFloat(v)
    //if (isNaN(f))
    //  return v;
    //i = parseInt(v)
    //return Math.abs(f - i) < 0.0001 ? i : f;
    return v;
  }

  this._timePayload = function(v) {
    if (typeof v == "string" && ":" in v) {
      try {
        return Math.floor(new Date(v).getTime() / 1000);
      } catch (e) {
      }
    }
    try {
      v = parseInt(v);
    } catch (e) {
      return null;
    }
    if (v > 1E12)
      v = Math.floor(v / 1000);
    return v;
  }

  this.disconnect = function() {
    this.client.end(false, function() {
      console.info("Disconnected");
      this.connected = 0;
      this.connected_since = 0;
    });
  }

  this.publish = function(topic, payload, qos = 0, retain = false) {
    if (typeof payload != "string" && payload != null)
      payload = json_export(payload);
    if (this.connected == 0) {
      if (this.settings['publish_before_connection_policy'] == 'connect') {
        console.debug("connecting broker and publishing {topic} (qos = {qos}, retain = {retain})".format({topic: topic, qos: qos, retain: retain}));
        if (this.settings["message-logger"] != '')
          // TODO getLogger(settings["message-logger"])
          console.info("publishing on broker {topic} = {payload} (qos = {qos}, retain = {retain})".format({topic: topic, payload: payload, qos: qos, retain: retain}));
        this.connect();
        this.client.publish(topic, payload, qos, retain);
        this.disconnect();
      } else if (this.settings['publish_before_connection_policy'] == 'queue') {
        console.debug("broker not connected, adding publish action to queue: {topic} (qos = {qos}, retain = {retain})".format({topic: topic, qos: qos, retain: retain}));
        if (this.settings["message-logger"] != '')
          // TODO getLogger(settings["message-logger"]).
          console.info("adding publish action to queue: {topic} = {payload} (qos = {qos}, retain = {retain})".format({topic: topic, payload: strpayload, qos: qos, retain: retain}));
        var replaced = false;
        for (qi in this.disconnect_queue)
          if (this.disconnect_queue[qi][0] == topic) {
            this.disconnect_queue[qi] = [topic, payload, qos, retain];
            replaced = true;
            break;
          }
        if (!replaced)
          this.disconnect_queue.push([topic, payload, qos, retain]);
      } else {
        throw 'Tried to publish something before connecting';
      }
    } else {
      if (this.mqtt_communication_queue_only_subscribe)
        this._mqtt_communication_publish(topic, payload, qos, retain);
      else
        this.mqtt_communication_queue.push({'type': 'publish', 'topic': topic, 'payload': payload, 'qos': qos, 'retain': retain, 'timems': system.timems()});
    }
  }

  this.get = function(topic, expr = false, _default = null) {
    if (!(topic in this.cache))
      return _default;
    if (!expr)
      return this.cache[topic];
    if (expr.indexOf('[') == -1)
      expr = '["' + expr.replace(/\./g, '"]["') + '"]';
    try {
      return eval("this.cache[topic]" + expr);
    } catch (exception) {
      return _default;
    }
  }
  
  this.getTime = function(topic, expr = false, _default = null) {
    var ret = this.get(topic, expr, _default);
    return ret != null ? this._timePayload(ret) : _default;
  }
  
  this.cachePrint = function() {
    console.debug(this.cache);
  }
};
