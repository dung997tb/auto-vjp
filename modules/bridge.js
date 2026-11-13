/* Auto vjp — module layer bridge.
 * Được background.js của lõi FB nạp bằng importScripts ở CUỐI file (1 điểm chạm duy nhất).
 * Nạp kernel theo thứ tự phụ thuộc; mọi file kernel đều là classic script bọc IIFE,
 * chỉ phơi global `AVJP` — không đụng global của lõi FB.
 */
(() => {
  const FILES = [
    'modules/kernel/contract-data.js',
    'modules/kernel/contract.js',
    'modules/kernel/store.js',
    'modules/kernel/outbox.js',
    'modules/kernel/remote.js',
    'modules/kernel/media.js',
    'modules/kernel/aitab.js',
    'modules/kernel/heal.js',
    'modules/kernel/fbtask.js',
    'modules/kernel/runner.js',
    'modules/kernel/source.js',
    'modules/kernel/results.js'
  ];
  for (const file of FILES) importScripts(file);
  globalThis.AVJP.source.setup();
  console.log('[Auto vjp] module layer ready — platforms:', globalThis.AVJP.contract.platformNames.join(', '));
})();
