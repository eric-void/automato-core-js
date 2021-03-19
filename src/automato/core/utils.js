/**
 * UTILS
 */

/*
function dict_merge(dct, merge_dct) {
  for (k in merge_dct)
    if (k in dct && isinstance(dct[k], 'dict')  && isinstance(merge_dct[k], 'dict'))
      dct[k] = dict_merge(dct[k], merge_dct[k]);
    else
      dct[k] = merge_dct[k];
  return dct;
}
*/

/**
 * @param join_lists_depth (int): if != 0 two lists are joined together, and in recursive call this parameter is decremented by 1. If 0 merge_dct list will override dct one.
 *        Use 0 to disable list joining, -1 to enable list joining for all levels, 2 to join only lists in first level (note that "1" is dct/merge_dct itself)
 */
function dict_merge(dct, merge_dct, join_lists_depth = 0) {
  if (isinstance(dct, 'dict') && isinstance(merge_dct, 'dict')) {
    for (let k in merge_dct)
      dct[k] = dict_merge(k in dct ? dct[k] : null, merge_dct[k], join_lists_depth ? join_lists_depth - 1 : 0);
    return dct;
  }
  if (isinstance(dct, 'list') && isinstance(merge_dct, 'list'))
    return dct.concat(merge_dct);
  return merge_dct;
}

/**
 * Read duration strings, like '10m' or '1h' and returns the number of seconds (600 or 3600, for previous examples)
 */
function read_duration(v) {
  if (typeof v != 'string' || v.length < 2 || (v.slice(-1) >= "0" && v.slice(-1) <= "9")) {
    v = parseInt(v);
    return !Number.isNaN(v) ? v : -1;
  }
  u = v.slice(-1).toUpperCase();
  v = v.slice(0, -1);
  if (v === "")
    return -1;
  v = parseInt(v);
  if (Number.isNaN(v))
    return -1;
  if (u == 'S')
    return v;
  if (u == 'M')
    return v * 60;
  if (u == 'H' || u == 'O')
    return v * 3600;
  if (u == 'D' || u == 'G')
    return v * 86400;
  if (u == 'W')
    return v * 7 * 86400;
  return v;
}

/**
 * Convert a passed datetime in various format (timestamp, ISO8601, ...) to timestamp (in seconds):
 * '1396879090' > 1396879090
 * 1396879090123 > 1396879090
 * "2014-04-07T13:58:10.104Z" > 1396879090
 * "2014-04-07T15:58:10.104" > 1396879090
 */
function parse_datetime(v, milliseconds_float = false) {
  if (!v)
    return 0;
  let ret = parseFloat(v);
  if (!ret || Number.isNaN(ret) || ret < 1000000000)
    ret = new Date(v).getTime();
  if (Number.isNaN(ret))
    return 0;
  if (ret > 9999999999)
    ret = ret / 1000;
  return !milliseconds_float ? Math.floor(ret) : ret;
}

function sorted_dict(data) {
  return Object.fromEntries(Object.entries(data).sort(function(a, b) { return a[0] > b[0] ? 1 : (a[0] == b[0] ? 0 : -1); }));
}

/**
 * JSON-compliant json stringify
 * No exception is thrown: if v is invalid, an error will be logged and None is returned
 */
function json_export(v) {
  try {
    return JSON.stringify(v);
  } catch (e) {
    console.error(e);
    return null;
  }
}

/*
 * JSON-compliant json parse: no "NaN" (or other constant) is accepted (if NaN is in input, we'll try to convert it to None/null)
 * No exception is thrown: if v is invalid, an error will be logged and None is returned
 */
function json_import(v) {
  try {
    return JSON.parse(v);
  } catch (e) {
    if (v.match(/\bNaN\b/))
      try {
        return JSON.parse(v.replace(/\bNaN\b/g, 'null'));
      } catch (e) {
        console.error(e);
      }
    else {
      console.error(e);
    }
  }
  return null;
}

