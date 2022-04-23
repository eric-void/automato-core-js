// Use true to define that field as "mergeable" (when generating a single declaration from multiple entry topic declarations), false as "non mergeable" (that field will not be in merged declaration, even if there is only a single declaration)

AutomatoSystem = function(caller_context) {
  let mqtt = new AutomatoMqtt(this);
  let scripting_js = new AutomatoScriptingJs(this, caller_context);
  let notifications = new AutomatoNotifications(this, scripting_js);
  
  const ENTRY_DEFINITION_EXPORTABLE = {
    'type': true,
    'caption': true,
    'description': true,
    'config': true,
    'required': true,
    'publish': {
      'description': true,
      'type': true,
      'qos': true,
      'retain': true,
      'payload': true,
      'payload_transform': true,
      'notify': true,
      'notify_handler': true,
      'notify_type': true,
      'notify_level': true,
      'notify_change_level': true,
      'notify_change_duration': true,
      'notify_if': true,
      "events": true,
      "topic_match_priority": true,
    },
    'subscribe': {
      'description': true,
      "topic_syntax": true,
      "topic_syntax_description": true,
      "payload_syntax": true,
      'response': true,
      'type': true,
      'notify_type': true,
      'notify_level': true,
      'notify_change_level': true,
      'notify_if': true,
      "actions": true,
      "topic_match_priority": true,
    },
    'events': true,
    'actions': true,
    'events_passthrough': true,
  };
  const PRIMITIVE_TYPES = ['int', 'str', 'bool', 'float', 'dict', 'list'];
  const EVENT_KEYS = ['port'];

  this.index_topic_cache = { 'hits': 0, 'miss': 0, 'data': {} };
  // this.index_topic_cache_lock TODO
  this.INDEX_TOPIC_CACHE_MAXSIZE = 1024;
  this.INDEX_TOPIC_CACHE_PURGETIME = 3600;

  this.destroyed = false;
  this.test_mode = false;

  this.set_config = function(_config) {
    this.config = _config;
  }

  this.boot = function() {
    this.destroyed = false;
    // TODO JS: UNSUPPORTED system_extra.init_locale(this.config);
    // TODO JS: UNSUPPORTED system_extra.init_logging(this.config);
    this._reset();
    
    mqtt.init();
    let mqtt_config = {
      'client_id': 'automato-node',
      'cache': true, 
      'all': true, 
      'subscribe': { '[all]': this._on_mqtt_message.bind(this) },
      'publish_before_connection_policy': 'queue', // connect, queue, error
      'check_broken_connection': 5,
    };
    if ('messages-log' in this.config)
      mqtt_config["message-logger"] = 'messages';
      
    mqtt.config(mqtt_config) // pre configuration (if someone tries to use broker before init_mqtt - for example in a module init hook - it looks at this config);
    if ('mqtt' in this.config)
      mqtt.config(this.config['mqtt']);
  }
  
  this._reset = function() {
    this.all_entries = {};
    this.all_entries_signatures = {};
    
    this.all_nodes = {};
    this.exports = {};
    this.subscriptions = {};
    this.last_entry_and_events_for_received_mqtt_message = null;
    this.events_listeners = {};
    this.events_published = {};
    // this.events_published_lock = null; # TODO Thread locking in js class is disabled
    this.events_groups = {};
    // this.events_groups_lock = null; # TODO Thread locking in js class is disabled
    this.index_topic_published = {};
    this.index_topic_subscribed = {};
    scripting_js.exports = this.exports;

    this.handler_on_entry_load = [];
    this.handler_on_entry_load_batch = [];
    this.handler_on_entry_unload = [];
    this.handler_on_entry_init = [];
    this.handler_on_entry_init_batch = [];
    this.handler_on_entries_change = [];
    this.handler_on_initialized = [];
    this.handler_on_message = [];
    this.handler_on_all_events = [];
  }

  /**
   * Called during entry load phase, before on_entry_load_batch/on_entry_init/on_entry_init_batch, for every entry in loading phase
   * @param handler(entry)
   */
  this.on_entry_load = function(handler) {
    this.handler_on_entry_load.push(handler);
  }

  /**
   * Called after on_entry_load, and before on_entry_init/on_entry_init_batch, with current batch of loading entries. 
   * @param handler(loading_defs: {entry_id: entry}): This callback can be called several time for a single batch of entries loading. If a call invalid previously loaded (and initialized entries), they will be passed in a new callback.
   *  You can classify entry loading phases with these references:
   *  - loading_defs {entry_id: entry}: loading entries for this specific callback call, that must be processed
   *  - system.entries(): ALL entries managed by the system, this contains already loaded and initialized, already loaded (by the current loading request) but NOT inizialized (passed in previous callback calls and processed), loading now (NOT initialized and, obviously, NOT processed by this call)
   *  - for (entry in system.entries().values()) if entry.loaded: entries already loaded and initialized. Only these entries can be returned in this callback (to flag them as "must_reload")
   *  - for (entry in system.entries().values()) if entry not in loading_defs: entries already loaded and initialized + entries already loaded (by the current loading request) but NOT inizialized. These have been passed in previous callback calls and processed by it.
   *  - for (entry in system.entries().values()) if not entry.loaded and entry not in loading_defs: only entries already loaded (by the current loading request) but NOT inizialized. These have been passed in previous callback calls and processed by it.
   *  handler can return a list of ids of entries (already loaded and initialized) that must be unloaded and reloaded
   */
  this.on_entry_load_batch = function(handler) {
    this.on_entry_load_batch.push(handler);
  }

  this.on_entry_unload = function(handler) {
    this.handler_on_entry_unload.push(handler);
  }

  /**
   * Called after on_entry_load/on_entry_load, and before on_entry_init_batch, for every entry loaded and initialized by the core system
   * @param handler(entry)
   */
  this.on_entry_init = function(handler) {
    this.handler_on_entry_init.push(handler);
  }

  /**
   * Called after on_entry_init, with current batch of initialized entries
   * @param handler(entries: {entry_id: entry})
   */
  this.on_entry_init_batch = function(handler) {
    this.on_entry_init_batch.push(handler);
  }

  /**
   * @param handler (entry_ids_loaded, entry_ids_unloaded)
   */
  this.on_entries_change = function(handler) {
    this.handler_on_entries_change.push(handler);
  }
  
  this.on_initialized = function(handler) {
    this.handler_on_initialized.push(handler);
  }

  this.on_message = function(handler) {
    this.handler_on_message.push(handler);
  }
  
  this.on_all_events = function(handler) {
    this.handler_on_all_events.push(handler);
  }
  
  this._mqtt_connect_callback = function(callback, phase) {
    if (phase == 2)
      callback();
  }

  this.init = function(callback) {
    this.topic_cache_reset();
    this.default_node_name ='name' in this.config ? this.config['name'] : 'root';
    
    this.subscribed_response = [];
    this.subscription_thread = thread_start(this._subscription_timer_thread.bind(this), false);
    
    notifications.init();
    
    this.entry_load(this.config['entries'], /* node_name = */ this.default_node_name, /*id_from_definition = */true, /*generate_new_entry_id_on_conflict = */ true);

    if (this.handler_on_initialized)
      for (let h of this.handler_on_initialized.values())
        h(this.all_entries);

    mqtt.connect(function(phase) {
      this._mqtt_connect_callback(callback, phase);
    }.bind(this));
  }

  this.destroy = function() {
    while (len(this.all_entries))
      this.entry_unload(Object.keys(this.all_entries));
      
    this.destroyed = true;
    notifications.destroy();
    thread_end(this.subscription_thread);
    this._stats_show()
    console.debug('SYSTEM> Disconnecting from mqtt broker ...');
    mqtt.destroy();
    mqtt.config({ 'subscribe': {} });
    this._reset();
  }

  this.broker = function() {
    return mqtt;
  }




  /***************************************************************************************************************************************************************
   *
   * PUBLIC
   *
   ***************************************************************************************************************************************************************/

  this.system_time_paused = 0;
  this.system_time_offset = 0;

  this.time = function() {
    return (!this.system_time_paused ? Math.floor((new Date()).getTime() / 1000) : this.system_time_paused) + this.system_time_offset;
  }

  this.timems = function() {
    return (!this.system_time_paused ? (new Date()).getTime() : this.system_time_paused * 1000) + this.system_time_offset * 1000;
  }

  this.time_offset = function(v) {
    this.system_time_offset = this.system_time_offset + v;
  }
  
  this.time_set = function(v) {
    this.system_time_offset = v - Math.floor((new Date()).getTime() / 1000);
  }

  this.time_pause = function() {
    if (!this.system_time_paused)
      this.system_time_paused = Math.floor((new Date()).getTime() / 1000);
  }

  this.time_resume = function() {
    if (this.system_time_paused) {
      this.system_time_offset = this.system_time_offset - (Math.floor((new Date()).getTime() / 1000) - this.system_time_paused);
      this.system_time_paused = 0;
    }
  }

  /* JS: UNSUPPORTED
  this.sleep = function(seconds) {
    core_time.sleep(seconds);
  }
  */

  this._stats = {};
  this._stats_start_t = 0;
  this._stats_show_t = 0;

  this.DEBUG_STATS_INTERVAL = 60 // every X seconds log stats of timings

  this._stats_start = function() {
    let t = (new Date()).getTime();
    if (!this._stats_start_t)
      this._stats_start_t = this._stats_show_t = t;
    if (t - this._stats_show_t > this.DEBUG_STATS_INTERVAL * 1000) {
      this._stats_show_t = t;
      this._stats_show();
    }
    return t;
  }

  this._stats_end = function(key, s) {
    let delta = (new Date()).getTime() - s;
    if (!(key in this._stats))
      this._stats[key] = { 'count': 0, 'total': 0, 'avg': 0, 'max': 0 };
    this._stats[key]['count'] += 1;
    this._stats[key]['total'] += delta;
    this._stats[key]['avg'] = this._stats[key]['total'] / this._stats[key]['count'];
    if (delta > this._stats[key]['max'])
      this._stats[key]['max'] = delta;
  }

  this._stats_show = function() {
    let total = (new Date()).getTime() - this._stats_start_t;
    let ss = this._stats;
    let stats = '';
    for (let s of Object.keys(ss).sort()) {
      let perc = Math.round(ss[s]['total'] / total * 1000);
      if (perc >= 5)
        stats += '    ' + ('' + s).leftJustify(80, " ") + ' (' + perc + '‰): { count: ' + ss[s]['count'] + ', avg: ' + Math.round(ss[s]['avg']) + 'ms, max: ' + Math.round(ss[s]['max']) + 'ms }\n';
    }
    let _tpsize = Object.values(this.index_topic_cache['data']).map(function(x) { return len(x); });
    console.info(('SYSTEM> DEBUG TIMINGS\n  total: {total}min\n' +
      '  mqtt_queue_delay: {cdelay}ms (recent/load: {cdelay}, queue length: {size})\n' + 
      //'  script_eval_cache: {schits}/{sctotal} hits ({scperc}%), {scsize} size, {scskip} uncacheable, {scdisabled} cache disabled, {scsign} signatures\n' + 
      '  topic cache: {tphits}/{tptotal} ({tpperc}%) hits, {tpsize} size\n' + 
      '  system_stats:\n{stats}').format({
      total: Math.round(total / 60000),
      delay: mqtt.queueDelay(), cdelay: mqtt.queueDelayCurrent(), size: mqtt.mqtt_communication_queue.length,
      //schits: scripting_js.script_eval_cache_hits, sctotal: scripting_js.script_eval_cache_hits + scripting_js.script_eval_cache_miss, 
      //  scperc: (scripting_js.script_eval_cache_hits + scripting_js.script_eval_cache_miss) > 0 ? Math.round(scripting_js.script_eval_cache_hits * 100 / (scripting_js.script_eval_cache_hits + scripting_js.script_eval_cache_miss)) : 0, scsize: len(scripting_js.script_eval_cache), scskip: scripting_js.script_eval_cache_skipped, scdisabled: scripting_js.script_eval_cache_disabled, scsign: len(scripting_js.script_eval_codecontext_signatures),
      tphits: this.index_topic_cache['hits'], tptotal: this.index_topic_cache['hits'] + this.index_topic_cache['miss'], tpperc: (this.index_topic_cache['hits'] + this.index_topic_cache['miss']) > 0 ? Math.round(this.index_topic_cache['hits'] * 100 / (this.index_topic_cache['hits'] + this.index_topic_cache['miss'])) : 0, 
        tpsize: _tpsize.length > 0 ? _tpsize.reduce(function(a, b) { return a + b}) : 0,
      stats: stats
    }));
    // '  topic matches cache: {tmhits}/{tmtotal} ({tmperc}%) hits, {tmsize} size\n' + 
    //  tmhits = _cache_topic_matches_hits, tmtotal = _cache_topic_matches_hits + _cache_topic_matches_miss, tmperc = round(_cache_topic_matches_hits * 100 / (_cache_topic_matches_hits + _cache_topic_matches_miss)) if (_cache_topic_matches_hits + _cache_topic_matches_miss) > 0 else 0, tmsize = len(_cache_topic_matches),
  }


  /***************************************************************************************************************************************************************
   *
   * ENTRIES MANAGEMENT
   *
   ***************************************************************************************************************************************************************/

  this.Entry = function(system, entry_id, definition, config) {
    let d = entry_id.indexOf("@");
    if (d < 0) {
      console.error("SYSTEM> Invalid entry id: {entry_id}, entry not loaded".format({entry_id: entry_id}));
      return null;
    }
    
    this.definition = deepcopy(definition, 5); // WARN! Do not modify definition in code below, only this.definition
    this.definition_loaded = deepcopy(definition, 5);
    
    this.id = entry_id;
    this.id_local = entry_id.slice(0, d);
    this.node_name = entry_id.slice(d + 1);
    this.is_local = null;
    this.node_config = config;
    if (!('type' in this.definition))
      this.definition['type'] = 'device' in this.definition ? 'device' : ('module' in this.definition ? 'module' : 'item');
    this.type = this.definition['type'];
    this.created = system.time();
    this.last_seen = 0;
    this.publish_last_seen = {};
    this.exports = system.exports;
    this.topic_rule_aliases = {};
    this.topic = system.entry_topic_lambda(this).bind(system);
    this.publish = system.entry_publish_lambda(this).bind(system);
    
    // Call this when entry.definition changes (should happen only during entry_load phase)
    this._refresh_definition_based_properties = function() {
      this.config = 'config' in this.definition ? this.definition['config'] : {};
      this.caption = 'caption' in this.definition ? this.definition['caption'] : this.id_local;
      if (!('publish' in this.definition))
        this.definition['publish'] = {};
      if (!('subscribe' in this.definition))
        this.definition['subscribe'] = {};
      if (!('on' in this.definition))
        this.definition['on'] = {};
      if (!('events_listen' in this.definition))
        this.definition['events_listen'] = [];
    }
    
    this._refresh_definition_based_properties();
  }
  
  /*
  Load a batch of definitions to instantiate entries.
  There are 2 phases for this process:
  - in first one (_entry_load_definition) we load and process each entry definition. During this phase on_entry_load callback is called and can invalidate previously loaded (and initialized) entries, that must be unloaded and reloaded and injected in this phase.
    in this phase a call to system.entries() will returns ALL entries, event the one loading right now (we can detect the state with entry.loaded flag)
    load, entry_load, entry_install handlers are called in this phase
  - in a second phase (_entry_load_init) all defined entries will be initialized
    init handler is called in this phase
  
  @param id_from_definition. If True: definitions = [ { ...definition...} ]; if False: definitions = { 'entry_id': { ... definition ... } }
  */
  this.entry_load = function(definitions, node_name = false, unload_other_from_node = false, id_from_definition = false, generate_new_entry_id_on_conflict = false) {
    if (!node_name)
      node_name = this.default_node_name;
    
    let loaded_defs = {};
    let loading_defs = {};
    let reload_definitions = {};
    let skipped_ids = [];
    let unloaded = [];
    while (len(definitions)) {
      for (let definition in definitions) {
        let entry_id = false;
        if (!id_from_definition)
          entry_id = definition;
        definition = definitions[definition];
        if (!('disabled' in definition) || !definition['disabled']) {
          let result = this._entry_load_definition(definition, node_name, entry_id, generate_new_entry_id_on_conflict, /* extended_result = */true);
          if (result && result['entry']) {
            if (this.handler_on_entry_load)
              for (let h of this.handler_on_entry_load.values())
                h(result['entry']);
            loading_defs[result['entry'].id] = result['entry'];
          } else if (result['message'] == 'no_changes')
            skipped_ids.push(result['id'])
        }
      }
      if (len(loading_defs)) {
        console.debug("SYSTEM> Loading entries, loaded definitions for {entries} ...".format({entries: Object.keys(loading_defs) }));
        if (this.handler_on_entry_load_batch)
          for (let h of this.handler_on_entry_load_batch.values()) {
            let reload_entries = h(loading_defs);
            if (reload_entries) {
              console.debug("SYSTEM> Loading entries, need to reload other entries {entries} ...".format({entries: reload_entries}));
              for (let rentry_id in reload_entries)
                if (!(rentry_id in reload_definitions) && rentry_id in this.all_entries) {
                  reload_definitions[rentry_id] = this.all_entries[rentry_id].definition_loaded;
                  this.entry_unload(rentry_id, False);
                  unloaded.push(rentry_id);
                }
            }
          }
      }
      if (len(reload_definitions)) {
        id_from_definition = false;
        definitions = reload_definitions;
        reload_definitions = {};
      } else
        definitions = false;
      for (let entry_id in loading_defs)
        loaded_defs[entry_id] = loading_defs[entry_id];
      loading_defs = {};
    }
  
    if (unload_other_from_node) {
      let todo_unload = [];
      for (let entry_id in this.all_entries)
        if (this.all_entries[entry_id].node_name == node_name && !(entry_id in loaded_defs) && !skipped_ids.includes(entry_id))
          todo_unload.push(entry_id);
      for (let entry_id of todo_unload) {
        this.entry_unload(entry_id);
        unloaded.push(entry_id);
      }
    }
    
    if (loaded_defs) {
      // Final loading phase, install final features. This must be done BEFORE init hooks (they must receive a fully loaded entry)
      for (let entry_id in loaded_defs) {
        this._entry_definition_normalize_after_load(loaded_defs[entry_id]);
        this._entry_events_install(loaded_defs[entry_id]);
        this._entry_actions_install(loaded_defs[entry_id]);
        this._entry_add_to_index(loaded_defs[entry_id]);
        loaded_defs[entry_id].loaded = true;
      }
      
      console.debug("SYSTEM> Loading entries, initializing {entries} ...".format({entries: Object.keys(loaded_defs)}));
      // Calls handler_on_entry_init
      for (let entry_id in loaded_defs)
        if (this.handler_on_entry_init)
          for (let h of this.handler_on_entry_init.values())
            h(loaded_defs[entry_id]);
      // Calls handler_on_entry_init_batch
      if (this.handler_on_entry_init_batch)
        for (let h of this.handler_on_entry_init_batch.values())
          h(loaded_defs);

      console.debug("SYSTEM> Loaded entries {entries}.".format({entries: Object.keys(loaded_defs)}));
    }
    
    if (this.handler_on_entries_change)
      for (let h in this.handler_on_entries_change)
        h(Object.keys(loaded_defs), unloaded);
  }
  
  this._entry_load_definition = function(definition, from_node_name = false, entry_id = false, generate_new_entry_id_on_conflict = false, extended_result = false) {
    if (!isinstance(definition, 'dict'))
      return !extended_result ? null : { "entry": null, "id": entry_id, "message": "error_invalid_definition" };

    if (!from_node_name) {
      let d = entry_id ? entry_id.indexOf("@") : -1;
      from_node_name = d >= 0 ? entry_id.slice(d + 1) : this.default_node_name;
    }
    
    if (!entry_id)
      entry_id = 'id' in definition ? definition['id'] : ('item' in definition ? definition['item'] : ('module' in definition ? definition['module'] : ('device' in definition ? definition['device'] : (''))));
    if (!entry_id)
      return !extended_result ? null : { "entry": null, "id": entry_id, "message": "error_no_id" };
    entry_id = entry_id.replace(/[^A-Za-z0-9@_-]+/g, '-');
    let d = entry_id.indexOf("@");
    if (d < 0)
      entry_id = entry_id + '@' + from_node_name;
    
    if (generate_new_entry_id_on_conflict && entry_id in this.all_entries) {
      d = entry_id.indexOf("@");
      entry_local_id = entry_id.slice(0, d);
      entry_node_name = entry_id.slice(d + 1);
      entry_id = entry_local_id;
      let i = 0;
      while (entry_id + '@' + entry_node_name in this.all_entries)
        entry_id = entry_local_id + '_' + (++ i);
      entry_id = entry_id + '@' + entry_node_name;
    }

    let new_signature = data_signature(definition);
    if (entry_id in this.all_entries) {
      if (new_signature && this.all_entries_signatures[entry_id] == new_signature)
        return !extended_result ? null : { "entry": null, "id": entry_id, "message": "no_changes" };
      console.debug("SYSTEM> Entry definition for {entry} changed signature, reloading it...".format({entry: entry_id}));
      this.entry_unload(entry_id);
    }
    
    let entry = new this.Entry(this, entry_id, definition, this.config);
    entry.is_local = entry.node_name == this.default_node_name;
    
    this._entry_events_load(entry);
    this._entry_actions_load(entry);
    entry._refresh_definition_based_properties();
    
    entry.loaded = false;
    this.all_entries[entry_id] = entry;
    this.all_entries_signatures[entry_id] = new_signature;
    if (!(entry.node_name in this.all_nodes))
      this.all_nodes[entry.node_name] = {};
    
    return !extended_result ? entry : { "entry": entry, "id": entry_id, "message": null };
  }

  this.entry_unload = function(entry_ids, call_on_entries_change = true) {
    if (typeof entry_ids == "string")
      entry_ids = [ entry_ids ];
    for (entry_id in entry_ids)
      if (entry_id in this.all_entries) {
        console.debug("SYSTEM> Unloading entry {id} ...".format({id: entry_id}));
        if (this.handler_on_entry_unload)
          for (let h of this.handler_on_entry_unload.values())
            h(this.all_entries[entry_id]);
          
        this.remove_event_listener_by_reference_entry(entry_id);
        this._entry_remove_from_index(this.all_entries[entry_id]);
        
        delete this.all_entries[entry_id];
        delete this.all_entries_signatures[entry_id];
        
        console.debug("SYSTEM> Unloaded entry {id}.".format({id: entry_id}));
      }

    // TODO I need to reset topic_cache. I can improve this by resetting only topic matching entry unloading ones
    this.topic_cache_reset();

    if (call_on_entries_change && this.handler_on_entries_change)
      for (let h in this.handler_on_entries_change)
        h([], entry_ids);
  }
  
  this.entry_reload = function(entry_id, call_on_entries_change = true) {
    if (typeof entry_ids == "string")
      entry_ids = [ entry_ids ];
    for (entry_id in entry_ids)
      if (entry_id in this.all_entries) {
        let definition = this.all_entries[entry_id].definition_loaded;
        this.entry_unload(entry_id, false);
        this.entry_load(definition, false, entry_id, false, false);
      }

    if (call_on_entries_change && this.handler_on_entries_change)
      for (let h in this.handler_on_entries_change)
        h(entry_ids, entry_ids);
  }
  
  this.entry_unload_node_entries = function(node_name) {
    let todo_unload = [];
    for (let entry_id in this.all_entries)
      if (this.all_entries[entry_id].node_name == node_name)
        todo_unload.push(entry_id);
    for (let entry_id of todo_unload)
      this.entry_unload(entry_id);
    
    if (this.handler_on_entries_change)
      for (let h in this.handler_on_entries_change)
        h([], todo_unload);
  }

  /**
   * Returns ALL entries loaded, or in loading phase, by the system. To get only fully loaded (and initialized) entries look at entry.loaded flag
   */
  this.entries = function() {
    return this.all_entries;
  }
  
  
  
  
  




  /***************************************************************************************************************************************************************
   *
   * GENERIC ENTRIES FUNCTIONS
   *
   ***************************************************************************************************************************************************************/

  this._entry_definition_normalize_after_load = function(entry) {
    if (entry.is_local) {
      if (!('entry_topic' in entry.definition))
        entry.definition['entry_topic'] = entry.type + '/' + entry.id_local;
      if (!('topic_root' in entry.definition))
        entry.definition['topic_root'] = entry.definition['entry_topic'];
    }
    
    for (let t in entry.definition['subscribe'])
      if ('publish' in entry.definition['subscribe'][t] && !('response' in entry.definition['subscribe'][t]))
        entry.definition['subscribe'][t]['response'] = entry.definition['subscribe'][t]['publish'];

    for (let k of ['qos', 'retain'])
      if (k in entry.definition)
        for (let topic_rule in entry.definition['publish'])
          if (!(k in entry.definition['publish'][topic_rule]))
            entry.definition['publish'][topic_rule][k] = entry.definition[k];

    if ('ignore_interval' in entry.definition)
      entry.definition['ignore_interval'] = read_duration(entry.definition['ignore_interval']);

    if ('publish' in entry.definition) {
      let res = {};
      for (let topic_rule in entry.definition['publish']) {
        if ('topic' in entry.definition['publish'][topic_rule])
          entry.topic_rule_aliases[topic_rule] = entry.topic(entry.definition['publish'][topic_rule]['topic']);
        if ('ignore_interval' in entry.definition['publish'][topic_rule])
          entry.definition['publish'][topic_rule]['ignore_interval'] = read_duration(entry.definition['publish'][topic_rule]['ignore_interval']);
        res[entry.topic(topic_rule)] = entry.definition['publish'][topic_rule];
      }
      entry.definition['publish'] = res;
    }
    
    if ('subscribe' in entry.definition) {
      let res = {};
      for (let topic_rule in entry.definition['subscribe']) {
        if ('topic' in entry.definition['subscribe'][topic_rule])
          entry.topic_rule_aliases[topic_rule] = entry.topic(entry.definition['subscribe'][topic_rule]['topic']);
        res[entry.topic(topic_rule)] = entry.definition['subscribe'][topic_rule];
      }
      entry.definition['subscribe'] = res;

      for (let topic_rule in entry.definition['subscribe']) {
        if ('response' in entry.definition['subscribe'][topic_rule]) {
          res = [];
          for (let t in entry.definition['subscribe'][topic_rule]['response']) {
            if (!isinstance(t, 'dict'))
              t = { 'topic': t };
            if ('topic' in t && t['topic'] != 'NOTIFY')
              t['topic'] = entry.topic(t['topic']);
            res.push(t);
          }
          entry.definition['subscribe'][topic_rule]['response'] = res;
        }
      }
    }

    for (let eventref in entry.definition['events_listen'])
      this.add_event_listener(entry.definition['events_listen'][eventref], entry, 'events_listen');

    notifications.entry_normalize(entry);
  }
  
  
  this._on_events_passthrough_listener_lambda = function(dest_entry, passthrough_conf) {
    let this_system = this;
    return function(entry, eventname, eventdata, caller, published_message) { return this_system._on_events_passthrough_listener(entry, eventname, eventdata, caller, published_message, dest_entry, passthrough_conf) };
  }
    
  this._on_events_passthrough_listener = function(source_entry, eventname, eventdata, caller, published_message, dest_entry, passthrough_conf) {
    let params = deepcopy(eventdata['params']);
    if (passthrough_conf['remove_keys'] && ('keys' in eventdata)) {
      for (let k in eventdata['keys'])
        delete params[k];
    }
    let exec_context = null;
    if ('init' in passthrough_conf)
      exec_context = scripting_js.script_exec(passthrough_conf['init'], { 'params': params });
    this._entry_event_publish_and_invoke_listeners(dest_entry, ("rename" in passthrough_conf) && passthrough_conf["rename"] ? passthrough_conf["rename"] : eventname, 'init' in passthrough_conf ? exec_context['params'] : params, eventdata['time'], 'events_passthrough', published_message);
  }

  /*
  Extract the exportable portion [L.0]+[L.0N] of the full entry definition
  */
  this._entry_definition_exportable = function(definition, export_config = null) {
    if (!export_config)
      export_config = ENTRY_DEFINITION_EXPORTABLE;
    let ret = {};
    for (let k in definition) {
      if (k in export_config && isinstance(definition[k], PRIMITIVE_TYPES)) {
        if (!isinstance(export_config[k], 'dict')) {
          ret[k] = definition[k];
        } else if (isinstance(definition[k], 'dict')) {
          ret[k] = {};
          for (let kk in definition[k])
            ret[k][kk] = this._entry_definition_exportable(definition[k][kk], export_config[k]);
        }
      }
    }
    return ret;
  }

  this._entry_add_to_index = function(entry) {
    /*
    Add the initialized entry (local or remote) to various indexes
    */
    entry.definition_exportable = this._entry_definition_exportable(entry.definition);
    for (let topic in entry.definition_exportable['publish'])
      this._entry_add_to_index_topic_published(entry, topic, entry.definition_exportable['publish'][topic]);
    for (let topic in entry.definition_exportable['subscribe'])
      this._entry_add_to_index_topic_subscribed(entry, topic, entry.definition_exportable['subscribe'][topic]);
  }
  
  this._entry_remove_from_index = function(entry) {
    // *!*!* DEBUG (code only in js version for debug purpose)
    if (!entry.definition_exportable) {
      console.warn('Invalid entry in _entry_remove_from_index', entry);
      return false;
    }
    for (let topic in entry.definition_exportable['publish'])
      this._entry_remove_from_index_topic_published(entry, topic);
    for (let topic in entry.definition_exportable['subscribe'])
      this._entry_remove_from_index_topic_subscribed(entry, topic);
  }

  this._entry_add_to_index_topic_published = function(entry, topic, definition) {
    if (!(topic in this.index_topic_published))
      this.index_topic_published[topic] = { 'definition': {}, 'entries': []};
    else if (topic in this.index_topic_published[topic]['entries'])
      this._entry_remove_from_index_topic_published(entry, topic, /*rebuild_definition = */false);
    this.index_topic_published[topic]['definition'] = this._entry_index_definition_build(this.index_topic_published[topic]['entries'], 'publish', topic, /*add_definition = */definition);
    this.index_topic_published[topic]['entries'].push(entry.id);
    this.topic_cache_reset();
  }
    
  this._entry_remove_from_index_topic_published = function(entry, topic, rebuild_definition = true) {
    array_remove(this.index_topic_published[topic]['entries'], entry.id);
    if (rebuild_definition)
      this.index_topic_published[topic]['definition'] = this._entry_index_definition_build(this.index_topic_published[topic]['entries'], 'publish', topic);
    this.topic_cache_reset();
  }

  this._entry_add_to_index_topic_subscribed = function(entry, topic, definition) {
    if (!(topic in this.index_topic_subscribed))
      this.index_topic_subscribed[topic] = { 'definition': {}, 'entries': []};
    else if (topic in this.index_topic_subscribed[topic]['entries'])
      this._entry_remove_from_index_topic_subscribed(entry, topic, /*rebuild_definition = */false);
    this.index_topic_subscribed[topic]['definition'] = this._entry_index_definition_build(this.index_topic_subscribed[topic]['entries'], 'subscribe', topic, /*add_definition = */definition);
    this.index_topic_subscribed[topic]['entries'].push(entry.id);
    this.topic_cache_reset();
  }
    
  this._entry_remove_from_index_topic_subscribed = function(entry, topic, rebuild_definition = true) {
    array_remove(this.index_topic_subscribed[topic]['entries'], entry.id);
    if (rebuild_definition)
      this.index_topic_subscribed[topic]['definition'] = this._entry_index_definition_build(this.index_topic_subscribed[topic]['entries'], 'subscribe', topic);
    this.topic_cache_reset();
  }

  this._entry_index_definition_build = function(entry_ids, mtype, topic, add_definition = null) {
    let definitions = [];
    for (let entry_id in entry_ids) {
      entry = this.entry_get(entry_ids[entry_id]);
      definitions.push(entry.definition_exportable[mtype][topic]);
    }
    if (add_definition)
      definitions.push(add_definition);
    return this._entry_index_definition_build_merge(definitions, ENTRY_DEFINITION_EXPORTABLE[mtype]);
  }

  this._entry_index_definition_build_merge = function(definitions, merge_config) {
    let res = {};
    for (let definition in definitions)
      for (let prop in definition)
        if (!(prop in merge_config) || merge_config[prop]) {
          if (!(prop in res))
            res[prop] = definition[prop];
          else if (isinstance(res[prop], ['int', 'str', 'bool', 'float']) && isinstance(definition[prop], ['int', 'str', 'bool', 'float']))
            res[prop] = '' + res[prop] + ', ' + definition[prop];
          else if (isinstance(res[prop], 'list') && isinstance(definition[prop], 'list'))
            res[prop] = res[prop] + definition[prop];
          else
            res[prop] = null;
        }
    //return {k:v for k,v in res.items() if v != null};
    for (let i in res) if (res[i] == null) delete res[i];
    return res;
  }

  this.entry_definition_add_default = function(entry, _default) {
    /*
    Use this method in "system_loaded" hook to add definitions to an entry, to be intended as base definitions (node config and module definitions and "load" hook will override them)
    Don't use this method AFTER "system_loaded" hook: during "entry_init" phase definitions are processed and normalized, and changing them could result in runtime errors.
    NOTE: List settings in first-level (for example: required, events_listen, ...) are joined together. List settings in other levels are NOT joined (like all other primitive types).
    */
    entry.definition = dict_merge(_default, entry.definition, 2); // 2 = lists in first level are joined
  }

  /**
   * Return if the id of the entry (reference) matches the one on the entry
   * If the reference has no "@", only the local part is matched (so, if there are more entries with the same local part, every one of these is matched)
   */
  this.entry_id_match = function(entry, reference) {
    if (typeof entry == "string") {
      if (entry == reference)
        return true;
      let d1 = entry.indexOf("@");
      let d2 = reference.indexOf("@");
      return (d1 < 0 && d2 >= 0 && entry == reference.slice(0, d2)) || (d1 >= 0 && d2 < 0 && entry.slice(0, d1) == reference);
    }
    return (entry.id == reference) || (reference.indexOf("@") < 0 && entry.id_local == reference);
  }

  this.entry_id_find = function(entry_id) {
    //OBSOLETE: return entry_id != "*" && entry_id.indexOf("@") < 0 ? entry_id + '@' + this.default_node_name : entry_id;
    if (entry_id == "*" || entry_id.indexOf("@") >= 0)
      return entry_id;
    for (let node_name in this.all_nodes)
      if ((entry_id + "@" + node_name) in this.all_entries)
        return entry_id + "@" + node_name;
    return null;
  }

  this.entry_get = function(entry_id) {
    /* OBSOLETE: (with parameter local = false)
    let d = entry_id.indexOf("@");
    if (d < 0)
      return entry_id + '@' + this.default_node_name in this.all_entries ? this.all_entries[entry_id + '@' + this.default_node_name] : null;
    return entry_id in this.all_entries && (!local || this.all_entries[entry_id].is_local) ? this.all_entries[entry_id] : null;
    */
    let id = this.entry_id_find(entry_id);
    return id ? this.all_entries[id] : null;
  }

  this.entries_definition_exportable = function() {
    let res = {}
    for (let entry_id in this.all_entries)
      if (this.all_entries[entry_id].type != 'module')
        res[entry_id] = this.all_entries[entry_id].definition_exportable;
    return res;
  }

  this.message_payload_serialize = function(payload) {
    return json_sorted_encode(payload);
  }

  this._re_topic_matches = new RegExp('^(?:(?<topic_simple>[a-zA-Z0-9#+_-][a-zA-Z0-9#+_/-]*)|/(?<topic_regex>.*)/)' + '(?:\\[(?:js:(?<js_filter>.*)|/(?<payload_regex_filter>.*)/|(?<payload_simple_filter>.*))\\])?$');
  this._re_topic_matches_cache = {}; // TODO put a limit on _re_topic_matches_cache (now it can grows forever!)
  //_cache_topic_matches = {}
  //_cache_topic_matches_hits = 0
  //_cache_topic_matches_miss = 0
  //_cache_topic_sem = threading.Semaphore()
  //CACHE_TOPIC_MATCHES_MAXSIZE=102400 # TODO Very high but should contain AT LEAST # of subscribed+published topic_rules * # of topic published on broker. It should be auto-compiled? Or, if it's too high, the management of _cache_topic_matches should be better
  //CACHE_TOPIC_MATCHES_PURGETIME=3600

  this.topic_matches = function(rule, topic, payload = null) {
    /*
    @param rule a/b | a/# | /^(.*)$/ | a/b[payload1|payload2] | a/#[/^(payload.*)$/] | /^(.*)$/[js: payload['a']==1 && matches[1] == 'x']
    @param payload if "null" payload is NOT checked, and result['matched'] is based ONLY on topic rule (extra rules are NOT checked)
    */

    let result = {
      'use_payload': null, // true if payload is needed for match
      'topic_matches': null, // If topic part of the rule matches, this is the list of regexp groups (or [true] for (no-regexp matchs). WARN) { This is filled even if the whole rule is not matched (if topic part matches but payload part unmatch)
      'matched': false, // Full match result
      'used': this.time()
    };
    let m = this._re_topic_matches.exec(rule);
    m = m ? m.groups : null;
    if (m) {
      if (m['topic_simple'])
        result['topic_matches'] = mqtt.topicMatchesMQTT(m['topic_simple'], topic) ? [true] : [];
      else if (m['topic_regex']) {
        try {
          // TODO put a limit on _re_topic_matches_cache
          if (!(m['topic_regex'] in this._re_topic_matches_cache))
            this._re_topic_matches_cache[m['topic_regex']] = new RegExp(m['topic_regex']);
          let mm = this._re_topic_matches_cache[m['topic_regex']].exec(topic);
          result['topic_matches'] = mm ? mm.slice() : [];
        } catch (exception) {
          console.error("SYSTEM> Regexp error in message rule: {rule}".format({rule: rule}), exception);
        }
      }
      if (result['topic_matches'].length) {
        result['use_payload'] = false;
        result['matched'] = true;
        if (payload != null) {
          if (m['payload_simple_filter']) {
            result['use_payload'] = true;
            result['matched'] = m['payload_simple_filter'].split("|").includes(payload);
          } else if (m['payload_regex_filter']) {
            result['use_payload'] = true;
            try {
              let mm = payload.match(new RegExp(m['payload_regex_filter']));
              result['matched'] = mm ? true : false;
            } catch (exception) {
              console.error("SYSTEM> Regexp error in message rule (payload part): {rule}".format({rule: rule}), exception);
            }
          } else if (m['js_filter']) {
            if (m['js_filter'].indexOf("payload") >= 0)
              result['use_payload'] = true;
            let ret = scripting_js.script_eval(m['js_filter'], {"topic": topic, "payload": payload, "matches": result['topic_matches']}, /*to_dict = */true, /*cache = */true);
            result['matched'] = ret ?  true : false;
          }
        }
      }
    } else {
      console.error("SYSTEM> Invalid message rule: {rule}".format({rule: rule}));
    }
    
    return result;
  }
  
  this._re_topic_match_priority = /^(topic|notify.*|description)$/;
  
  this.topic_match_priority = function(definition) {
    if ('topic_match_priority' in definition)
      return definition['topic_match_priority'];
    for (let k in definition)
      if (!this._re_topic_match_priority.exec(k))
        return 1;
    return 0;
  }

  this.topic_cache_reset = function() {
    this.index_topic_cache = { 'hits': 0, 'miss': 0, 'data': { } };
  }

  this.topic_cache_find = function(index, cache_key, topic, payload = null) {
    /*
    @param index is { topic:  { 'definition': { ... merged definition from all TOPIC published by entries ... }, 'entries': [ ... entry ids ... ]};
    @return (0: topic rule found, 1: topic metadata { 'definition': { ... merged definition from all topic published by entries ... }, 'entries': [ ... entry ids ... ]}, 2: matches)
    */
    if (!(cache_key in this.index_topic_cache['data']))
      this.index_topic_cache['data'][cache_key] = {};

    if (len(this.index_topic_cache['data'][cache_key]) > this.INDEX_TOPIC_CACHE_MAXSIZE) {
      let t = this.INDEX_TOPIC_CACHE_PURGETIME;
      while (len(this.index_topic_cache['data'][cache_key]) > this.INDEX_TOPIC_CACHE_MAXSIZE) {
        for (let x in this.index_topic_cache['data'][cache_key])
          if (this.index_topic_cache['data'][cache_key][x]['used'] <= this.time() - t)
            delete this.index_topic_cache['data'][cache_key][x];
        t = t > 1 ? t / 2 : -1;
      }
    }

    let topic_and_payload = null
    if (topic in this.index_topic_cache['data'][cache_key]) {
      if (!('use_payload' in this.index_topic_cache['data'][cache_key][topic])) {
        this.index_topic_cache['data'][cache_key][topic]['used'] = this.time();
        this.index_topic_cache['hits'] += 1;
        return this.index_topic_cache['data'][cache_key][topic]['result'];
      } else {
        topic_and_payload = topic + "[" + this.message_payload_serialize(payload) + "]";
        if (topic_and_payload in this.index_topic_cache['data'][cache_key]) {
          this.index_topic_cache['data'][cache_key][topic]['used'] = this.time();
          this.index_topic_cache['data'][cache_key][topic_and_payload]['used'] = this.time();
          this.index_topic_cache['hits'] += 1;
          return this.index_topic_cache['data'][cache_key][topic_and_payload]['result'];
        }
      }
    }
    
    this.index_topic_cache['miss'] += 1;
    let res = { 'used': this.time(), 'result': [] };
    let use_payload = false;
    for (let itopic in index) {
      let m = this.topic_matches(itopic, topic, payload);
      if (m['matched'])
        res['result'].push([itopic, index[itopic], m['topic_matches']]);
      if (m['use_payload'])
        use_payload = true;
    }
    if (!use_payload)
      this.index_topic_cache['data'][cache_key][topic] = res;
    else {
      this.index_topic_cache['data'][cache_key][topic] = { 'use_payload': true, 'used': this.time() };
      if (topic_and_payload == null)
        topic_and_payload = topic + "[" + this.message_payload_serialize(payload) + "]";
      this.index_topic_cache['data'][cache_key][topic_and_payload] = res;
    }
    return res['result'];
  }

  this.topic_published_definition_is_internal = function(definition) {
    return !(definition && ('description' in definition || 'type' in definition));
  }

  this.topic_published_definition = function(topic, payload = null, strict_match = false) {
    /*
    Return published definition, if present, of a published topic
    If multiple publish are found, first not internal is returned, if present (use "entries_publishers_of" if you want them all)
    */
    if (strict_match) {
      if (topic in this.index_topic_published)
        return this.index_topic_published[topic]['definition'];
    } else {
      let ret = this.topic_cache_find(this.index_topic_published, 'published', topic, payload);
      if (ret) {
        for (let t in ret)
          if (!this.topic_published_definition_is_internal(ret[t][1]['definition']))
            return ret[t][1]['definition'];
        return ret[0][1]['definition'];
      }
    }
    return null;
  }

  this.topic_subscription_list = function() {
    return list(this.index_topic_subscribed.keys());
  }

  this.topic_subscription_definition_is_internal = function(definition) {
    return !(definition && ('description' in definition || 'response' in definition))
  }

  this.topic_subscription_is_internal = function(topic, payload = null, strict_match = false) {
    let definition = this.topic_subscription_definition(topic, payload, strict_match);
    return this.topic_subscription_definition_is_internal(definition);
  }

  this.topic_subscription_definition = function(topic, payload = null, strict_match = false) {
    /*
    Return subscription definition, if present, of a subscribed topic
    If multiple subscriptions are found, first not internal is returned, if present (use "entries_subscribed_to" if you want them all)
    */
    if (strict_match)
      if (topic in this.index_topic_subscribed)
        return this.index_topic_subscribed[topic]['definition'];
    else {
      let ret = this.topic_cache_find(this.index_topic_subscribed, 'subscribed', topic, payload);
      if (ret) {
        for (let t in ret)
          if (!this.topic_subscription_definition_is_internal(ret[t][1]['definition']))
            return ret[t][1]['definition'];
        return ret[0][1]['definition'];
      }
    }
    return null;
  }

  this.entries_publishers_of = function(topic, payload = null, strict_match = false) {
    /*
    Search for all entries that can publish the topic passed, and return all topic metadatas (and matches, if subscribed with a regex pattern)
    WARN: if a topic_rule has a topic_match_priority = 0 (usually because its defined as a "catchall" topic rule, like ['base/#': {}]), and the same topic matches a subscribed topic of the same entry, that entry will NOT be listed (the topic will be considered only as a subscribed one, and not a published one)
    
    return {
      'ENTRY_ID': {
        'ENTRY_TOPIC': {
          'entry': [object],
          'definition': { ... },
          'matches': []
        }
      }
    }
    */
    let res = {};
    
    if (strict_match) {
      if (topic in this.index_topic_published)
        for (let entry_id of this.index_topic_published[topic]['entries']) {
          let entry = this.entry_get(entry_id);
          if (entry) {
            res[entry_id] = {
              'entry': entry,
              'definition': entry.definition['publish'][topic],
              'topic': topic,
              'matches': [],
            };
          } else
            console.error("SYSTEM> Internal error, entry references in index_topic_published not found: {entry_id}".format({entry_id: entry_id}));
        }

    } else {
      let ret = this.topic_cache_find(this.index_topic_published, 'published', topic, payload);
      for (let t in ret) {
        t = ret[t];
        for (let entry_id of t[1]['entries']) {
          let entry = this.entry_get(entry_id);
          if (entry) {
            let tmp = this.topic_match_priority(entry.definition['publish'][t[0]]);
            if (tmp > 0 || !this.entry_is_subscribed_to(entry, topic, payload)) {
              if (entry_id in res && tmp > this.topic_match_priority(res[entry_id]['definition']))
                delete res[entry_id];
              if (!(entry_id in res))
                res[entry_id] = {
                  'entry': entry,
                  'definition': entry.definition['publish'][t[0]],
                  'topic': t[0],
                  'matches': t[2],
                };
            }
          } else
            console.error("SYSTEM> Internal error, entry references in index_topic_published not found: {entry_id}".format({entry_id: entry_id}));
        }
      }
    }
    return res;
  }

  this.entries_subscribed_to = function(topic, payload = null, strict_match = false) {
    /*
    Search for all entries subscribed to that topic, and return all topic metadatas (and matches, if subscribed with a regex pattern)
    */
    
    let res = {};
    
    if (strict_match) {
      if (topic in this.index_topic_subscribed)
        for (let entry_id of this.index_topic_subscribed[topic]['entries']) {
          let entry = this.entry_get(entry_id);
          if (entry) {
            res[entry_id] = {
              'entry': entry,
              'definition': entry.definition['subscribe'][topic],
              'topic': topic,
              'matches': [],
            };
          } else
            console.error("SYSTEM> Internal error, entry references in index_topic_subscribed not found: {entry_id}".format({entry_id: entry_id}));
        }
    } else {
      let ret = this.topic_cache_find(this.index_topic_subscribed, 'subscribed', topic, payload);
      for (let t in ret) {
        t = ret[t];
        for (let entry_id of t[1]['entries']) {
          let entry = this.entry_get(entry_id);
          if (entry) {
            if (entry_id in res && this.topic_match_priority(entry.definition['subscribe'][t[0]]) > this.topic_match_priority(res[entry_id]['definition']))
              delete res[entry_id];
            if (!(entry_id in res))
              res[entry_id] = {
                'entry': entry,
                'definition': entry.definition['subscribe'][t[0]],
                'topic': t[0],
                'matches': t[2],
              };
          } else
            console.error("SYSTEM> Internal error, entry references in index_topic_subscribed not found: {entry_id}".format({entry_id: entry_id}));
        }
      }
    }
    return res;
  }

  this.entry_topic_published_definition = function(entry, topic, payload = null, strict_match = false, skip_topic_match_priority = false) {
    if (topic in entry.definition['publish'])
      return entry.definition['publish'];
    let res = null;
    if (!strict_match)
      for (let topic_rule in entry.definition['publish']) {
        let m = this.topic_matches(topic_rule, topic);
        if (m['matched']) {
          if (skip_topic_match_priority)
            return entry.definition['publish'][topic_rule];
          if (!res || this.topic_match_priority(entry.definition['publish'][topic_rule]) > this.topic_match_priority(res))
            res = entry.definition['publish'][topic_rule];
        }
      }
    return res
  }

  this.entry_is_publisher_of = function(entry, topic, payload = null) {
    return this.entry_topic_published_definition(entry, topic, false, true) ? true : false;
  }

  this.entry_topic_subscription_definition = function(entry, topic, payload = null, strict_match = false, skip_topic_match_priority = false) {
    if (topic in entry.definition['subscribe'])
      return entry.definition['subscribe'];
    let res = null;
    if (!strict_match)
      for (let topic_rule in entry.definition['subscribe']) {
        let m = this.topic_matches(topic_rule, topic);
        if (m['matched']) {
          if (skip_topic_match_priority)
            return entry.definition['subscribe'][topic_rule];
          if (!res || this.topic_match_priority(entry.definition['subscribe'][topic_rule]) > this.topic_match_priority(res))
            res = entry.definition['subscribe'][topic_rule];
        }
      }
    return res;
  }

  this.entry_is_subscribed_to = function(entry, topic, payload = null) {
    return this.entry_topic_subscription_definition(entry, topic, false, true) ? true : false;
  }




  /***************************************************************************************************************************************************************
   *
   * MANAGE MESSAGES PUBLISHED ON BROKER
   *
   ***************************************************************************************************************************************************************/
  
  this.message_counter = 0;

  this.Message = function(system, topic, payload, qos = null, retain = null, payload_source = null, received = 0, copy_id = -1) {
    if (copy_id == -1)
      this.id = system.message_counter ++;
    else
      this.id = copy_id;
    this.topic = topic;
    this.payload = payload;
    this.payload_source = payload_source;
    this.qos = qos;
    this.retain = retain;
    this.received = received; // timestamp in ms. If 0, it's a message created by code, but not really received
    this._publishedMessages = null;
    this._firstPublishedMessage = null;
    this._subscribedMessages = null;
    this._events = null;
    
    this.publishedMessages = function() {
      if (this._publishedMessages == null) {
        this._publishedMessages = [];
        let _s = system._stats_start();
        let entries = system.entries_publishers_of(this.topic, this.payload);
        system._stats_end('Message.publishedMessages().find', _s);
        system._stats_end('Message(' + this.topic + ').publishedMessages().find', _s);
        
        _s = system._stats_start();
        this._publishedMessages = [];
        for (let entry_id in entries) {
          let ignored = false;
          if ("ignore" in entries[entry_id]['entry'].definition)
            ignored = entries[entry_id]['entry'].definition["ignore"];
          if (!ignored && "ignore" in entries[entry_id]['definition'])
            ignored = entries[entry_id]['definition']["ignore"];
          if (!ignored) {
            let ignore_interval = 0;
            if ("ignore_interval" in entries[entry_id]['entry'].definition)
              ignore_interval = entries[entry_id]['entry'].definition["ignore_interval"];
            if ("ignore_interval" in entries[entry_id]['definition'])
              ignore_interval = entries[entry_id]['definition']["ignore_interval"];
            if (ignore_interval > 0 && this.topic in entries[entry_id]['entry'].publish_last_seen && (timems() / 1000) - entries[entry_id]['entry'].publish_last_seen[this.topic] < ignore_interval * 0.99)
              ignored = true
          }
          if (!ignored)
            this._publishedMessages.push(new system.PublishedMessage(system, this, entries[entry_id]['entry'], entries[entry_id]['topic'], entries[entry_id]['definition'], entries[entry_id]['matches'] != [true] ? entries[entry_id]['matches'] : []));
          //else
          //  logging.debug("SYSTEM> Ignored publishedmessage {entry_id}.{topic_rule} ({topic})".format({entry_id: entry_id, topic_rule: entries[entry_id]['topic'], topic: self.topic}));
        }
        system._stats_end('Message.publishedMessages().create', _s);
        system._stats_end('Message(' + this.topic + ').publishedMessages().create', _s);
      }
      return this._publishedMessages;
    }

    this.firstPublishedMessage = function() {
      /*
      Return first publishedMessaged NOT internal (if present), or internal (if no NOT internal is found)
      */
      if (this._publishedMessages && this._firstPublishedMessage == null) {
        for (let pm of this.publishedMessages().values())
          if (!pm.internal) {
            this._firstPublishedMessage = pm;
            break;
          }
        if (this._firstPublishedMessage == null)
          for (let pm of this.publishedMessages().values())
            this._firstPublishedMessage = pm;
      }
      return this._firstPublishedMessage;
    }
      
    this.subscribedMessages = function() {
      if (this._subscribedMessages == null) {
        this._subscribedMessages = [];
        let _s = system._stats_start();
        let entries = system.entries_subscribed_to(this.topic, this.payload);
        system._stats_end('Message.subscribedMessages().find', _s);
        system._stats_end('Message(' + this.topic + ').subscribedMessages().find', _s);
        
        _s = system._stats_start();
        this._subscribedMessages = [];
        for (let entry_id in entries)
          this._subscribedMessages.push(new system.SubscribedMessage(system, this, entries[entry_id]['entry'], entries[entry_id]['topic'], entries[entry_id]['definition'], entries[entry_id]['matches'] != [true] ? entries[entry_id]['matches'] : []));
        system._stats_end('Message.subscribedMessages().create', _s);
        system._stats_end('Message(' + this.topic + ').subscribedMessages().create', _s);
      }

      return this._subscribedMessages;
    }
    
    this.events = function() {
      if (this._events == null) {
        this._events = [];
        for (let pm of this.publishedMessages().values())
          this._events = [].concat(this._events, pm.events());
      }
      return this._events;
    }
    
    this.copy = function() {
      let m = new system.Message(system, this.topic, deepcopy(this.payload), this.qos, this.retain, this.payload_source, this.received, this.id);
      m._publishedMessages = this._publishedMessages;
      m._firstPublishedMessage = this._firstPublishedMessage;
      m._subscribedMessages = this._subscribedMessages;
      m._events = this._events;
      return m;
    }
  }

  this.PublishedMessage = function(system, message, entry, topic_rule, definition, matches, do_copy = false) {
    this.message = message;
    this.entry = entry;
    this.topic_rule = topic_rule;
    this.definition = definition;
    this.topic = !do_copy ? message.topic : deepcopy(message.topic);
    // NOTE: payload in PublishedMessage could be different from payload in message (if 'payload_transform' is in definition)
    let _s = system._stats_start();
    this.payload = !('payload_transform' in definition) ? (!do_copy ? message.payload : deepcopy(message.payload)) : system._entry_transform_payload(entry, message.topic, message.payload, definition['payload_transform']);
    system._stats_end('PublishedMessages.payload_transformed', _s);
    this.matches = !do_copy ? matches : deepcopy(matches);
    this.internal = system.topic_published_definition_is_internal(this.definition);
    this._events = null;
    this._notification = null;
      
    this.events = function() {
      if (this._events == null) {
        this._events = [];
        
        if ('events' in this.definition) {
          for (let eventname in this.definition['events']) {
            if (eventname.indexOf(":") < 0) {
              let eventdefs = isinstance(this.definition['events'][eventname], 'list') ? this.definition['events'][eventname] : [ this.definition['events'][eventname] ];
              for (let eventdef of eventdefs) {
                if (('listen_all_events' in system.config && system.config['listen_all_events']) || (eventname in system.events_listeners && ("*" in system.events_listeners[eventname] || this.entry.id in system.events_listeners[eventname] || this.entry.id_local in system.events_listeners[eventname]))) {
                  let _s = system._stats_start();
                  let event = system._entry_event_process(this.entry, eventname, eventdef, this);
                  system._stats_end('PublishedMessages.event_process', _s)
                  if (event) {
                    _s = system._stats_start();
                    let eventdata = system._entry_event_publish(this.entry, event['name'], event['params'], !message.retain ? system.time() : 0);
                    system._stats_end('PublishedMessages.event_publish', _s);
                    if (eventdata)
                      this._events.push(eventdata);
                  }
                }
              }
            }
          }
        }
      }
      return this._events;
    }
    
    this._notificationBuild = function() {
      this._notification = notifications.notification_build(this);
    }
    
    this.notificationString = function() {
      if (this._notification == null)
        this._notificationBuild();
      return this._notification['notification_string'];
    }
    
    this.notificationLevel = function() {
      if (this._notification == null)
        this._notificationBuild();
      return this._notification['notification_level'];
    }
      
    this.notificationLevelString = function() {
      if (this._notification == null)
        this._notificationBuild();
      return this._notification['notification_slevel'];
    }
  }

  this.SubscribedMessage = function(system, message, entry, topic_rule, definition, matches, do_copy = false) {
    this.message = message;
    this.entry = entry;
    this.topic_rule = topic_rule;
    this.definition = definition;
    this.topic = !do_copy ? message.topic : deepcopy(message.topic);
    this.payload = !do_copy ? message.payload : deepcopy(message.payload);
    this.matches = !do_copy ? matches : deepcopy(matches);
    this.internal = system.topic_subscription_definition_is_internal(this.definition);

    this.copy = function() {
      return SubscribedMessage(system, this.message, this.entry, this.topic_rule, this.definition, this.matches, /*do_copy = */true);
    }
  }

  this._current_received_message = null;

  this._on_mqtt_message = function(topic, payload_source, payload, qos, retain, matches, timems) {
    /*
    This handler is called for ALL messages received by broker. It finds if they are related to a topic published by an entry and manages it.
    This is called AFTER mqtt_on_subscribed_message (called only for subscribed topic)
    */
    let m = new this.Message(this, topic, payload, qos, retain, payload_source, /*received = */timems);
    this._current_received_message = {}; // JS: UNSUPPORTED: threading.local();
    this._current_received_message.message = m;
    
    // invoke events listeners
    for (let pm of m.publishedMessages().values()) {
      pm.entry.last_seen = Math.floor(timems / 1000);
      pm.entry.publish_last_seen[topic] = Math.floor(timems / 1000);
      let _s = this._stats_start();
      let events = pm.events();
      this._stats_end('on_mqtt_message.generate_events', _s);
      this._stats_end('on_mqtt_message(' + topic + ').generate_events', _s);
      _s = this._stats_start();
      for (let eventdata of events)
        this._entry_event_invoke_listeners(pm.entry, eventdata, 'message', pm);
      this._stats_end('on_mqtt_message.invoke_elisteners', _s);
      this._stats_end('on_mqtt_message(' + topic + ').invoke_elisteners', _s);
    }
    
    // manage responses callbacks
    _s = this._stats_start();
    this._subscribed_response_on_message(m);
    this._stats_end('on_mqtt_message.subscribed_response', _s);
    this._stats_end('on_mqtt_message(' + topic + ').subscribed_response', _s);

    // call external handlers
    _s = this._stats_start();
    if (this.handler_on_message)
      for (let h of this.handler_on_message.values())
        h(m.copy());
    this._stats_end('on_mqtt_message.handlers', _s);
    this._stats_end('on_mqtt_message(' + topic + ').handlers', _s);
  }

  this.current_received_message = function() {
    return this._current_received_message != null && 'message' in this._current_received_message ? this._current_received_message.message : null;
  }

  this._entry_event_process = function(entry, eventname, eventdef, published_message) {
    let ret = scripting_js.script_eval(eventdef, {"topic": published_message.topic, "payload": published_message.payload, "matches": published_message.matches}, /*to_dict = */true, /*cache = */true);
    if (ret === true)
      ret = {};
    return ret != null && ret != false ? { 'name': eventname, 'params': ret } : null;
  }

  this._entry_transform_payload = function(entry, topic, payload, transformdef) {
    return scripting_js.script_eval(transformdef, {"topic": topic, "payload": payload}, /*to_dict = */true, /*cache = */true);
  }
  
  this.entry_event_keys = function(entry, eventname) {
    return eventname in entry.events_keys ? entry.events_keys[eventname] : ('event_keys' in entry.definition ? entry.definition['event_keys'] : EVENT_KEYS);
  }
  
  this.entry_event_keys_index = function(key_values, temporary = false) {
    return (temporary ? "T:" : "") + json_sorted_encode(key_values);
  }
  
  this.entry_event_keys_index_is_temporary = function(keys_index) {
    return keys_index.startsWith("T:");
  }

  this._entry_event_publish = function(entry, eventname, params, time) {
    /*
    Given an event generated (by a published messaged, or by an event passthrough), process it's params to generate event data and store it's content in this.events_published history var
    Note: if an event has no "event_keys", it's data will be setted to all other stored data (of events with keys_index). If a new keys_index occours, the data will be merged with "no params-key" data.
    @param time timestamp event has been published, 0 if from a retained message, -1 if from an event data initialization, -X if from a stored event data (X is the original time)
    */
    let data = { 'name': eventname, 'time': time, 'params': params, 'changed_params': {}, 'keys': {} };
    let event_keys = this.entry_event_keys(entry, eventname);
    data['keys'] = params ? Object.fromEntries( Object.entries(params).map(function(v) { return event_keys.includes(v[0]) ? v : null }).filter(function(v) { return v; }) ) : {};
    let keys_index = this.entry_event_keys_index(data['keys']);
    
    if (time > 0 && (entry.id + '.' + eventname) in this.events_groups) {
      this.events_groups_push(entry.id + '.' + eventname, entry, data, event_keys, keys_index);
      return null;
    }

    return this._entry_event_publish_internal(entry, eventname, params, time, data, event_keys, keys_index);
  }
  
  this._entry_event_publish_internal = function(entry, eventname, params, time, data, event_keys, keys_index) {
    // If this is a new keys_index, i must merge data with empty keys_index (if present)
    if (keys_index != '{}' && eventname in this.events_published && entry.id in this.events_published[eventname] && '{}' in this.events_published[eventname][entry.id] && !(keys_index in this.events_published[eventname][entry.id]))
      for (k in this.events_published[eventname][entry.id]['{}']['params'])
        if (!(k in params))
          params[k] = this.events_published[eventname][entry.id]['{}']['params'][k];
    
    this.__entry_event_publish_store(entry, eventname, keys_index, data, time, event_keys);
    
    // If this is an empty keys_index, i must pass data to other stored data with keys_index (i can ignore temporary data)
    if (keys_index == '{}' && eventname in this.events_published && entry.id in this.events_published[eventname])
      for (let keys_index2 in this.events_published[eventname][entry.id])
        if (keys_index2 != '{}' && !this.entry_event_keys_index_is_temporary(keys_index2)) {
          let data2 = { 'name': eventname, 'time': time, 'params': deepcopy(params), 'changed_params': {}, 'keys': this.events_published[eventname][entry.id][keys_index2]['keys'] }
          this.__entry_event_publish_store(entry, eventname, keys_index2, data2, time, event_keys);
        }
    
    return data;
  }

  this.__entry_event_publish_store = function(entry, eventname, keys_index, data, time, event_keys) {
    if (!(eventname in entry.events)) {
      entry.events[eventname] = ['?'];
      console.warn("Generated an event not declared by the entry, added now to the declaration. Entry: {entry}, event: {eventname}".format({entry: entry.id, eventname: eventname}));
    }
    
    // Extract changed params (from previous event detected)
    if (eventname in this.events_published && entry.id in this.events_published[eventname] && keys_index in this.events_published[eventname][entry.id]) {
      for (let k in data['params'])
        if (!(k in event_keys) && (!(k in this.events_published[eventname][entry.id][keys_index]['params']) || data['params'][k] != this.events_published[eventname][entry.id][keys_index]['params'][k]))
          data['changed_params'][k] = data['params'][k];
      for (let k in this.events_published[eventname][entry.id][keys_index]['params'])
        if (!(k in data['params']))
          data['params'][k] = this.events_published[eventname][entry.id][keys_index]['params'][k]
    } else
      for (let k in data['params'])
        if (!(k in event_keys))
          data['changed_params'][k] = data['params'][k];

    if (!(eventname in this.events_published))
      this.events_published[eventname] = {};
    if (!(entry.id in this.events_published[eventname]))
      this.events_published[eventname][entry.id] = {};
    if (time < 0 || (!isinstance(data['params'], 'dict') || !('temporary' in data['params']) || !data['params']['temporary']))
      this.events_published[eventname][entry.id][keys_index] = data;
    else if ('temporary' in data['params'] && data['params']['temporary'])
      this.events_published[eventname][entry.id][this.entry_event_keys_index(data['keys'], true)] = data;
    
    return data;
  }

  this.event_get_invalidate_on_action = function(entry, action, full_params, if_event_not_match_decoded = null) {
    // Devo invalidare dalla cache di event_get tutti gli eventi che potrebbero essere interessati da questo action
    // 1. Se ho if_event_not_match mi baso sul "condition" impostato li per il reset. Se condition non c'è, deve resettare tutte le cache dell'evento
    // 2. Altrimenti prendo i params della action prima di trasformarli nel payload (quindi dopo aver applicat init e actiondef['init']), prendo solo gli "EVENT_KEYS" e li trasformo in una condition. Anche qui, se non ci sono dati utili la condition è vuota e resetta tutto.
    // ATTENZIONE: Se la gestione di 'port' o 'channel' (o altri event_keys) avviene direttamente nella definizione della action (quindi non dentro degli init, o nei parametri passati alla action, ma nel codice js che trasforma parametri in payload) non posso rilevarli e quindi la cache invalida tutto (e non solo i parametri interessati)
    
    let eventname = this.transform_action_name_to_event_name(action);
    let condition = null, event_keys = null;
    if (eventname in this.events_published && entry.id in this.events_published[eventname]) {
      if (if_event_not_match_decoded)
        condition = if_event_not_match_decoded['condition'];
      else {
        event_keys = this.entry_event_keys(entry, eventname);
        condition = full_params ? Object.entries(full_params).map(function(v) { return event_keys.includes(v[0]) ? "params['" + v[0] + "'] == " + json_export(v[1]) : null }).filter(function(v) { return v; }).join(" && ") : "";
      }

      let to_delete = []
      for (let keys_index in this.events_published[eventname][entry.id])
        if (!condition || this._entry_event_params_match_condition(this.events_published[eventname][entry.id][keys_index], condition))
          to_delete.push(keys_index);
      for (let i in to_delete) {
        i = to_delete[i];
        delete this.events_published[eventname][entry.id][i];
      }
    }
  }

  this._entry_event_invoke_listeners = function(entry, eventdata, caller, published_message = null) {
    /*
    Call this method when an entry should emit an event
    This invokes the event listeners of the entry
    @params eventdata contains { "params": ..., "changed_params": ...}
    */
    
    //console.debug("_entry_event_invoke_listeners " + str(eventdata) + " | " + str(this.events_listeners))
    let eventname = eventdata['name']
    if (eventname in this.events_listeners)
      for (let entry_ref in this.events_listeners[eventname])
        if (entry_ref == '*' || this.entry_id_match(entry, entry_ref))
          //console.debug("_entry_event_invoke_listeners_match" + str(this.events_listeners[eventname][entry_ref]))
          for ([listener, condition, reference_entry_id] of this.events_listeners[eventname][entry_ref])
            if (listener) {
              let _s = this._stats_start();
              if (condition == null || this._entry_event_params_match_condition(eventdata, condition))
                //console.debug("_entry_event_invoke_listeners_GO")
                listener(entry, eventname, deepcopy(eventdata), caller, published_message);
              this._stats_end('event_listener(' + listener + '|' + condition + ')', _s);
            }
    
    if (this.handler_on_all_events)
      for (let h of this.handler_on_all_events.values())
        h(entry, eventname, deepcopy(eventdata), caller, published_message);
  }

  this._entry_event_params_match_condition = function(eventdata, condition) {
    /*
    @params eventdata { 'params' : ..., ... }
    */
    return scripting_js.script_eval(condition, {'params': eventdata['params'], 'changed_params': eventdata['changed_params'], 'keys': eventdata['keys']}, /*to_dict = */false, /*cache = */true);
  }

  this._entry_event_publish_and_invoke_listeners = function(entry, eventname, params, time, caller, published_message) {
    // @param caller is "events_passthrough" in case of events_passthrough, "group" for event grouping (see events_groups)
    let eventdata = this._entry_event_publish(entry, eventname, params, time);
    if (eventdata)
      this._entry_event_invoke_listeners(entry, eventdata, caller, published_message);
  }

  this.entry_topic_lambda = function(entry) {
    return function(topic) { return this.entry_topic(entry, topic) };
  }

  this.entry_topic = function(entry, topic) {
    let result = this.__entry_topic(entry, topic);
    if (result == 'health')
      console.error("DEBUG> entry_topic HEALTH ERROR, entry = {entry}, is_local = {is_local}, aliases = {aliases}, definition = {definition})".format({entry: entry.id, is_local: entry.is_local, aliases: entry.topic_rule_aliases, definition: entry.definition}));
    return result;
  }

  this.__entry_topic = function(entry, topic) {
    if (!entry.is_local)
      return topic;

    // OBSOLETE (/topic should not be used)
    //if (topic.startswith('/')) {
    //  return topic.slice(1);
    if (topic.startsWith('./'))
      return ('topic_root' in entry.definition ? entry.definition['topic_root'] + '/' : '') + topic.slice(2);
    if (topic == '.')
      return 'topic_root' in entry.definition ? entry.definition['topic_root'] : '';
    if (topic.startsWith('@/'))
      return ('entry_topic' in entry.definition ? entry.definition['entry_topic'] + '/' : '') + topic.slice(2);
    if (topic == '@')
      return 'entry_topic' in entry.definition ? entry.definition['entry_topic'] : '';
    if (topic in entry.topic_rule_aliases)
      return entry.topic_rule_aliases[topic];
    return topic;
  }

  this.entry_publish_lambda = function(entry) {
    return function(topic, payload = null, qos = null, retain = null, response_callback = null, no_response_callback = null, response_id = null) { return this.entry_publish(entry, topic, payload, qos, retain, response_callback, no_response_callback, response_id) };
  }

  this.entry_publish = function(entry, topic, payload = null, qos = null, retain = null, response_callback = null, no_response_callback = null, response_id = null) {
    /*
    Installed as entry.publish, publish a topic on mqtt
    */
    if (topic == '' && this.entry_publish_current_default_topic())
      topic = this.entry_publish_current_default_topic();

    topic = this.entry_topic(entry, topic);

    if (qos == null)
      qos = topic in entry.definition['publish'] && 'qos' in entry.definition['publish'][topic] ? entry.definition['publish'][topic]['qos'] : 0;
    if (retain == null)
      retain = topic in entry.definition['publish'] && 'retain' in entry.definition['publish'][topic] ? entry.definition['publish'][topic]['retain'] : false;
    let message = new this.Message(topic, payload, qos, retain);
    
    if (response_callback || no_response_callback)
      this.subscribe_response(entry, message, response_callback, no_response_callback, response_id);
    
    this.broker().publish(topic, payload, qos, retain);
  }

  this.entry_publish_current_default_topic_var = null;

  this.entry_publish_current_default_topic = function(set_topic = null) {
    if (this.entry_publish_current_default_topic_var == null)
      this.entry_publish_current_default_topic_var = threading.local();
    if (set_topic)
      this.entry_publish_current_default_topic_var.topic = set_topic;
    return 'topic' in this.entry_publish_current_default_topic_var ? this.entry_publish_current_default_topic_var.topic : null;
  }

  this.subscribe_response = function(entry, message, callback = false, no_response_callback = false, id = false, default_count = 1, default_duration = 5) {
    /*
    Temporarily subscribe to responses of a published message (other message emitted as described in topic metadata 'response' field)
    @param callback (entry, id, message, matches, final, response_to_message)
    @param no_response_callback (entry, id, response_to_message)
    @param id if you specify this id with a string, && there is already a subscription done with this id, no new subscription will be generated. The id is also passed to callbacks. Usually you should use it with count > 1.
    @param default_count Number of responses it should detect (and call the callback for) before deleting the subscription.
    @param default_duration the system will wait for answer for this amount of seconds, && after that it will delete the subscription. If no answer arrive, no_response_callback is called.
    
    @return true if subscribed (so callback or no_response_callback will be called), false if not (id already subscribed, or no 'response' declared - in this case NO callback will be called)
    */
    if (id)
      for (let x of this.subscribed_response.values())
        if (x['id'] && x['id'] == id)
          return false;
        
    let s = { 'message': message, 'callback': callback, 'no_response_callback': no_response_callback, 'entry': entry, 'id': id, 'listeners': [] };

    // Add specific listeners, as described in metadata 'response'
    let subs = this.entries_subscribed_to(message.topic, message.payload);
    for (let entry_id  in subs) {
      let r = subs[entry_id];
      if (r['definition'] && 'response' in r['definition'])
        for (let t in r['definition']['response'])
          if ('topic' in t) {
            let rtopic_rule = t['topic'];
            if (rtopic_rule.indexOf("{") >= 0)
              for (let i in r['matches'])
                rtopic_rule = rtopic_rule.replace("{matches[" + i + "]}", "" + r['matches'][i]);
            s['listeners'].push({ 'topic_rule': rtopic_rule, 'expiry': timems() + ('duration' in t ? read_duration(t['duration']) : default_duration) * 1000, 'count': 0, 'max_count': 'count' in t ? t['count'] : default_count });
          }
    }
    
    if (!s['listeners'])
      return false;
    
    this.subscribed_response.push(s);
    
    return true;
  }

  this._subscribed_response_on_message = function(message) {
    /*
    Listen for all mqtt messages to find response topics
    */

    //
    // Manages "subscribe_response"
    //
    let now = this.timems();
    let delay = Math.round(mqtt.queueDelay() / 1000 + 0.49) * 1000;
    // If there is a lot of delay in mqtt queue, we can assume there are probably a lot of messages managed by mqtt broker, so it could be a normal slowly processing of messages. So we add some more delay (20%).
    delay = delay * 1.2;
    
    for (let x of this.subscribed_response.values()) {
      let do_remove = false;
      for (let l of x['listeners'].values())
        if (l['expiry'] + delay > now && (l['count'] == 0 || l['count'] < l['max_count'])) {
          let matches = this.topic_matches(l['topic_rule'], message.topic, message.payload);
          if (matches['matched']) {
            l['count'] = l['count'] + 1;
            let final = true;
            for (let m of x['listeners'].values())
              if (m['count'] > 0 && m['max_count'] > 0) {
                final = false;
                break;
              }
            if (x['callback'])
              x['callback'](x['entry'], x['id'], message, final, x['message']);
            x['called'] = true
          }
          do_remove = true;
        } else
          do_remove = true;
      if (do_remove)
        x['listeners'] = x['listeners'].filter(function(l) {return l['expiry'] + delay > now && (l['count'] == 0 || l['count'] < l['max_count']) });
    }
  }

  this._subscription_timer_thread = async function() {
    /*
    An internal thread, initialied by init(), that scans for expired subscribed response topics (@see subscribe_response)
    */
    while (thread_check(this.subscription_thread)) {
      let now = this.timems();
      let delay = Math.round(mqtt.queueDelay() / 1000 + 0.49) * 1000;
      // If there is a lot of delay in mqtt queue, we can assume there are probably a lot of messages managed by mqtt broker, so it could be normal a slowly processing of messages. So we add some more delay (20%).
      delay = delay * 1.2;
      
      let expired_response = []
      for (let x of this.subscribed_response.values()) {
        let expired = [];
        for (let l of x['listeners'].values())
          if (l['expiry'] + delay <= now)
            expired.push(l);
        if (expired)
          x['listeners'] = x['listeners'].filter(function (l) { return !expired.includes(l); });
        
        if (!x['listeners']) {
          if (x['no_response_callback'] && !('called' in x))
            x['no_response_callback'](x['entry'], x['id'], x['message']);
          expired_response.push(x);
        }
      }
      if (expired_response)
        this.subscribed_response = this.subscribed_response.filter(function(x) { return !expired_response.includes(x); });

      this.events_groups_check();
      await thread_sleep(.5);
    }
  }

  this.events_groups_push = function(egkey, entry, data, event_keys, keys_index) {
    if (keys_index in this.events_groups[egkey]['data'] && data['time'] - this.events_groups[egkey]['data'][keys_index]['time'] >= this.events_groups[egkey]['group_time']) {
      let eventdata = this._entry_event_publish_internal(entry, data['name'], this.events_groups[egkey]['data'][keys_index]['data']['params'], this.events_groups[egkey]['data'][keys_index]['data']['time'], this.events_groups[egkey]['data'][keys_index]['data'], event_keys, keys_index)
      if (eventdata)
        this._entry_event_invoke_listeners(entry, eventdata, 'group', null);
      delete this.events_groups[egkey]['data'][keys_index];
    }
    if (!(keys_index in this.events_groups[egkey]['data']))
      this.events_groups[egkey]['data'][keys_index] = {
        'time': data['time'], 
        'data': data,
      };
    else
      for (let k in data['params'])
        this.events_groups[egkey]['data'][keys_index]['data']['params'][k] = data['params'][k];
  }

  this.events_groups_check = function() {
    let now = mqtt.queueTimems()
    if (now > 0)
      now = Math.floor(now / 1000)
    else
      now = this.time();
    for (let egkey in this.events_groups) {
      let to_delete = [];
      for (let keys_index in this.events_groups[egkey]['data']) {
        if (now - this.events_groups[egkey]['data'][keys_index]['time'] >= this.events_groups[egkey]['group_time']) {
          let d = egkey.indexOf(".");
          if (d > 0) {
            let entry = this.entry_get(egkey.slice(0, d));
            if (entry) {
              let eventname = egkey.slice(d + 1);
              let event_keys = this.entry_event_keys(entry, eventname);
              let eventdata = this._entry_event_publish_internal(entry, eventname, this.events_groups[egkey]['data'][keys_index]['data']['params'], this.events_groups[egkey]['data'][keys_index]['data']['time'], this.events_groups[egkey]['data'][keys_index]['data'], event_keys, this.entry_event_keys_index(this.events_groups[egkey]['data'][keys_index]['data']['keys']));
              if (eventdata)
                this._entry_event_invoke_listeners(entry, eventdata, 'group', null);
              to_delete.push(keys_index);
            }
          }
        }
      }
      for (let keys_index of to_delete)
        delete this.events_groups[egkey]['data'][keys_index];
    }
  }



  /***************************************************************************************************************************************************************
   *
   * EVENTS & ACTIONS
   *
   ***************************************************************************************************************************************************************/

  this._entry_events_load = function(entry) {
    entry.on = this.entry_on_event_lambda(entry);
  }
    
  this._entry_events_install = function(entry) {
    /*
    Initializes events for entry entry
    */
    entry.events = {};
    entry.events_keys = {};
    for (let topic in entry.definition['publish'])
      if ('events' in entry.definition['publish'][topic])
        for (let eventname in entry.definition['publish'][topic]['events']) {
          if (eventname.indexOf(":") < 0) {
            if (!(eventname in entry.events))
              entry.events[eventname] = [];
            entry.events[eventname].push(topic);
          } else if (eventname.endsWith(":keys"))
            entry.events_keys[eventname.slice(0, -5)] = entry.definition['publish'][topic]['events'][eventname];
          else if (eventname.endsWith(":init")) {
            let data = isinstance(entry.definition['publish'][topic]['events'][eventname], 'list') ? entry.definition['publish'][topic]['events'][eventname] : [ entry.definition['publish'][topic]['events'][eventname] ];
            for (let eventparams of data) 
              this._entry_event_publish(entry, eventname.slice(0, -5), eventparams, -1);
          } else if (eventname.endswith(':group') && isinstance(entry.definition['publish'][topic]['events'][eventname], 'int') && entry.definition['publish'][topic]['events'][eventname] > 0)
            this.events_groups[entry.id + '.' + eventname.slice(0, -6)] = { 'group_time': entry.definition['publish'][topic]['events'][eventname], 'data': {}};
        }
    if ('events' in entry.definition)
      for (let eventname in entry.definition['events']) {
        if (eventname.endsWith(":keys"))
          entry.events_keys[eventname.slice(0, -5)] = entry.definition['events'][eventname];
        else if (eventname.endsWith(":init")) {
          let data = isinstance(entry.definition['events'][eventname], 'list') ? entry.definition['events'][eventname] : [ entry.definition['events'][eventname] ];
          for (let eventparams of data) 
            this._entry_event_publish(entry, eventname.slice(0, -5), eventparams, -1);
        } else if (eventname.endsWith(':group') && isinstance(entry.definition['events'][eventname], 'int') && entry.definition['events'][eventname] > 0)
          this.events_groups[entry.id + '.' + eventname.slice(0, -6)] = { 'group_time': entry.definition['events'][eventname], 'data': {}};
      }
        
    // events_passthrough translates in event_propagation via on/events definition
    if ('events_passthrough' in entry.definition)
      if (isinstance(entry.definition['events_passthrough'], 'str'))
        entry.definition['events_passthrough'] = [ entry.definition['events_passthrough'] ];
      for (let eventref in entry.definition['events_passthrough']) {
        let ep = entry.definition['events_passthrough'][eventref];
        if (isinstance(ep, 'str'))
          ep = { "on": ep };
        if (!("remove_keys" in ep))
          ep["remove_keys"] = true;
        this.on_event(ep["on"], this._on_events_passthrough_listener_lambda(entry, ep), entry, 'events_passthrough');
        let eventname = "rename" in ep ? ep["rename"] : null;
        if (!eventname) {
          let ref = this.decode_event_reference(ep["on"]);
          eventname = ref['event'];
        }
        if (eventname && !(eventname in entry.events))
          entry.events[eventname] = ['#passthrough'];
      }
  }

  this._entry_actions_load = function(entry) {
    entry.do = this.entry_do_action_lambda(entry);
  }

  this._entry_actions_install = function(entry) {
    /*
    Initializes actions for entry entry
    */
    entry.actions = {};
    for (let topic in entry.definition['subscribe'])
      if ('actions' in entry.definition['subscribe'][topic])
        for (let actionname in entry.definition['subscribe'][topic]['actions']) {
          if (actionname.indexOf(":") < 0) {
            if (!(actionname in entry.actions))
              entry.actions[actionname] = [];
            entry.actions[actionname].push(topic);
          } else if (actionname.endsWith(":init")) {
            let data = isinstance(entry.definition['subscribe'][topic]['actions'][actionname], 'list') ? entry.definition['subscribe'][topic]['actions'][actionname] : [ entry.definition['subscribe'][topic]['actions'][actionname] ];
            for (let eventparams of data) {
              entry.events['action/' + actionname.slice(0, -5)] = [ '#action' ];
              this._entry_event_publish(entry, 'action/' + actionname.slice(0, -5), eventparams, -1);
            }
          }
        }
    if ('actions' in entry.definition)
      for (let actionname in entry.definition['actions']) {
        if (actionname.endsWith(":init")) {
          let data = isinstance(entry.definition['actions'][actionname], 'list') ? entry.definition['actions'][actionname] : [ entry.definition['actions'][actionname] ];
          for (let eventparams of data) {
            entry.events['action/' + actionname.slice(0, -5)] = [ '#action' ];
            this._entry_event_publish(entry, 'action/' + actionname.slice(0, -5), eventparams, -1);
          }
        }
      }
  }

  this.entry_support_event = function(entry, eventname) {
    if ('events' in entry)
      return eventname in entry.events;
    // If called during "system_loaded" phase, i must cycle through published topics
    if ('publish' in entry.definition)
      for (let topic in entry.definition['publish'])
        if ('events' in entry.definition['publish'][topic])
          if (eventname in entry.definition['publish'][topic]['events'] && eventname.indexOf(":") < 0)
            return true;
    return false;
  }
  
  this.entry_events_supported = function(entry) {
    return Object.keys(entry.events);
  }

  this.on_event = function(eventref, listener = null, reference_entry = null, reference_tag = null) {
    /*
    Adds an event listener based on the event reference string "entry.event(condition)"
    @param eventref 
    @param listener a callback, defined as listener(entry, eventname, eventdata, caller, published_message) - caller = "message|import|events_passthrough", published_message = source message (null for import)
    @param reference_entry The entry generating this reference. If an entry is doing this call, you MUST pass this parameter. It's used to clean the enviroment when the caller in unloaded. Also used for implicit reference (if eventref dont contains entry id).
    @param reference_tag Just for logging purpose, the context of the entry defining the the event_reference (so who reads the log could locate where the event_reference is defined)
    */
    if (!reference_entry)
      console.warn("SYSTEM> Called system.on_event without a reference entry: {eventref}".format({eventref: eventref}));
    let d = !isinstance(eventref, 'dict') ? this.decode_event_reference(eventref, /*default_entry_id = */reference_entry ? reference_entry.id : null) : eventref;
    if (!d)
      console.error("#{entry}> Invalid '{type}' definition{tag}: {defn}".format({entry: reference_entry ? reference_entry.id : '?', type: listener ? 'on event' : 'events_listen', tag: reference_tag ? (' in ' + reference_tag) : '', defn: eventref}));
    else {
      if (!(d['event'] in this.events_listeners))
        this.events_listeners[d['event']] = {};
      //OBSOLETE: d['entry'] = this.entry_id_find(d['entry']);
      if (!(d['entry'] in this.events_listeners[d['event']]))
        this.events_listeners[d['event']][d['entry']] = [];
      this.events_listeners[d['event']][d['entry']].push([listener, d['condition'], reference_entry ? reference_entry.id : null]);
    }
  }

  this.add_event_listener = function(eventref, reference_entry = null, reference_tag = null) {
    /*
    Add a generic listener for event (so the events are stored on "listened_events" parameter on handlers, and they can be fetched by event_get())
    */
    this.on_event(eventref, null, reference_entry, reference_tag);
  }

  this.entry_on_event_lambda = function(entry) {
    return function(event, listener, condition = null, reference_entry = null, reference_tag = null) { return this.entry_on_event(entry, event, listener, condition, reference_entry, reference_tag) };
  }

  this.entry_on_event = function(entry, event, listener, condition = null, reference_entry = null, reference_tag = null) {
    /*
    Adds an event listener on the specified entry.event(condition)
    @param event name of event matched
    @param listener a callback, defined as listener(entry, eventname, eventdata, caller, published_message)
    @param condition javascript condition to match event. Example: "port = 1 && value < 10"
    @param reference_entry The entry generating this reference. If an entry is doing this call, you MUST pass this parameter. It's used to clean the enviroment when the caller in unloaded. Also used for implicit reference (if eventref dont contains entry id).
    @param reference_tag Just for logging purpose, the context of the entry defining the the event_reference (so who reads the log could locate where the event_reference is defined)
    */
    this.on_event({'entry': entry.id, 'event': event, 'condition': condition}, listener, reference_entry, reference_tag);
  }
  
  /**
   * Remove all event listener with target or reference equal to reference_entry_id
   */
  this.remove_event_listener_by_reference_entry = function(reference_entry_id) {
    for (let eventname in this.events_listeners) {
      for (let entry_ref in this.events_listeners[eventname]) {
        if (this.entry_id_match(entry_ref, reference_entry_id))
          delete this.events_listeners[eventname][entry_ref];
        else {
          for (let i = this.events_listeners[eventname][entry_ref].length - 1; i >= 0; i--)
            if (this.events_listeners[eventname][entry_ref][i][2] == reference_entry_id)
              this.events_listeners[eventname][entry_ref].splice(i, 1);
          if (!this.events_listeners[eventname][entry_ref].length)
            delete this.events_listeners[eventname][entry_ref];
        }
      }
      if (!Object.keys(this.events_listeners[eventname]).length)
        delete this.events_listeners[eventname];
    }
  }

  this.entry_support_action = function(entry, actionname) {
    if ('actions' in entry)
      return actionname in entry.actions;
    // If called during "system_loaded" phase, i must cycle through published topics
    if ('subscribe' in entry.definition)
      for (let topic in entry.definition['subscribe'])
        if ('actions' in entry.definition['subscribe'][topic])
          if (actionname in entry.definition['subscribe'][topic]['actions'] && actionname.indexOf(":") < 0)
            return true;
    return false;
  }
  
  this.entry_actions_supported = function(entry) {
    return Object.keys(entry.actions);
  }

  this.do_action = function(actionref, params = {}, reference_entry_id = null, if_event_not_match = false, if_event_not_match_keys = false, if_event_not_match_timeout = null) {
    let d = this.decode_action_reference(actionref, /*default_entry_id = */reference_entry_id)
    return d ? this.entry_do_action(d['entry'], d['action'], params, d['init'], if_event_not_match, if_event_not_match_keys, if_event_not_match_timeout) : null;
  }

  this.entry_do_action_lambda = function(entry) {
    return function(action, params = {}, init = null, if_event_not_match = false, if_event_not_match_keys = false, if_event_not_match_timeout = null) { return entry_do_action(entry, action, params = params, init, if_event_not_match, if_event_not_match_keys, if_event_not_match_timeout); };
  }

  this.entry_do_action = function(entry_or_id, action, params = {}, init = null, if_event_not_match = false, if_event_not_match_keys = false, if_event_not_match_timeout = null) {
    let entry = !isinstance(entry_or_id, 'str') ? entry_or_id : this.entry_get(entry_or_id);
    //console.debug("entry_do_action " + str(entry_or_id) + " | " + str(entry) + " | " + str(action) + " | " + str(params))
    
    if (entry && action in entry.actions) {
      if (if_event_not_match && if_event_not_match == true)
        if_event_not_match = this.transform_action_reference_to_event_reference({'entry': entry.id, 'action': action, 'init': init}, /*return_decoded = */true);
      if (if_event_not_match && isinstance(if_event_not_match, 'str'))
        if_event_not_match = this.decode_event_reference(if_event_not_match);
      if (if_event_not_match) {
        let event = this.entry_event_get(if_event_not_match['entry'], if_event_not_match['event'], if_event_not_match['condition'], /*keys = */null, /*timeout = */if_event_not_match_timeout);
        if (event) {
          match = true;
          for (let k of (if_event_not_match_keys ? if_event_not_match_keys : Object.keys(params)))
            match = match && (k in params && k in event && params[k] == event[k]);
          if (match)
            //console.debug("MATCHED")
            return true;
        }
      }
    
      let publish = null;
      let exec_context = { 'params': params };
      for (let topic of entry.actions[action]) {
        let actiondef = entry.definition['subscribe'][topic]['actions'][action];
        if (isinstance(actiondef, 'str'))
          actiondef = { 'payload': actiondef };
        if (actiondef['payload']) {
          if ('init' in actiondef && actiondef['init'])
            exec_context = scripting_js.script_exec(actiondef['init'], exec_context);
          if (init)
            exec_context = scripting_js.script_exec(init, context, exec_context);
          let payload = scripting_js.script_eval(actiondef['payload'], exec_context, /*to_dict = */true);
          if (payload != null) {
            if ('topic' in actiondef && actiondef['topic']) {
              if (actiondef['topic'].startsWith('js:') || actiondef['topic'].startsWith('jsf:'))
                topic = scripting_js.script_eval(actiondef['topic'], exec_context, /*to_dict = */true);
              else
                topic = actiondef['topic'];
            }
            publish = [topic, payload, 'qos' in actiondef ? actiondef['qos'] : 0, 'retain' in actiondef ? actiondef['retain'] : false];
            break;
          }
        } else {
          publish = [topic, null, 'qos' in actiondef ? actiondef['qos'] : 0, 'retain' in actiondef ? actiondef['retain'] : false];
          break;
        }
      }

      if (publish) {
        entry.publish(publish[0], publish[1], publish[2], publish[3]);
        this.event_get_invalidate_on_action(entry, action, exec_context['params'], if_event_not_match);
        return true;
      }
    }

    return false;
  }

  this.event_get = function(eventref, timeout = null, keys = null, temporary = false) {
    let d = this.decode_event_reference(eventref);
    if (d)
      return this.entry_event_get(d['entry'], d['event'], /*condition = */d['condition'], /*keys = */keys, /*timeout = */timeout, /* temporary = */temporary)
    else
      console.error("#SYSTEM> Invalid event reference {eventref}".format({eventref: eventref}));
    return null;
  }

  this.event_get_time = function(eventref, timeout = null, temporary = false) {
    return this.event_get(eventref, /*timeout = */timeout, /*keys = */['_time'], /*temporary = */temporary);
  }

  this.entry_event_get = function(entry_or_id, eventname, condition = null, keys = null, timeout = null, temporary = false) {
    /*
    WARN: You can do an "entry_event_get" only of listened events (referenced in "on" or "events_listen" entry definitions)

    @param keys List of event params names to get. Use "_time" as param name to get event time
    @param timeout null or a duration
    */
    let entry_id = isinstance(entry_or_id, 'str') ? this.entry_id_find(entry_or_id) : entry_or_id.id;
    
    let match = null;
    if (eventname in this.events_published && entry_id in this.events_published[eventname])
      for (let keys_index in this.events_published[eventname][entry_id]) {
        let t = this.entry_event_keys_index_is_temporary(keys_index);
        if ((t && temporary) || (!t && !temporary)) {
          let e = this.events_published[eventname][entry_id][keys_index];
          if ((timeout == null || this.time() - e['time'] <= read_duration(timeout)) && (condition == null || _entry_event_params_match_condition(e, condition)) && (!match || e['time'] > match['time']))
            match = e;
        }
      }
    if (match) {
      if (!keys)
        return match['params'];
      let res = [];
      for (let k of keys)
        if (k == '_time' || k in match['params']) {
          v = k == '_time' ? match['time'] : match['params'][k];
          if (keys.length == 1)
            return v;
          res.push(v);
        }
      return nan_remove(res);
    }

    return keys == null || len(keys) == 1 ? null : Array(keys.length).fill(null);
  }

  this.entry_event_get_time = function(entry_or_id, eventname, timeout = null, temporary = false) {
    this.entry_event_get(entry_or_id, eventname, ['_time'], timeout, temporary);
  }
  
  this.entry_events_published = function(entry_or_id) {
    /*
    WARN: You can do an "entry_events_published" only of listened events (referenced in "on" or "events_listen" entry definitions)
    */
    let res = {}
    let entry = !isinstance(entry_or_id, 'str') ? entry_or_id : this.entry_get(entry_or_id);
    for (eventname in entry.events) {
      res[eventname] = {}
      if (eventname in this.events_published && entry.id in this.events_published[eventname])
        for (let keys_index in this.events_published[eventname][entry.id])
          res[eventname][keys_index] = this.events_published[eventname][entry.id][keys_index];
    }
    return res;
  }
  
  this.events_import = function(data, import_mode = 0, invoke_mode = 2) {
    /*
     * @param import_mode = -1 only import events not present, or with time = -1, and set the time as -time [used to import stored events]
     * @param import_mode = 0 only import events not present, or with time <= 0
     * @param import_mode = 1 ... also events with time >= than the one in memory
     * @param import_mode = 2 ... also all events with time > 0
     * @param import_mode = 3 import all events (even if time = -1|0)
     * @param invoke_mode = 0 never invoke listeners of imported events
     * @param invoke_mode = 1 invoke listeners of imported events with time >= 0 (recent events)
     * @param invoke_mode = 2 invoke listeners of imported events with time != -1 (recent events & stored events, NOT for :init events)
     * @param invoke_mode = 3 invoke listeners of ALL imported events
     */
    for (let entry_id in data)
      for (let eventname in data[entry_id])
        for (let keys_index in data[entry_id][eventname]) {
          let eventdata = data[entry_id][eventname][keys_index];
          let temporary = ("temporary" in eventdata['params']) && eventdata['params']['temporary'];
          //let keys_index = this.entry_event_keys_index('keys' in eventdata ? eventdata['keys'] : {}, temporary);
          if (!(eventname in this.events_published))
            this.events_published[eventname] = {};
          if (!(entry_id in this.events_published[eventname]))
            this.events_published[eventname][entry_id] = {};
          let prevdata = keys_index in this.events_published[eventname][entry_id] ? this.events_published[eventname][entry_id][keys_index] : null;
          let go = import_mode == 3 || !prevdata || (prevdata['time'] == -1 && eventdata['time'] > 0);
          if (!go && import_mode == 0)
            go = prevdata['time'] <= 0 && eventdata['time'] > 0
          if (!go && import_mode == 1)
            go = eventdata['time'] >= prevdata['time'];
          if (!go && import_mode == 2)
            go = eventdata['time'] > 0;
          if (go) {
            if (import_mode == -1 && eventdata['time'] > 0)
              eventdata['time'] = - eventdata['time'];
            this.events_published[eventname][entry_id][keys_index] = eventdata;
            if (!temporary && invoke_mode > 0 && (invoke_mode == 3 || (invoke_mode == 2 && eventdata['time'] != -1) || (invoke_mode == 1 && eventdata['time'] >= 0))) {
              let _e = this.entry_get(entry_id);
              if (_e)
                this._entry_event_invoke_listeners(_e, eventdata, 'import');
            }
          }
        }
  }
  
  this.events_export = function() {
    let all_events = {};
    for (entry_id in this.all_entries)
      all_events[entry_id] = this.entry_events_published(entry_id);
    return all_events;
  }

  this._re_decode_event_reference = new RegExp('^(?<entry>[A-Za-z0-9@*_-]+)?(?:\\.(?<event>[A-Za-z0-9_-]+))?(?:\\((?<condition>.*)\\))?$');

  this.decode_event_reference = function(s, default_entry_id = null, default_event = null, no_event = false) {
    /*
    Decodes a string reference to an event, like "entry_id.event" || "*.event(port == 1)"
    @params no_event: true if (is possibile to NOT specify an event in the string, ex) { "entry(condition)"
    @return { "entry": "...", "event": "...", "condition": "..." }
    */
    let m = this._re_decode_event_reference.exec(s);
    m = m ? m.groups : null;
    if (m && default_entry_id && !m['entry'])
      m['entry'] = default_entry_id;
    if (m && default_event && !m['event'])
      m['event'] = default_event;
    return m && m['entry'] && (m['event'] || no_event) ? m : null;
  }

  this._re_decode_action_reference = new RegExp('^(?<entry>[A-Za-z0-9@*_-]+)?(?:\\.(?<action>[A-Za-z0-9_-]+))?(?:\\((?<init>.*)\\))?$');

  this.decode_action_reference = function(s, default_entry_id = null, default_action = null, no_action = false) {
    /*
    Decodes a string reference to an action, like "entry_id.action" or "entry_id.action(init_code)"
    @params no_action: true if (is possibile to NOT specify an action in the string, ex) { "entry(init)"
    @return { "entry": "...", "action": "...", "init": "..." }
    */
    let m = this._re_decode_action_reference.exec(s);
    m = m ? m.groups : null;
    if (m && default_entry_id && !m['entry'])
      m['entry'] = default_entry_id;
    if (m && default_action && !m['action'])
      m['action'] = default_action
    return m && (m['action'] || no_action) ? m : null;
  }
  
  this.generate_event_reference = function(entry_id, eventname, eventdata) {
    let condition = '';
    if ('keys' in eventdata && eventdata['keys']) {
      for (k in eventdata['keys'])
        condition = condition + (condition ? ' && ' : '') + 'params["' + k + '"] == ' + json_export(eventdata['keys'][k]);
      condition = '(js: ' + condition + ')';
    }
    return entry_id + '.' + eventname + condition;
  }

  this.transform_action_reference_to_event_reference = function(actionref, return_decoded = false) {
    /*
    Transform an action reference to a valid event reference.
    Delete the "-set" postfix to action name and replace "=" with "==" and ";" with "&&" in init code
    Example: "js: action-set(js: params['x'] = 1; params['y'] = 2;)" > "js: action(js: params['x'] == 1 && params['y'] == 2)"
    */
    let d = !isinstance(actionref, 'dict') ? this.decode_action_reference(actionref, /*default_entry_id = */null, /*default_action = */null, /*no_action = */true) : actionref;
    if (!d)
      return null;
    let r = {'entry': d['entry'], 'event': d['action'] ? transform_action_name_to_event_name(d['action']) : null, 'condition': d['init'] ? d['init'].strip('; ').replace('=', '==').replace(';', '&&') : null };
    return return_decoded ? r : r['entry'] + (r['event'] ? ('.' + r['event']) : '') + (r['condition'] ? ('(' + r['condition'] + ')') : '');
  }

  this.transform_action_name_to_event_name = function(actionname) {
    return actionname.replace('-set', '');
  }

  this.transform_event_reference_to_action_reference = function(eventref, return_decoded = false) {
    /*
    Transform an event reference to a valid action reference.
    Add the "-set" postfix to event name and replace "==" with "=" and "&&" with ";" in condition
    Example: "js: event(js: params['x'] == 1 && params['y'] == 2)" > "js: event-set(js: params['x'] = 1; params['y'] = 2;)"
    */
    let d = !isinstance(eventref, 'dict') ? decode_event_reference(eventref, /*default_entry_id = */null, /*default_event = */null, /*no_event = */true) : eventref;
    if (!d)
      return null
    let r = {'entry': d['entry'], 'action': d['event'] ? (d['event'] + '-set') : null, 'init': d['condition'] ? d['condition'].replace('==', '=').replace('&&', ';') : null };
    return return_decoded ? r : r['entry'] + (r['action'] ? ('.' + r['action']) : '') + (r['init'] ? ('(' + r['init'] + ')') : '');
  }
};
