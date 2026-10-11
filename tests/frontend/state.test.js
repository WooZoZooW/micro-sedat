import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateMachine, TRANSITIONS } from '../../frontend/lib/state.js';

test('follows the designed happy-path transitions', () => {
  const machine = createStateMachine();
  assert.equal(machine.get(), 'idle');
  assert.equal(machine.to('recording'), 'recording');
  assert.equal(machine.to('idle'), 'idle');
  assert.equal(machine.to('submitting'), 'submitting');
  assert.equal(machine.to('delivered'), 'delivered');
  assert.equal(machine.to('idle'), 'idle');
});

test('supports recording cancellation and error retry paths', () => {
  const machine = createStateMachine();
  machine.to('recording');
  machine.to('idle');

  machine.to('submitting');
  machine.to('error');
  machine.to('submitting');
  machine.to('error');
  machine.to('idle');
  assert.equal(machine.get(), 'idle');
});

test('rejects invalid transitions with an explicit error code', () => {
  const machine = createStateMachine();
  assert.equal(machine.can('delivered'), false);
  assert.throws(() => machine.to('delivered'), (error) => error.code === 'INVALID_TRANSITION');
  machine.to('recording');
  assert.throws(() => machine.to('submitting'), (error) => error.code === 'INVALID_TRANSITION');
  assert.throws(() => machine.to('delivered'), (error) => error.code === 'INVALID_TRANSITION');
});

test('notifies subscribers and tolerates failing listeners', () => {
  const machine = createStateMachine();
  const seen = [];
  machine.onChange((state) => seen.push(state));
  machine.onChange(() => {
    throw new Error('listener failure');
  });
  machine.to('recording');
  machine.to('idle');
  assert.deepEqual(seen, ['recording', 'idle']);
});

test('exposes the transition table for documentation purposes', () => {
  assert.deepEqual(TRANSITIONS.idle, ['recording', 'submitting']);
  assert.deepEqual(TRANSITIONS.delivered, ['idle']);
});
