# Alignment with the Python core

[Back to the project](../README.md)

The Python core ([automato-core-py](https://github.com/eric-void/automato-core-py)) and this one must behave the same way: a node and a browser read the same definitions and the same messages, and must find the same events and publish the same commands.

## Rules

- **Same calls**: every function of `system.py` and `mqtt.py` exists in `system.js` and `mqtt.js` (as a method of `AutomatoSystem` / `AutomatoMqtt`), with the same name and the same parameters in the same order. Code ported from one core reads the same in the other.
- **Same wire behavior**: topic matching, payload decoding, event params, action topics and payloads, exported definitions.
- **A fix in one core is checked in the other**: the same bug is often in both.
- Differences are allowed only when the platform requires them, and they are listed (below).

## How it is checked

`node test/run.js` includes a test that reads the Python sources of the sibling checkout and compares, for `system` and `mqtt`, the list of functions and their parameter names. The lists of accepted differences are at the end of [test/run.js](../test/run.js):

| List | Content |
|---|---|
| `JS_ONLY` | Functions present only in JavaScript: the classes created as functions (`Entry`, `Message`...), `set_config` of the MQTT layer, helpers for the browser event loop that replace Python threads |
| `PY_ONLY` | Functions present only in Python: thread-local state, a parse cache for slow nodes, logging |
| `DIFFERENT_PARAMS` | Same function, different parameter names: `default` is a reserved word in JavaScript, callbacks of the MQTT libraries |

`node test/parity/run.js` runs [test/parity/scenario.json](../test/parity/scenario.json) on both cores: it loads the same definitions, sends the same messages, makes the same calls (by position) and compares the results (events, published messages, notifications). The Python side runs in the `automato-node:local` docker image, built from [automato-node-py](https://github.com/eric-void/automato-node-py) (`docker build -f automato-node-py/Dockerfile -t automato-node:local .` from the directory that contains the checkouts). When changing a behavior, add a step to the scenario.

Both tests expect the repositories checked out side by side:

```
automato-core-js/
automato-core-py/
automato-node-py/   (for the docker image)
```

## Known differences

| Topic | Python | JavaScript |
|---|---|---|
| Expressions in definitions | Js2Py, ES5 only | Native `eval`, any syntax the browser supports. Write ES5 so both work |
| Concurrency | Threads, with locks | Single event loop; timers instead of threads |
| Logging and locale | Python `logging`, gettext | Browser console; no translation |
| `print` in expressions | stdout | `console.log` |
| `str` in expressions | Available | Not defined |
| Compression | `zlib` | `pako` (must be loaded by the page) |

## Porting notes

[py_conversion.txt](py_conversion.txt) contains the substitutions used when the core was first ported from Python (in Italian, historical): `True`/`False`/`None`, `dict.items()` loops, `in` on lists, regular expression named groups, threads. They are still a useful checklist when porting a change.
