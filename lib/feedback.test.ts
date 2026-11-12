import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedbackKind, sanitizeFeedbackContext } from './feedback';

test('kind defaults to suggestion — builds older than "Report a problem" send none', () => {
  assert.equal(parseFeedbackKind(undefined), 'suggestion');
  assert.equal(parseFeedbackKind('suggestion'), 'suggestion');
  assert.equal(parseFeedbackKind('problem'), 'problem');
});

test('an unknown kind falls back to suggestion rather than being stored', () => {
  assert.equal(parseFeedbackKind('urgent'), 'suggestion');
  assert.equal(parseFeedbackKind({ $ne: null }), 'suggestion');
});

test('context keeps only the known string fields', () => {
  assert.deepEqual(
    sanitizeFeedbackContext({ appVersion: '0.0.43', platform: 'android', osVersion: '15', deviceModel: 'Pixel 8', email: 'x@y.z', nested: { a: 1 } }),
    { appVersion: '0.0.43', platform: 'android', osVersion: '15', deviceModel: 'Pixel 8' }
  );
});

test('context drops non-string and blank values', () => {
  assert.deepEqual(sanitizeFeedbackContext({ appVersion: 43, platform: '  ', osVersion: null, deviceModel: ' Pixel 8 ' }), { deviceModel: 'Pixel 8' });
});

test('context values are clipped so a client cannot store an arbitrary blob', () => {
  const out = sanitizeFeedbackContext({ deviceModel: 'x'.repeat(500) });
  assert.equal(out?.deviceModel?.length, 80);
});

test('no usable context is undefined, not an empty object', () => {
  assert.equal(sanitizeFeedbackContext(undefined), undefined);
  assert.equal(sanitizeFeedbackContext('android'), undefined);
  assert.equal(sanitizeFeedbackContext([]), undefined);
  assert.equal(sanitizeFeedbackContext({ other: 'x' }), undefined);
});
