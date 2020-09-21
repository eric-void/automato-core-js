// TODO: For the future, i can consider using https://github.com/jterrace/js.js/

function AutomatoScriptingJs(system, caller_context) {
  var context_mask = {};
  for (p in caller_context)
    context_mask[p] = undefined;
  
  this.script_eval_cache = {};
  this.script_eval_cache_hits = 0;
  this.script_eval_cache_miss = 0;
  this.script_eval_cache_disabled = 0;
  this.script_eval_cache_skipped = 0;
  this.SCRIPT_EVAL_CACHE_MAXSIZE = 1024;
  this.SCRIPT_EVAL_CACHE_PURGETIME = 3600;

  this.exports = {};

  this.script_context = function(context = {}) {
    let res = Object.assign({}, context_mask, {
      'now': Math.floor((new Date()).getTime() / 1000),
      'd': read_duration,
      't': parse_datetime,
      'strftime': strftime,
      'print': console.log,
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

  this.script_eval = function(code, context = {}, cache = false) {
    if (code.startsWith('js:'))
      code = code.slice(3).trim();
    
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
      
      key = "CONTEXT: " + JSON.stringify(Object.fromEntries(Object.entries(context).sort(function(a, b) { return a[0] > b[0] ? 1 : (a[0] == b[0] ? 0 : -1); }))) + ",CODE:"+code;
      keyhash = MD5(key);
      if (keyhash in this.script_eval_cache && this.script_eval_cache[keyhash]['key'] == key) {
        this.script_eval_cache[keyhash]['used'] = system.time();
        this.script_eval_cache_hits += 1;
        return this.script_eval_cache[keyhash]['result'];
      }
      this.script_eval_cache_miss += 1;
    } else
      this.script_eval_cache_disabled += 1;
    
    try {
      let this_context = this.script_context(context);
      let ret = eval("with (this_context) { " + code + "}");
      this.script_context_return(this_context, context);
      
      if (cache)
        this.script_eval_cache[keyhash] = { 'key': key, 'used': system.time(), 'result': ret };
      
      return ret;
    } catch (exception) {
      console.error('scripting_js> error evaluating js script: {code}\ncontext: {context}\n'.format({code: code, context: context}), exception);
      return null;
    }
  }
  
  this.script_exec = function(code, context = {}) {
    if (code.startsWith('js:'))
      code = code.slice(3).trim();
    try {
      this_context = this.script_context(context);
      (new Function( "with(this) { " + code + "}")).call(this_context);
      this.script_context_return(this_context, context);
    } catch (exception) {
      console.error('scripting_js> error executing js script: {code}\ncontext: {context}\n'.format({code: code, context: context}), exception);
    }
  }

}


var scripting_js = new AutomatoScriptingJs(this);