function nan_remove(v) {
  if (isinstance(v, 'list') || isinstance(v, 'dict')) {
    for (let k in v)
      v[k] = nan_remove(v[k]);
  }
  else if (isNaN(v))
    v = null;
  return v
}

function json_sorted_encode(data, recursive = false) {
  return JSON.stringify(sort_map(data, recursive));
}

function sort_map(data, recursive = false) {
  if (!is_dict(data))
    return data;
  let sorted = {};
  Object.keys(data).sort().forEach(function(k) { sorted[k] = recursive ? sort_map(data[k]) : data[k]; });
  return sorted;
}

function b64_compress_data(data) {
  /*
   * Compress and base-64 encode data
   * NEEDS: pako (deflate) zlib library
   */
  return btoa(pako.deflate(json_export(data), {'to': 'string'}));
}

function b64_decompress_data(string) {
  /*
   * Compress and base-64 encode data
   * NEEDS: pako (inflate) zlib library
   */
  return json_import(pako.inflate(atob(string), {to: 'string'}));
}

function round(v, decimals = 0) {
  if (decimals < 0)
    return v;
  return Math.round(v * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function array_avg(a, decimals = -1) {
  let s = 0;
  let c = 0;
  for (i in a)
    if (i !== null) {
      s = s + i;
      c ++;
    }
  return c > 0 ? round(s / c, decimals) : null;
}

function array_sum(a) {
  let s = 0;
  let c = 0;
  for (i in a)
    if (i !== null) {
      s = s + i;
      c ++;
    }
  return c > 0 ? round(s, decimals) : null;
}

function array_min(a) {
  let s = null;
  for (i in a)
    if (i !== null && (s === null || i < s))
      s = i;
  return s;
}

function array_max(a) {
  let s = null;
  for (i in a)
    if (i !== null && (s === null || i > s))
      s = i;
  return s;
}

function is_array(v) {
  return v !== null && typeof v == "object" && Array.isArray(v);
}

function is_dict(v) {
  return v !== null && typeof v == "object" && v.constructor == Object && !(v instanceof Array);
}

/***************************************************************************************************************************************************************
  *
  * JS SPECIFIC
  *
  ***************************************************************************************************************************************************************/

if (!String.prototype.format)
  String.prototype.format = function() {
    var args;
    args = arguments;
    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object') {
      args = args[0];
    }
    return this.replace(/{([^}]*)}/g, (match, key) => typeof args[key] !== "undefined" ? str(args[key]) : match );
  };

if (!String.prototype.leftJustify)
  String.prototype.leftJustify = function( length, char ) {
    var fill = [];
    while ( fill.length + this.length < length )
      fill[fill.length] = char;
    return fill.join('') + this;
  };

if (!String.prototype.rightJustify)
  String.prototype.rightJustify = function( length, char ) {
    var fill = [];
    while ( fill.length + this.length < length )
      fill[fill.length] = char;
    return this + fill.join('');
  };

function str(v) {
  return '' + 
    (typeof v == 'object' && v !== null && v.constructor == Object ? "{" + Object.entries(v).map(function(v) { return v[0] + ': ' + str(v[1])}).join(", ") + "}" :
    (typeof v == 'object' && Array.isArray(v) ? "[" + v + "]" : 
    v));
}

function array_remove(arr) {
  let what, a = arguments, L = a.length, ax;
  while (L > 1 && arr.length) {
      what = a[--L];
      while ((ax= arr.indexOf(what)) !== -1) {
          arr.splice(ax, 1);
      }
  }
  return arr;
}

function callable(h) {
  return typeof h == 'function' || (typeof h == 'string' && h in window && typeof window[h] == 'function');
}

/**
 * For other methods see https://medium.com/javascript-in-plain-english/how-to-deep-copy-objects-and-arrays-in-javascript-7c911359b089
 */
function deepcopy(v, max_depth = 2) {
  if (typeof v !== "object" || v === null || max_depth == 0)
    return v;

  // Create an array or object to hold the values
  let res = Array.isArray(v) ? [] : {}

  for (k in v)
    res[k] = deepcopy(v[k], max_depth - 1);

  return res;
}

