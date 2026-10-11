const TRANSITIONS = Object.freeze({
  idle: ['recording', 'submitting'],
  recording: ['idle'],
  submitting: ['idle', 'delivered', 'error'],
  error: ['idle', 'submitting'],
  delivered: ['idle'],
});

export function createStateMachine(initial = 'idle') {
  let current = initial;
  const listeners = new Set();

  function can(next) {
    return (TRANSITIONS[current] || []).includes(next);
  }

  return {
    get() {
      return current;
    },
    can,
    to(next) {
      if (!can(next)) {
        const error = new Error(`Invalid state transition: ${current} -> ${next}`);
        error.code = 'INVALID_TRANSITION';
        throw error;
      }
      current = next;
      for (const listener of listeners) {
        try {
          listener(current);
        } catch {
          // A listener must not break the state machine.
        }
      }
      return current;
    },
    onChange(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      current = initial;
    },
  };
}

export { TRANSITIONS };
