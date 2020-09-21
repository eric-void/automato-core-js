var AutomatoCoreSystem = new function() {
  
  this.config = {}
  
  this.set_config = function(_config) {
    this.config = _config;
  }
  
  this.boot = function() {
    //system_extra.init_locale(config)
    //system_extra.init_logging(config)
    this._reset()
    
    mqtt.init()
    mqtt_config = {
      'client_id': 'automato-node',
      'cache': true, 
      'all': true, 
      'subscribe': { '[all]': _on_mqtt_published_message },
      'publish_before_connection_policy': 'queue', // connect, queue, error
      'check_broken_connection': 5,
    }
    mqtt.config(mqtt_config) // pre configuration (if someone tries to use broker before init_mqtt - for example in a module init hook - it looks at this config)
    if ('mqtt' in config)
      mqtt.config(config['mqtt'])
      
  }
  
  _on_mqtt_published_message = function() {
    // TODO
  }
};

AutomatoCoreSystem.set_config({
  'prova': 1
});



/**
 * REFERENCE:
 * https://github.com/mqttjs/MQTT.js
 */

  mqttClient = mqtt.connect(hostprotocol + '://' + hostname + ':' + hostport, {clientId: clientid, username: user, password: pass, connectTimeout: 10 * 1000, clean: true});
  mqttClient.on('connect', function (connack) {
    mqttConnectedTime = (new Date()).getTime();
    mqttClient.subscribe("#")
    /*for (topic in topics)
      if (topic)
        mqttClient.subscribe(topic);*/
    console.info("MQTT Client connected, client_id: " + clientid);
    if ('[connect]' in topics)
      topics['[connect]']();
  });
  mqttClient.on('message', function (msgTopic, msgPayload, packet) {
    if (flags.debug > 1)
      console.log("mqtt: received message", msgTopic, msgPayload);

    msgPayload = msgPayload.toString();
    _mqttHistoryBuild(msgTopic, msgPayload)
    mqttLastMessageTime = (new Date()).getTime();
    
    var call = false;
    for (var topic in topics)
      if (topic.length > 0 && topic[0] != '[' && topics[topic] && _mqttMatchTopic(topic, msgTopic)) {
        call = true;
        topics[topic](msgTopic, msgPayload);
      }
    if (!call && '[else]' in topics)
      topics['[else]'](msgTopic, msgPayload);
    if ('[all]' in topics)
      topics['[all]'](msgTopic, msgPayload);

    if (flags.debug > 1)
      console.log("mqtt: message processed", msgTopic, msgPayload);
  });
  mqttClient.on('error', function (error) {
    console.warn("MQTT ERROR", error);
  });
  mqttClient.on('reconnect', function (error) { console.debug("MQTT Client reconnect"); });
  mqttClient.on('close', function (error) { console.debug("MQTT Client close"); });
  mqttClient.on('offline', function (error) { console.debug("MQTT Client offline"); });
  mqttClient.on('end', function (error) { console.debug("MQTT Client end"); });

  mqttClient.publish(topic, payload, {
    qos: qos ? qos : 0,
    retain: retained ? retained : false
  });

function mqttReboot() {
  console.info("MQTT Client reboot (resetting clientId) ...");
  mqttClient.end(false, function() {
    //mqttClient.reconnect();
    localStorage.removeItem('clientId');
    mqttBoot(mqttClientTopics);
  });
}