function isinstance(v, t) {
  if (v === null)
    return false;
  if (Array.isArray(t)) {
    for (_t of t)
      if (isinstance(v, _t))
        return true;
    return false;
  }
  switch (t) {
    case 'int':
      return typeof v == "number" && v % 1 == 0;
    case 'str': case 'string':
      return typeof v == "string";
    case 'bool':
      return typeof v == "boolean";
    case 'float':
      return typeof v == "number";
    case 'dict':
      return typeof v == "object" && v.constructor == Object;
    case 'list': case 'array':
      return typeof v == "object" && Array.isArray(v);
  }
  return false;
}

function len(v) {
  if (typeof v == "object" && Array.isArray(v))
    return v.length;
  if (typeof v == "object" && v.constructor == Object)
    return Object.keys(v).length;
  return 0;
}

/*
 * Simulated threads (js has no real multi-threading
 * @param handler deve essere una funzione definita con "async function handler() { while (thread_check(this)) { [...] await thread_sleep(1); } } "
 * @param bind se true, l'handler può fare riferimento a "this.destroyed", se false non viene ridefinito "this" ma l'handler deve comunque avere il riferimento a thread_object.destroyed
 * @return thread_object
 */
function thread_start(handler, bind = true, context = null) {
  let thread_object = { handler: handler, check_count: 0, destroyed: false, context: context };
  if (bind)
    handler.bind(thread_object)();
  else
    setTimeout(handler, 1);
  return thread_object;
}

/**
 * Deve essere chiamato con "await thread_sleep(123);"
 * WARN: In chrome, when a tab is in background, each setTimeout is slowed down (approx 1 seconds). So thread_sleep could be slower.
 */
function thread_sleep(seconds) {
  return new Promise(resolve => { setTimeout(() => { resolve(); }, seconds * 1000); });
}

function thread_check(thread_object) {
  thread_object['check_count'] ++;
  return !thread_object.destroyed
}

/**
 * Il thread si fermerà al primo controllo di "this.destroyed" (che DEVE essere implementato nell'handler)
 */
function thread_end(thread_object) {
  thread_object['destroyed'] = true;
}

/* Port of strftime() by T. H. Doan (https://thdoan.github.io/strftime/)
 *
 * Day of year (%j) code based on Joe Orost's answer:
 * http://stackoverflow.com/questions/8619879/javascript-calculate-the-day-of-the-year-1-366
 *
 * Week number (%V) code based on Taco van den Broek's prototype:
 * http://techblog.procurios.nl/k/news/view/33796/14863/calculate-iso-8601-week-and-year-in-javascript.html
 */
