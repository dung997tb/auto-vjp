const test = require('node:test'), assert = require('node:assert/strict');
const { parseMetricNumber: p, dropEmptyChunks } = require('../modules/shared/metrics.js');
const table = [
  ['1.2K', 1200], ['12.5K', 12500], ['1,2K', 1200], ['1,2 N', 1200], ['2,5 Tr', 2500000],
  ['1.234', 1234], ['1.234.567', 1234567], ['1,234', 1234], ['1,234,567', 1234567],
  ['3.5M', 3500000], ['2B', 2e9], ['850', 850], ['10K followers', 10000], ['1,5 triệu', 1500000],
  ['2 tỷ', 2e9], ['1 người theo dõi', 1], ['12 bài viết', 12], ['1.234,5', 1235], ['', null], ['abc', null], [null, null]
];
for (const [input, want] of table) test(`parseMetricNumber(${JSON.stringify(input)}) = ${want}`, () => assert.equal(p(input), want));
test('dropEmptyChunks bỏ đoạn rỗng', () => assert.deepEqual(dropEmptyChunks(['a', '', '  ', 'b ']), ['a', 'b']));
