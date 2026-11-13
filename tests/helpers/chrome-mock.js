// chrome giả tối thiểu cho test kernel: storage.local trong RAM (sao chép sâu
// khi đọc/ghi như Chrome thật), alarms/runtime/tabs chỉ đủ để kernel nạp được.
'use strict';

function createChromeMock() {
  let data = {};
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const removedTabs = [];
  const event = () => ({ addListener() {} });
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return clone(data);
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (k in data) out[k] = clone(data[k]);
          return out;
        },
        async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = clone(v); },
        async remove(keys) { for (const k of (Array.isArray(keys) ? keys : [keys])) delete data[k]; }
      }
    },
    alarms: { create() {}, onAlarm: event() },
    runtime: { onStartup: event(), onMessage: event(), getManifest: () => ({ name: 'Auto vjp', version: '0.0.0' }) },
    tabs: {
      async remove(id) { removedTabs.push(id); },
      onUpdated: event(), onRemoved: event()
    }
  };
  return {
    chrome,
    removedTabs,
    reset() { data = {}; removedTabs.length = 0; },
    dump: () => clone(data)
  };
}

module.exports = { createChromeMock };