function strftime(sFormat, date = null) {
  if (!date)
    date = new Date();
  if (typeof date == "string") {
    let v = parseInt(date);
    if (("" + v) == date)
      date = v;
  }
  if (typeof date == "number" && date >= 1000000000) {
    if (date >= 1000000000 && date < 1000000000000)
      date = date * 1000;
    date = new Date(date);
  }
  if (!(date instanceof Date))
    return "-";
  // -----

  var nDay = date.getDay(),
    nDate = date.getDate(),
    nMonth = date.getMonth(),
    nYear = date.getFullYear(),
    nHour = date.getHours(),
    aDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    aMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    aDayCount = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334],
    isLeapYear = function() {
      return (nYear%4===0 && nYear%100!==0) || nYear%400===0;
    },
    getThursday = function() {
      var target = new Date(date);
      target.setDate(nDate - ((nDay+6)%7) + 3);
      return target;
    },
    zeroPad = function(nNum, nPad) {
      return ((Math.pow(10, nPad) + nNum) + '').slice(1);
    };
  return sFormat.replace(/%[a-z]/gi, function(sMatch) {
    return (({
      '%a': aDays[nDay].slice(0,3),
      '%A': aDays[nDay],
      '%b': aMonths[nMonth].slice(0,3),
      '%B': aMonths[nMonth],
      '%c': date.toUTCString(),
      '%C': Math.floor(nYear/100),
      '%d': zeroPad(nDate, 2),
      '%e': nDate,
      '%F': date.toISOString().slice(0,10),
      '%G': getThursday().getFullYear(),
      '%g': (getThursday().getFullYear() + '').slice(2),
      '%H': zeroPad(nHour, 2),
      '%I': zeroPad((nHour+11)%12 + 1, 2),
      '%j': zeroPad(aDayCount[nMonth] + nDate + ((nMonth>1 && isLeapYear()) ? 1 : 0), 3),
      '%k': nHour,
      '%l': (nHour+11)%12 + 1,
      '%m': zeroPad(nMonth + 1, 2),
      '%n': nMonth + 1,
      '%M': zeroPad(date.getMinutes(), 2),
      '%p': (nHour<12) ? 'AM' : 'PM',
      '%P': (nHour<12) ? 'am' : 'pm',
      '%s': Math.round(date.getTime()/1000),
      '%S': zeroPad(date.getSeconds(), 2),
      '%u': nDay || 7,
      '%V': (function() {
              var target = getThursday(),
                n1stThu = target.valueOf();
              target.setMonth(0, 1);
              var nJan1 = target.getDay();
              if (nJan1!==4) target.setMonth(0, 1 + ((4-nJan1)+7)%7);
              return zeroPad(1 + Math.ceil((n1stThu-target)/604800000), 2);
            })(),
      '%w': nDay,
      '%x': date.toLocaleDateString(),
      '%X': date.toLocaleTimeString(),
      '%y': (nYear + '').slice(2),
      '%Y': nYear,
      '%z': date.toTimeString().replace(/.+GMT([+-]\d+).+/, '$1'),
      '%Z': date.toTimeString().replace(/.+\((.+?)\)$/, '$1')
    }[sMatch] || '') + '') || sMatch;
  });
}

// TODO translate function
function _(v) {
  return v;
}

/**
 *  @see MD5 (Message-Digest Algorithm) - http://www.webtoolkit.info/
 **/
