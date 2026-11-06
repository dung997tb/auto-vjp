(() => {
  if (globalThis.__mutCanonicalTaskStorageInstalled) return;
  globalThis.__mutCanonicalTaskStorageInstalled = true;

  const CANONICAL_KEY = 'currentAutomationRun';
  const native = {
    get: chrome.storage.local.get.bind(chrome.storage.local),
    set: chrome.storage.local.set.bind(chrome.storage.local),
    remove: chrome.storage.local.remove.bind(chrome.storage.local)
  };

  const legacyDescriptor = key => {
    if (key === 'currentProcessingPost') return { type: 'post' };
    if (key === 'currentOwnPostCommentTask') return { type: 'post_comment' };
    const affiliate = /^currentAffiliateCommentTask_(.+)$/.exec(key);
    if (affiliate) return { type: 'affiliate', platform: affiliate[1] };
    const reply = /^currentCommentReplyTask_(.+)$/.exec(key);
    if (reply) return { type: 'reply', platform: reply[1] };
    return null;
  };

  const normPlatform = p => String(p || '').toLowerCase() === 'twitter' ? 'x' : String(p || '').toLowerCase();
  const taskForLegacyKey = (run, key) => {
    const descriptor = legacyDescriptor(key);
    if (!descriptor || !run || run.type !== descriptor.type) return undefined;
    if (descriptor.platform && normPlatform(run.platform || 'facebook') !== normPlatform(descriptor.platform)) return undefined;
    return run;
  };

  const requestedKeys = keys => {
    if (typeof keys === 'string') return [keys];
    if (Array.isArray(keys)) return keys;
    if (keys && typeof keys === 'object') return Object.keys(keys);
    return [];
  };

  chrome.storage.local.get = (keys, callback) => {
    const legacyKeys = requestedKeys(keys).filter(key => legacyDescriptor(key));
    if (!legacyKeys.length) return native.get(keys, callback);
    const promise = native.get(keys === null ? null : [...new Set([...requestedKeys(keys), CANONICAL_KEY])]).then(result => {
      const output = { ...result };
      for (const key of legacyKeys) output[key] = taskForLegacyKey(result[CANONICAL_KEY], key);
      if (!requestedKeys(keys).includes(CANONICAL_KEY)) delete output[CANONICAL_KEY];
      return output;
    });
    if (typeof callback === 'function') {
      promise.then(callback);
      return undefined;
    }
    return promise;
  };

  chrome.storage.local.set = (items, callback) => {
    const entries = Object.entries(items || {});
    const legacyEntries = entries.filter(([key]) => legacyDescriptor(key));
    if (!legacyEntries.length) return native.set(items, callback);
    const promise = native.get(CANONICAL_KEY).then(stored => {
      let run = stored[CANONICAL_KEY];
      const passthrough = {};
      for (const [key, value] of entries) {
        const descriptor = legacyDescriptor(key);
        if (!descriptor) {
          passthrough[key] = value;
          continue;
        }
        if (!value) continue;
        if (run && run.type === descriptor.type && (!descriptor.platform || run.platform === descriptor.platform)) {
          run = { ...run, ...value, type: descriptor.type, task_id: String(value.id || value.task_id || run.task_id || ''), updatedAt: Date.now() };
        }
      }
      if (run) passthrough[CANONICAL_KEY] = run;
      return native.set(passthrough);
    });
    if (typeof callback === 'function') {
      promise.then(callback);
      return undefined;
    }
    return promise;
  };

  chrome.storage.local.remove = (keys, callback) => {
    const list = Array.isArray(keys) ? keys : [keys];
    const legacyKeys = list.filter(key => legacyDescriptor(key));
    if (!legacyKeys.length) return native.remove(keys, callback);
    const passthrough = list.filter(key => !legacyDescriptor(key));
    // A content script finishing its DOM work is not authoritative. The
    // canonical run is removed only by ResultReporter after a server receipt.
    const promise = passthrough.length ? native.remove(passthrough) : Promise.resolve();
    if (typeof callback === 'function') {
      promise.then(callback);
      return undefined;
    }
    return promise;
  };
})();
