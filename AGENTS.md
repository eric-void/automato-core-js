# automato-core-js

JavaScript counterpart of the shared Automato core. Read `../AGENTS.md` and `../ARCHITECTURE.md` for system context.

## Layout

- `src/automato/core/system.js`: `AutomatoSystem`, entry metadata/lifecycle, topic/event/action semantics.
- `mqtt.js`, `scripting_js.js`, `notifications.js`, `utils.js`: browser/runtime support modules.
- `test/run.js` (with `test/harness.js`): unit tests, run with `node test/run.js` (no dependencies and no broker: an in-memory mqtt client replaces mqtt.js). They also check that functions and parameters are the same of the Python core.
- `test/parity/run.js`: runs `test/parity/scenario.json` on both cores with the same positional calls and compares the results. Python runs in the `automato-node:local` docker image, using the sources of the sibling checkout.
- `test/index.html`: old browser harness, based on APIs that no longer exist.
- `docs/py_conversion.txt`: historical implementation/conversion notes.

## Guidance

Keep shared APIs and MQTT wire behavior aligned with `../automato-core-py`. The JS core is loaded as global scripts by `../automato-http-client/index.html`; script ordering and browser global names are part of how the client runs. Differences may be intentional (for example browser platform constraints), so inspect the Python counterpart and call sites before “porting” mechanically. Calls must stay aligned with Python: same function names and same parameters in the same order. JS-only helpers and accepted differences are listed explicitly in `test/run.js`. When a bug is found in one core, check the other too. There is no package manifest: the tests use only Node built-ins.
