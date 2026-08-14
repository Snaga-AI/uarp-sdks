/**
 * The casing helpers are pure functions with plenty of surprising corners, and
 * every emitter depends on them. They are the cheapest thing in the repository
 * to test and the most expensive to get wrong.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  adaIdent,
  adaName,
  camel,
  isPlainJsKey,
  kebab,
  kotlinIdent,
  pascal,
  rustIdent,
  screamingSnake,
  singular,
  snake,
  swiftIdent,
  tsIdent,
  words,
} from '../src/naming.ts';

test('splits identifiers into words', () => {
  assert.deepEqual(words('agent_id'), ['agent', 'id']);
  assert.deepEqual(words('agentId'), ['agent', 'id']);
  assert.deepEqual(words('AgentID'), ['agent', 'id']);
  assert.deepEqual(words('Last-Event-ID'), ['last', 'event', 'id']);
  assert.deepEqual(words('OpenAI-Compat'), ['open', 'ai', 'compat']);
  assert.deepEqual(words('HTTPServer'), ['http', 'server']);
});

test('keeps digits inside their word', () => {
  // `A2A` and `v1` must not be sliced apart at the digit.
  assert.deepEqual(words('A2A'), ['a2a']);
  assert.deepEqual(words('v1'), ['v1']);
  assert.deepEqual(words('2fa'), ['2fa']);
});

test('renders PascalCase', () => {
  assert.equal(pascal('list_agents'), 'ListAgents');
  assert.equal(pascal('listAgents'), 'ListAgents');
  assert.equal(pascal('admin config'), 'AdminConfig');
});

test('renders camelCase', () => {
  assert.equal(camel('agent_id'), 'agentId');
  assert.equal(camel('has_more'), 'hasMore');
  assert.equal(camel('Last-Event-ID'), 'lastEventId');
});

test('upper-cases only the acronyms worth upper-casing', () => {
  // `id` is deliberately not an acronym: `agentID` reads worse than `agentId`.
  assert.equal(camel('agent_id'), 'agentId');
  assert.equal(pascal('agent_id'), 'AgentId');
  assert.equal(pascal('a2a'), 'A2A');
  assert.equal(camel('A2A'), 'a2a');
  assert.equal(pascal('api_key'), 'APIKey');
  assert.equal(pascal('json_rpc'), 'JSONRpc');
});

test('renders snake, screaming snake and kebab', () => {
  assert.equal(snake('agentId'), 'agent_id');
  assert.equal(snake('Last-Event-ID'), 'last_event_id');
  assert.equal(screamingSnake('openai_compat'), 'OPENAI_COMPAT');
  assert.equal(screamingSnake('run.completed'), 'RUN_COMPLETED');
  assert.equal(kebab('AdminConfig'), 'admin-config');
});

test('renders Ada identifiers', () => {
  assert.equal(adaName('agent_id'), 'Agent_Id');
  assert.equal(adaName('has_more'), 'Has_More');
  assert.equal(adaName('a2a'), 'A2A');
  // Ada identifiers may not start with a digit.
  assert.equal(adaName('2fa'), 'N_2fa');
});

test('singularises plurals but leaves lookalikes alone', () => {
  assert.equal(singular('agents'), 'agent');
  assert.equal(singular('policies'), 'policy');
  assert.equal(singular('boxes'), 'box');
  assert.equal(singular('item'), 'item');
  // These merely end in `s`; chopping it would produce `statu` and `addres`.
  assert.equal(singular('status'), 'status');
  assert.equal(singular('address'), 'address');
  assert.equal(singular('analysis'), 'analysis');
});

test('escapes reserved words per language', () => {
  assert.equal(rustIdent('type'), 'r#type');
  assert.equal(rustIdent('agent_id'), 'agent_id');
  assert.equal(swiftIdent('public'), '`public`');
  assert.equal(swiftIdent('name'), 'name');
  assert.equal(kotlinIdent('object'), '`object`');
  assert.equal(kotlinIdent('value'), '`value`');
  assert.equal(kotlinIdent('name'), 'name');
  // Ada is case-insensitive, so the check has to be too.
  assert.equal(adaIdent('Type'), 'Type_K');
  assert.equal(adaIdent('Range'), 'Range_K');
  assert.equal(adaIdent('Agent_Id'), 'Agent_Id');
  // TypeScript needs escaping only for bindings, not for members.
  assert.equal(tsIdent('default'), 'default_');
  assert.equal(tsIdent('agentId'), 'agentId');
});

test('recognises property names that need quoting in JavaScript', () => {
  assert.equal(isPlainJsKey('agent_id'), true);
  assert.equal(isPlainJsKey('$ref'), true);
  assert.equal(isPlainJsKey('Last-Event-ID'), false);
  assert.equal(isPlainJsKey('2fa'), false);
});

test('is stable: the same input always renders the same name', () => {
  const inputs = ['agent_id', 'A2A', 'Last-Event-ID', 'listAgentRuns', 'run.completed'];
  for (const input of inputs) {
    assert.equal(pascal(input), pascal(input));
    assert.equal(adaName(input), adaName(input));
  }
});
