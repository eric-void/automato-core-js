# automato-core-js

JavaScript counterpart of the shared Automato core. Read `../AGENTS.md` and `../ARCHITECTURE.md` for system context.

## Layout

- `src/automato/core/system.js`: `AutomatoSystem`, entry metadata/lifecycle, topic/event/action semantics.
- `mqtt.js`, `scripting_js.js`, `notifications.js`, `utils.js`: browser/runtime support modules.
- `test/index.html`: browser-oriented test harness.
- `docs/py_conversion.txt`: historical implementation/conversion notes.

## Guidance

Keep shared APIs and MQTT wire behavior aligned with `../automato-core-py`. The JS core is loaded as global scripts by `../automato-http-client/index.html`; script ordering and browser global names are part of how the client runs. Differences may be intentional (for example browser platform constraints), so inspect the Python counterpart and call sites before “porting” mechanically. The test harness is not a Node package setup; no package manifest was found at the project root.
