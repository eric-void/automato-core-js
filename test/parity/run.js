#!/usr/bin/env node
/**
 * Run the same scenario on both cores (with the same positional calls) and compare the results.
 * Python core runs in the automato-node docker image (it has the dependencies), with the source of the sibling checkout: node automato-core-js/test/parity/run.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { bootSystem, realConsole } = require('../harness.js');

const SCENARIO = path.join(__dirname, 'scenario.json');
const CORE_PY = path.resolve(__dirname, '..', '..', '..', 'automato-core-py', 'src');
const DOCKER_IMAGE = process.env.AUTOMATO_NODE_IMAGE || 'automato-node:local';

function sorted(v) {
  if (Array.isArray(v))
    return v.map(sorted);
  if (v !== null && typeof v == 'object')
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])]));
  return v === undefined ? null : v;
}

function stripTime(v) {
  if (v !== null && typeof v == 'object' && !Array.isArray(v))
    return Object.fromEntries(Object.keys(v).filter(k => k != 'time').map(k => [k, stripTime(v[k])]));
  return v;
}

function runJs(scenario) {
  let { system, client, receive } = bootSystem(scenario['definitions']);
  let results = [];
  for (let step of scenario['steps']) {
    if ('message' in step) {
      receive(step['message'], step['payload']);
      continue;
    }
    if ('published' in step) {
      results.push(client.published.slice());
      client.published.length = 0;
      continue;
    }
    if ('entry_exists' in step) {
      results.push(system.entry_get(step['entry_exists']) !== null);
      continue;
    }
    let ret;
    if ('entry_call' in step)
      ret = system[step['entry_call']](system.entry_get(step['entry']), ...step['args']);
    else if ('entry_method' in step)
      ret = system.entry_get(step['entry'])[step['entry_method']](...step['args']);
    else if ('do_action_lambda' in step)
      ret = system.do_action_lambda(system.entry_get(step['do_action_lambda']))(...step['args']);
    else
      ret = system[step['call']](...step['args']);
    if ('pick' in step && ret !== null)
      ret = Object.fromEntries(step['pick'].map(k => [k, k in ret ? ret[k] : null]));
    if ('keys' in step)
      ret = Object.keys(ret);
    if ('field' in step)
      ret = Object.fromEntries(Object.keys(ret).map(k => [k, ret[k][step['field']]]));
    if ('sort' in step)
      ret = ret.slice().sort();
    if ('time' in step)
      ret = Number.isInteger(ret) && ret > 0;
    if ('time_at' in step) {
      ret = ret.slice();
      ret[step['time_at']] = ret[step['time_at']] > 0;
    }
    if ('strip_time' in step)
      ret = Object.fromEntries(Object.keys(ret).map(k => [k, Object.fromEntries(Object.keys(ret[k]).map(i => [i, stripTime(ret[k][i])]))]));
    results.push(ret === undefined ? null : ret);
  }
  return JSON.parse(JSON.stringify(sorted(results)));
}

function runPy() {
  let output = execFileSync('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'python',
    '-v', CORE_PY + ':/opt/automato/automato-core-py/src:ro',
    '-v', __dirname + ':/parity:ro',
    '-e', 'PYTHONDONTWRITEBYTECODE=1',
    DOCKER_IMAGE, '/parity/run.py', '/parity/scenario.json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  let line = output.split('\n').find(l => l.startsWith('PARITY_RESULT:'));
  assert.ok(line, 'no result from python runner:\n' + output);
  return JSON.parse(line.slice('PARITY_RESULT:'.length));
}

// Json payloads are compared by value (python has a different whitespace)
function comparable(results) {
  return JSON.stringify(results, function(k, v) {
    if (k == 'payload' && typeof v == 'string')
      try {
        return JSON.parse(v);
      } catch (e) {
      }
    return v;
  });
}

let scenario = JSON.parse(fs.readFileSync(SCENARIO, 'utf8'));
let js = runJs(scenario);
let py = runPy();
let steps = scenario['steps'].filter(s => !('message' in s));
let failed = 0;
for (let i = 0; i < Math.max(js.length, py.length); i ++)
  if (comparable(js[i]) != comparable(py[i])) {
    failed ++;
    realConsole.log('DIFF step ' + JSON.stringify(steps[i]) + '\n  js: ' + JSON.stringify(js[i]) + '\n  py: ' + JSON.stringify(py[i]));
  }
realConsole.log((js.length - failed) + '/' + js.length + ' results are the same on both cores');
process.exit(failed ? 1 : 0);
