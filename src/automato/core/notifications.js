function AutomatoNotifications(system, scripting_js) {
  
  this.notifications_last_topic_payloads = {};
  this.notifications_topic_next_level = {};
  this.destroyed = false;
  
  this.notifications_levels = {
    "debug": 20,
    "response": 40,
    "info": 50,
    "warn": 60,
    "error": 70,
    "critical": 90,
  };

  this.init = function() {
    this.notifications_last_topic_payloads = {};
    this.notifications_topic_next_level = {};
    this.destroyed = false;
  }

  this.destroy = function() {
    this.destroyed = true;
  }

  this.entry_normalize = function(entry) {
    for (let k of ['notify', 'notify_level', 'notify_handler', 'notify_change_level', 'notify_change_duration']) {
      if (k in entry.definition) {
        for (topic in entry.definition['publish'])
          if (!(k in entry.definition['publish'][topic]))
            entry.definition['publish'][topic][k] = entry.definition[k];
        for (topic in entry.definition['subscribe'])
          if (!(k in entry.definition['subscribe'][topic]))
            entry.definition['subscribe'][topic][k] = entry.definition[k];
      }
    }
  }
  
  this.notification_build = function(published_message) {
    return {
      'notification_string': null,
      'notification_level': null,
      'notification_slevel': null,
    }
  }
  
  this.notification_build = function(published_message) {
    let entry = published_message.entry;
    let ldef = published_message.definition;
    let topic = published_message.topic;
    let payload = published_message.payload;
    let matches = published_message.matches;
    let set_notifications_topic_next_level = false;
    let defaults = {};
    
    if ('notify_if' in ldef)
      for (expr in ldef['notify_if']) {
        let v = scripting_js.script_eval(expr, {"topic": topic, "payload": payload, "matches": matches}, false, true);
        if (v) {
          for (k in ldef['notify_if'][expr])
            defaults[k] = ldef['notify_if'][expr][k];
          if ('notify_next_level' in ldef['notify_if'][expr])
            set_notifications_topic_next_level = ldef['notify_if'][expr]['notify_next_level'];
        }
      }
    for (k of ['notify', 'notify_level', 'notify_handler', 'notify_change_level', 'notify_change_duration', 'payload'])
      if (k in ldef && !(k in defaults))
        defaults[k] = ldef[k];
    
    let string = null;
    if (!string && 'notify_handler' in defaults)
      string = scripting_js.script_eval(defaults['notify_handler'], {"topic": topic, "payload": payload, "matches": matches}, false, true);
    else if (!string && 'notify' in defaults)
      string = this.notification_parse_string(defaults['notify'], { 'payload': payload, 'matches': matches, 'caption': entry.caption}, 'payload', defaults);
    
    if (string) {
      let changed = topic in this.notifications_last_topic_payloads && this.notifications_last_topic_payloads[topic][0] != string;
      if (changed && 'notify_change_level' in defaults && (!('notify_change_duration' in defaults) || system.time() - this.notifications_last_topic_payloads[topic][1] > read_duration(defaults['notify_change_duration']))) {
        defaults['notify_level'] = defaults['notify_change_level'];
        this.notifications_last_topic_payloads[topic] = [string, system.time()];
      } else
        this.notifications_last_topic_payloads[topic] = [string, topic in this.notifications_last_topic_payloads ? this.notifications_last_topic_payloads[topic][1] : 0];
    }
    
    let notify_level = 'notify_level' in defaults ? defaults['notify_level'] : 'info';
    if (topic in this.notifications_topic_next_level && this.notifications_topic_next_level[topic])
      notify_level = this.notifications_topic_next_level[topic];
    
    this.notifications_topic_next_level[topic] = set_notifications_topic_next_level;
    
    return {
      'notification_slevel': notify_level,
      'notification_level': this.notifications_levels[notify_level],
      'notification_string': string ? string : null
    };
  }
  
  this._notification_parse_var = function(key, context, _var, definition) {
    let context_array = isinstance(context, 'list');
    let context_dict = isinstance(context, 'dict');
    if (context_array || context_dict) {
      let _m = key.match(/^([^\[]+)\[([^\]]*)?\](.*)$/);
      if (_m) {
        if (_m[1] == '_' && _var) {
          _ctx = {}
          _ctx[_var] = context[_var]
          return this._notification_parse_var(_m[2] + _m[3], _ctx, null, definition);
        }
        if (context_array) {
          _m[1] = parseInt(_m[1]);
          if (Number.isNan(_m[1]))
            return null;
        }
        if (_m[1] in context)
          return this._notification_parse_var(_m[2] + _m[3], context[_m[1]], null, definition);
        return null;
      }
    }
    let _f = key.match(/^(.*)!(.*)$/);
    if (_f) {
      key = _f[1]
      _f = _f[2]
    }
    if ((!context_array && !context_dict) || !(key in context) || context[key] == null) {
      if (_f && _f.startsWith("'") && _f.endsWith("'"))
        return _f.slice(1, -1);
      return null;
    }

    let res = context[key];
    if (_f) {
      if (_f == 'caption' && typeof res != 'object' && definition && 'payload' in definition && key in definition['payload']) {
        if (res in definition['payload'][key] && 'caption' in definition['payload'][key][res])
          res = definition['payload'][key][res]['caption'];
        if (parseInt(res) in definition['payload'][key] && 'caption' in definition['payload'][key][parseInt(res)])
          res = definition['payload'][key][parseInt(res)]['caption'];
      } else if (_f.startsWith("strftime")) {
        format = _f.length > 10 ? _f.slice(9, -1) : "%Y-%m-%d %H:%M:%S";
        let v = parseInt(res);
        if (!Number.isNaN(v))
          res = strftime(format, new Date(v < 9999999999 ? v * 1000 : v));
        else
          res = strftime(format, new Date(res));
      }
    }
    
    if (isinstance(res, 'dict'))
      res = "{" + Object.entries(res).map(function(v) { return v[0] + ': ' + v[1]}).join(", ") + "}";
    else if (isinstance(res, 'list'))
      res = "[" + res + "]"
    return res
  }
  
  this.notification_parse_string = function(string, context, _var , definition) {
    return string.replace(/{([^}]*)}/g, function(match, key) {
      let ret = this._notification_parse_var(key, context, _var, definition);
      return ret != null ? ret : match;
    }.bind(this));
  }
}

