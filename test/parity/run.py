#!/usr/bin/env python3
"""
Run parity scenario on python core, and print the results as json. Launched by parity/run.js
"""
import json
import logging
import sys

from automato.core import mqtt, system, utils

def normalize(v):
  if isinstance(v, (list, tuple)):
    return [normalize(x) for x in v]
  if isinstance(v, dict):
    return {str(k): normalize(v[k]) for k in v}
  if isinstance(v, float) and v.is_integer():
    return int(v)
  return v

def strip_time(v):
  if isinstance(v, dict):
    return {k: strip_time(v[k]) for k in v if k != 'time'}
  return v

published = []
def publish(topic, payload, qos = 0, retain = False):
  if not isinstance(payload, str) and payload is not None:
    payload = utils.json_export(payload)
  published.append({'topic': topic, 'payload': payload if payload is not None else '', 'qos': qos, 'retain': retain})

def receive(topic, payload):
  system._on_mqtt_message(topic, payload, mqtt._decodePayload(payload), 0, False, None, system.timems())

def run(scenario):
  results = []
  logging.disable(logging.CRITICAL)
  system.set_config({'name': 'client', 'listen_all_events': True, 'entries': []})
  system.boot()
  mqtt.connect = lambda callback = None: None
  mqtt.publish = publish
  system.init(lambda: None)
  system.entry_load(scenario['definitions'], False, False, False)
  for step in scenario['steps']:
    if 'message' in step:
      receive(step['message'], step['payload'])
      continue
    if 'published' in step:
      results.append(list(published))
      published.clear()
      continue
    if 'entry_exists' in step:
      results.append(system.entry_get(step['entry_exists']) is not None)
      continue
    if 'entry_call' in step:
      ret = getattr(system, step['entry_call'])(system.entry_get(step['entry']), *step['args'])
    elif 'entry_method' in step:
      ret = getattr(system.entry_get(step['entry']), step['entry_method'])(*step['args'])
    elif 'do_action_lambda' in step:
      ret = system.do_action_lambda(system.entry_get(step['do_action_lambda']))(*step['args'])
    else:
      ret = getattr(system, step['call'])(*step['args'])
    if 'pick' in step and ret is not None:
      ret = {k: ret[k] if k in ret else None for k in step['pick']}
    if 'keys' in step:
      ret = list(ret.keys())
    if 'field' in step:
      ret = {k: ret[k][step['field']] for k in ret}
    if 'sort' in step:
      ret = sorted(ret)
    if 'time' in step:
      ret = isinstance(ret, int) and ret > 0
    if 'time_at' in step:
      ret = list(ret)
      ret[step['time_at']] = ret[step['time_at']] > 0
    if 'strip_time' in step:
      ret = {k: {i: strip_time(ret[k][i]) for i in ret[k]} for k in ret}
    results.append(ret)
  return normalize(results)

print('PARITY_RESULT:' + json.dumps(run(json.load(open(sys.argv[1]))), sort_keys = True))
