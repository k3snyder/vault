// Browser shim for Node.js events module
// Provides minimal EventEmitter compatibility for Claude Agent SDK

export class EventEmitter {
  constructor() {
    this._events = {};
    this._maxListeners = 10;
  }

  on(event, listener) {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event].push(listener);
    return this;
  }

  once(event, listener) {
    const onceWrapper = (...args) => {
      this.off(event, onceWrapper);
      listener.apply(this, args);
    };
    return this.on(event, onceWrapper);
  }

  off(event, listener) {
    if (this._events[event]) {
      this._events[event] = this._events[event].filter(l => l !== listener);
    }
    return this;
  }

  emit(event, ...args) {
    if (this._events[event]) {
      this._events[event].forEach(listener => listener.apply(this, args));
      return true;
    }
    return false;
  }

  removeListener(event, listener) {
    return this.off(event, listener);
  }

  removeAllListeners(event) {
    if (event) {
      delete this._events[event];
    } else {
      this._events = {};
    }
    return this;
  }

  setMaxListeners(n) {
    this._maxListeners = n;
    return this;
  }

  getMaxListeners() {
    return this._maxListeners;
  }

  listeners(event) {
    return this._events[event] || [];
  }

  listenerCount(event) {
    return this.listeners(event).length;
  }
}

// Static method for setting max listeners on any EventEmitter
export function setMaxListeners(n, ...emitters) {
  for (const emitter of emitters) {
    if (emitter && typeof emitter.setMaxListeners === 'function') {
      emitter.setMaxListeners(n);
    }
  }
}

export default { EventEmitter, setMaxListeners };