function md5_hexdigest(string) {
 
  function RotateLeft(lValue, iShiftBits) {
    return (lValue<<iShiftBits) | (lValue>>>(32-iShiftBits));
  }
 
  function AddUnsigned(lX,lY) {
    var lX4,lY4,lX8,lY8,lResult;
    lX8 = (lX & 0x80000000);
    lY8 = (lY & 0x80000000);
    lX4 = (lX & 0x40000000);
    lY4 = (lY & 0x40000000);
    lResult = (lX & 0x3FFFFFFF)+(lY & 0x3FFFFFFF);
    if (lX4 & lY4) {
      return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
    }
    if (lX4 | lY4) {
      if (lResult & 0x40000000) {
        return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
      } else {
        return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
      }
    } else {
      return (lResult ^ lX8 ^ lY8);
    }
   }
 
   function F(x,y,z) { return (x & y) | ((~x) & z); }
   function G(x,y,z) { return (x & z) | (y & (~z)); }
   function H(x,y,z) { return (x ^ y ^ z); }
  function I(x,y,z) { return (y ^ (x | (~z))); }
 
  function FF(a,b,c,d,x,s,ac) {
    a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac));
    return AddUnsigned(RotateLeft(a, s), b);
  };
 
  function GG(a,b,c,d,x,s,ac) {
    a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac));
    return AddUnsigned(RotateLeft(a, s), b);
  };
 
  function HH(a,b,c,d,x,s,ac) {
    a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac));
    return AddUnsigned(RotateLeft(a, s), b);
  };
 
  function II(a,b,c,d,x,s,ac) {
    a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac));
    return AddUnsigned(RotateLeft(a, s), b);
  };
 
  function ConvertToWordArray(string) {
    var lWordCount;
    var lMessageLength = string.length;
    var lNumberOfWords_temp1=lMessageLength + 8;
    var lNumberOfWords_temp2=(lNumberOfWords_temp1-(lNumberOfWords_temp1 % 64))/64;
    var lNumberOfWords = (lNumberOfWords_temp2+1)*16;
    var lWordArray=Array(lNumberOfWords-1);
    var lBytePosition = 0;
    var lByteCount = 0;
    while ( lByteCount < lMessageLength ) {
      lWordCount = (lByteCount-(lByteCount % 4))/4;
      lBytePosition = (lByteCount % 4)*8;
      lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount)<<lBytePosition));
      lByteCount++;
    }
    lWordCount = (lByteCount-(lByteCount % 4))/4;
    lBytePosition = (lByteCount % 4)*8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80<<lBytePosition);
    lWordArray[lNumberOfWords-2] = lMessageLength<<3;
    lWordArray[lNumberOfWords-1] = lMessageLength>>>29;
    return lWordArray;
  };
 
  function WordToHex(lValue) {
    var WordToHexValue="",WordToHexValue_temp="",lByte,lCount;
    for (lCount = 0;lCount<=3;lCount++) {
      lByte = (lValue>>>(lCount*8)) & 255;
      WordToHexValue_temp = "0" + lByte.toString(16);
      WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length-2,2);
    }
    return WordToHexValue;
  };
 
  function Utf8Encode(string) {
    string = string.replace(/\r\n/g,"\n");
    var utftext = "";
 
    for (var n = 0; n < string.length; n++) {
 
      var c = string.charCodeAt(n);
 
      if (c < 128) {
        utftext += String.fromCharCode(c);
      }
      else if((c > 127) && (c < 2048)) {
        utftext += String.fromCharCode((c >> 6) | 192);
        utftext += String.fromCharCode((c & 63) | 128);
      }
      else {
        utftext += String.fromCharCode((c >> 12) | 224);
        utftext += String.fromCharCode(((c >> 6) & 63) | 128);
        utftext += String.fromCharCode((c & 63) | 128);
      }
 
    }
 
    return utftext;
  };
 
  var x=Array();
  var k,AA,BB,CC,DD,a,b,c,d;
  var S11=7, S12=12, S13=17, S14=22;
  var S21=5, S22=9 , S23=14, S24=20;
  var S31=4, S32=11, S33=16, S34=23;
  var S41=6, S42=10, S43=15, S44=21;
 
  string = Utf8Encode(string);
 
  x = ConvertToWordArray(string);
 
  a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476;
 
  for (k=0;k<x.length;k+=16) {
    AA=a; BB=b; CC=c; DD=d;
    a=FF(a,b,c,d,x[k+0], S11,0xD76AA478);
    d=FF(d,a,b,c,x[k+1], S12,0xE8C7B756);
    c=FF(c,d,a,b,x[k+2], S13,0x242070DB);
    b=FF(b,c,d,a,x[k+3], S14,0xC1BDCEEE);
    a=FF(a,b,c,d,x[k+4], S11,0xF57C0FAF);
    d=FF(d,a,b,c,x[k+5], S12,0x4787C62A);
    c=FF(c,d,a,b,x[k+6], S13,0xA8304613);
    b=FF(b,c,d,a,x[k+7], S14,0xFD469501);
    a=FF(a,b,c,d,x[k+8], S11,0x698098D8);
    d=FF(d,a,b,c,x[k+9], S12,0x8B44F7AF);
    c=FF(c,d,a,b,x[k+10],S13,0xFFFF5BB1);
    b=FF(b,c,d,a,x[k+11],S14,0x895CD7BE);
    a=FF(a,b,c,d,x[k+12],S11,0x6B901122);
    d=FF(d,a,b,c,x[k+13],S12,0xFD987193);
    c=FF(c,d,a,b,x[k+14],S13,0xA679438E);
    b=FF(b,c,d,a,x[k+15],S14,0x49B40821);
    a=GG(a,b,c,d,x[k+1], S21,0xF61E2562);
    d=GG(d,a,b,c,x[k+6], S22,0xC040B340);
    c=GG(c,d,a,b,x[k+11],S23,0x265E5A51);
    b=GG(b,c,d,a,x[k+0], S24,0xE9B6C7AA);
    a=GG(a,b,c,d,x[k+5], S21,0xD62F105D);
    d=GG(d,a,b,c,x[k+10],S22,0x2441453);
    c=GG(c,d,a,b,x[k+15],S23,0xD8A1E681);
    b=GG(b,c,d,a,x[k+4], S24,0xE7D3FBC8);
    a=GG(a,b,c,d,x[k+9], S21,0x21E1CDE6);
    d=GG(d,a,b,c,x[k+14],S22,0xC33707D6);
    c=GG(c,d,a,b,x[k+3], S23,0xF4D50D87);
    b=GG(b,c,d,a,x[k+8], S24,0x455A14ED);
    a=GG(a,b,c,d,x[k+13],S21,0xA9E3E905);
    d=GG(d,a,b,c,x[k+2], S22,0xFCEFA3F8);
    c=GG(c,d,a,b,x[k+7], S23,0x676F02D9);
    b=GG(b,c,d,a,x[k+12],S24,0x8D2A4C8A);
    a=HH(a,b,c,d,x[k+5], S31,0xFFFA3942);
    d=HH(d,a,b,c,x[k+8], S32,0x8771F681);
    c=HH(c,d,a,b,x[k+11],S33,0x6D9D6122);
    b=HH(b,c,d,a,x[k+14],S34,0xFDE5380C);
    a=HH(a,b,c,d,x[k+1], S31,0xA4BEEA44);
    d=HH(d,a,b,c,x[k+4], S32,0x4BDECFA9);
    c=HH(c,d,a,b,x[k+7], S33,0xF6BB4B60);
    b=HH(b,c,d,a,x[k+10],S34,0xBEBFBC70);
    a=HH(a,b,c,d,x[k+13],S31,0x289B7EC6);
    d=HH(d,a,b,c,x[k+0], S32,0xEAA127FA);
    c=HH(c,d,a,b,x[k+3], S33,0xD4EF3085);
    b=HH(b,c,d,a,x[k+6], S34,0x4881D05);
    a=HH(a,b,c,d,x[k+9], S31,0xD9D4D039);
    d=HH(d,a,b,c,x[k+12],S32,0xE6DB99E5);
    c=HH(c,d,a,b,x[k+15],S33,0x1FA27CF8);
    b=HH(b,c,d,a,x[k+2], S34,0xC4AC5665);
    a=II(a,b,c,d,x[k+0], S41,0xF4292244);
    d=II(d,a,b,c,x[k+7], S42,0x432AFF97);
    c=II(c,d,a,b,x[k+14],S43,0xAB9423A7);
    b=II(b,c,d,a,x[k+5], S44,0xFC93A039);
    a=II(a,b,c,d,x[k+12],S41,0x655B59C3);
    d=II(d,a,b,c,x[k+3], S42,0x8F0CCC92);
    c=II(c,d,a,b,x[k+10],S43,0xFFEFF47D);
    b=II(b,c,d,a,x[k+1], S44,0x85845DD1);
    a=II(a,b,c,d,x[k+8], S41,0x6FA87E4F);
    d=II(d,a,b,c,x[k+15],S42,0xFE2CE6E0);
    c=II(c,d,a,b,x[k+6], S43,0xA3014314);
    b=II(b,c,d,a,x[k+13],S44,0x4E0811A1);
    a=II(a,b,c,d,x[k+4], S41,0xF7537E82);
    d=II(d,a,b,c,x[k+11],S42,0xBD3AF235);
    c=II(c,d,a,b,x[k+2], S43,0x2AD7D2BB);
    b=II(b,c,d,a,x[k+9], S44,0xEB86D391);
    a=AddUnsigned(a,AA);
    b=AddUnsigned(b,BB);
    c=AddUnsigned(c,CC);
    d=AddUnsigned(d,DD);
  }
 
  var temp = WordToHex(a)+WordToHex(b)+WordToHex(c)+WordToHex(d);
 
  return temp.toLowerCase();
}

function data_signature(data) {
  return md5_hexdigest(json_sorted_encode(data, true));
}
