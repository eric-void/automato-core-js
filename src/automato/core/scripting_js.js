// TODO: For the future, i can consider using https://github.com/jterrace/js.js/

// NOTE script_eval_cache has been disabled to mirror python behaviour: see notes about it (it was not working properly with some values - probably float ones - the same event was emitted with different payloads)

function AutomatoScriptingJs(system, caller_context) {
  var context_mask = {};
  for (p in caller_context)
    context_mask[p] = undefined;
  
  /* NOTE script_eval_cache DISABLED: not working properly
  this.script_eval_cache = {};
  this.script_eval_cache_hits = 0;
  this.script_eval_cache_miss = 0;
  this.script_eval_cache_disabled = 0;
  this.script_eval_cache_skipped = 0;
  this.script_eval_codecontext_signatures = {};
  this.SCRIPT_EVAL_CACHE_MAXSIZE = 1024;
  this.SCRIPT_EVAL_CACHE_PURGETIME = 3600;
  */

  this.exports = {};

  this.script_context = function(context = {}) {
    let res = Object.assign({}, context_mask, {
      'now': Math.floor((new Date()).getTime() / 1000),
      'd': read_duration,
      't': parse_datetime,
      'uniqid': this.uniqid,
      'strftime': strftime,
      'array_sum': array_sum,
      'array_avg': array_avg,
      'array_min': array_min,
      'array_max': array_max,
      'round': round,
      'is_array': is_array,
      'is_dict': is_dict,
      'print': console.log,
      'camel_to_snake_case': camel_to_snake_case,
      'payload_transfer': payload_transfer,
      '_': _,
    }, this.exports, context);
    return res;
  }

  this.script_context_return = function(script_context, original_context) {
    for (k in script_context) {
      if (typeof script_context[k] != 'undefined' && !['now', 'd', 't', 'print'].includes(k) && !(k in this.exports) && (!(k in original_context) || original_context[k] != script_context[k]))
        original_context[k] = script_context[k];
    }
    for (k in original_context)
      if (!(k in script_context) || typeof script_context[k] == 'undefined')
        delete original_context[k];
  }

  /**
   * @param cache Code excecution can be cached (this parameter is NOT used right now)
   */
  this.script_eval = function(code, context = {}, cache = false) {
    let _s = system._stats_start();
    try {
      if (code.startsWith('js:'))
        code = code.slice(3).trim();
      else if (code.startsWith('jsf:'))
        code = '(function() {' + code.slice(4).trim() + '})();';
      
      /* NOTE script_eval_cache DISABLED
      let key = null, keyhash = null;
      if (cache) {
        if (len(this.script_eval_cache) > this.SCRIPT_EVAL_CACHE_MAXSIZE) {
          let t = this.SCRIPT_EVAL_CACHE_PURGETIME;
          while (len(this.script_eval_cache) > this.SCRIPT_EVAL_CACHE_MAXSIZE) {
            for (x in this.script_eval_cache)
              if (this.script_eval_cache[x]['used'] <= system.time() - t)
                delete this.script_eval_cache[x];
            t = t > 1 ? t / 2 : -1;
          }
        }
        
        let context_sorted = sorted_dict(context);
        
        // CONTEXT: part contains the first and second-level keys of context object, in the form { key: '', key: { dictkey: ''}}
        let contextkey = {};
        for (let x in context_sorted)
          if (!isinstance(context[x], 'dict'))
            contextkey[v] = ''
          else {
            contextkey[x] = {};
            for (let y in context[x])
              contextkey[x][y] = '';
          }
        let codecontext_signature = "CODE:" + code + ",CONTEXT:" + json_export(contextkey);

        if (!(codecontext_signature in this.script_eval_codecontext_signatures)) {
          // This struct contains the usage of context keys (first and second level) in the code. If a key is present, with value '', that key is used in the code as is. If not present, it's not used. If it's a dict, it reflects the usage of subkeys.
          this.script_eval_codecontext_signatures[codecontext_signature] = {};
          for (let x in context_sorted)
            if (new RegExp('\\b' + x + '\\b').exec(code))
              if (!isinstance(context[x], 'dict') || this._script_code_uses_full_var(code, x))
                this.script_eval_codecontext_signatures[codecontext_signature][v] = '';
              else {
                this.script_eval_codecontext_signatures[codecontext_signature][x] = {};
                for (let y in context[x])
                  if (new RegExp('\\b' + y + '\\b').exec(code))
                    this.script_eval_codecontext_signatures[codecontext_signature][x][y] = ''
              }
        }
        
        //OBSOLETE: let key = "CONTEXT: " + json_export(Object.fromEntries(Object.entries(context).sort(function(a, b) { return a[0] > b[0] ? 1 : (a[0] == b[0] ? 0 : -1); }))) + ",CODE:" + code;
        let key = {}
        for (let x in context_sorted)
          if (x in this.script_eval_codecontext_signatures[codecontext_signature]) {
            if (this.script_eval_codecontext_signatures[codecontext_signature][x] == '')
              key[x] = context[x];
            else {
              key[x] = {};
              for (let y in context[x])
                if (y in this.script_eval_codecontext_signatures[codecontext_signature][x])
                  key[x][y] = context[x][y];
            }
          }
        key = "CONTEXT:" + json_export(key) + ",CODE:" + code;
        
        let keyhash = md5_hexdigest(key);
        if (keyhash in this.script_eval_cache && this.script_eval_cache[keyhash]['key'] == key) {
          this.script_eval_cache[keyhash]['used'] = system.time();
          this.script_eval_cache_hits += 1;
          return this.script_eval_cache[keyhash]['result'];
        }
        this.script_eval_cache_miss += 1;
      } else
        this.script_eval_cache_disabled += 1;
      */
      
      let _s2 = false;
      try {
        let this_context = this.script_context(context);
        _s2 = system._stats_start();
        let ret = eval("with (this_context) { " + code + "}");
        this.script_context_return(this_context, context);
        
        /* NOTE script_eval_cache DISABLED
        if (cache)
          this.script_eval_cache[keyhash] = { 'key': key, 'used': system.time(), 'result': ret };
        */
        
        return ret;
      } catch (exception) {
        console.error('scripting_js> error evaluating js script: {code}\ncontext: {context}\n'.format({code: code, context: context}), exception);
        return null;
      } finally {
        if (_s2)
          system._stats_end('scripting_js.script_eval(eval)', _s2);
      }

    } finally {
      system._stats_end('scripting_js.script_eval', _s);
    }
  }
  
  /* NOTE script_eval_cache DISABLED
  this._script_code_uses_full_var = function(code, v) {
    // Return if code uses the var, without dict key reference ("payload[x]" or "x in payload" uses key reference, "payload" not)
    //return re.search(r'\b' + var + r'(\.|\[)', code)
    let parts = code.split(new RegExp('\\b' + v + '\\b'));
    for (let i = 0; i < parts.length - 1; i ++)
      if (!parts[i].match(/\b(typeof|in)\s/) && !parts[i+1].match(/^(\.|\[)/))
        return true;
    return false;
  }
  */
  
  this.script_exec = function(code, context = {}, return_context = true) {
    let ret = null;
    let _s = system._stats_start();
    if (code.startsWith('js:'))
      code = code.slice(3).trim();
    try {
      this_context = this.script_context(context);
      (new Function( "with(this) { " + code + "}")).call(this_context);
      this.script_context_return(this_context, context);
      if (return_context) {
        ret = {};
        for (let k in (isinstance(return_context, 'list') ? return_context : context))
          ret[k] = context[k];
      }
      
    } catch (exception) {
      console.error('scripting_js> error executing js script: {code}\ncontext: {context}\n'.format({code: code, context: context}), exception);
    }
    system._stats_end('scripting_js.script_exec', _s);
    return ret;
  }
  
  var uniqid_seed = Math.random().toString(16).substr(2, 8);
  var uniqid_c = 0;
  
  this._uniqid = function() {
    return system.default_node_name + ':' + uniqid_seed + ':' + (++c);
  }
}

var scripting_js = new AutomatoScriptingJs(this);