/*
var a = new AutomatoNotifications(null); 
var i = 1;
a.notification_parse_string("prova {payload}", {payload: {"a": "aaa"}}, "payload", {}) == "prova {a: aaa}" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {payload}", {payload: {"a": "aaa", "b": 1593055316}}, "payload", {}) == "prova {a: aaa, b: 1593055316}" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {payload[a]}", {payload: {"a": "aaa", "b": 1593055316}}, "payload", {}) == "prova aaa" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {payload[b]}", {payload: {"a": "aaa", "b": 1593055316}}, "payload", {}) == "prova 1593055316" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {payload[b!strftime]}", {payload: {"a": "aaa", "b": 1593055316}}, "payload", {}) == "prova 2020-06-25 05:21:56" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {nomatch}", {payload: {"a": "aaa", "b": 1593055316}}, "payload", {}) == "prova {nomatch}" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {nomatch!'default'}", {payload: {"a": "aaa", "b": 1593055316}}, "payload", {}) == "prova default" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {payload[b!'default']}", {payload: {"a": "aaa", "b": null}}, "payload", {}) == "prova default" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {payload[b]}", {payload: {"a": "aaa", "b": null}}, "payload", {}) == "prova {payload[b]}" ? console.log(i++) : console.error(i++); // TODO WARN Forse sarebbe meglio "prova null"
a.notification_parse_string("prova {_[payload]}", {payload: 1593055316}, "payload", {}) == "prova 1593055316" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {_[payload!strftime]}", {payload: 1593055316}, "payload", {}) == "prova 2020-06-25 05:21:56" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {payload}", {payload: 1593055316}, "payload", {}) == "prova 1593055316" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {payload[b]}", {payload: 1593055316}, "payload", {}) == "prova {payload[b]}" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {payload[b!'prova']}", {payload: 1593055316}, "payload", {}) == "prova prova" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {_[payload!caption]}", {payload: 0}, "payload", {"payload": {"payload": {0: {"caption": "OFF"}, 1: {"caption": "ON"}}}}) == "prova OFF" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {_[payload!caption]}", {payload: "1"}, "payload", {"payload": {"payload": {0: {"caption": "OFF"}, 1: {"caption": "ON"}}}}) == "prova ON" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {payload[a!caption]}", {payload: {"a": "x"}}, "payload", {"payload": {"a": {"x": {"caption": "OFF"}, "y": {"caption": "ON"}}}}) == "prova OFF" ? console.log(i++) : console.error(i++);
a.notification_parse_string("prova {payload[a][b]}", {payload: {"a": { "a": "x", "b": "y"}, "b": 1593055316}}, "payload", {}) == "prova y" ? console.log(i++) : console.error(i++);
*/
