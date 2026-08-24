import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVATAR_TARGET_SIZE,
  AVATAR_MAX_BASE64_BYTES,
  getAvatarResizeActions,
  estimateBase64Bytes,
  isAvatarBase64SizeAcceptable,
  toAvatarDataUri,
} from './avatar';

describe('getAvatarResizeActions', () => {
  test('resizes to a square at the configured target size', () => {
    const actions = getAvatarResizeActions();
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0], { resize: { width: AVATAR_TARGET_SIZE, height: AVATAR_TARGET_SIZE } });
  });
});

describe('estimateBase64Bytes', () => {
  test('empty string is 0 bytes', () => {
    assert.equal(estimateBase64Bytes(''), 0);
  });

  test('matches known byte lengths for unpadded/padded base64', () => {
    // "Man" -> "TWFu" (3 bytes, no padding)
    assert.equal(estimateBase64Bytes('TWFu'), 3);
    // "Ma" -> "TWE=" (2 bytes, one pad char)
    assert.equal(estimateBase64Bytes('TWE='), 2);
    // "M" -> "TQ==" (1 byte, two pad chars)
    assert.equal(estimateBase64Bytes('TQ=='), 1);
  });
});

describe('isAvatarBase64SizeAcceptable', () => {
  test('accepts payloads at or under the ceiling', () => {
    const okBase64 = 'A'.repeat(Math.floor((AVATAR_MAX_BASE64_BYTES * 4) / 3));
    assert.ok(estimateBase64Bytes(okBase64) <= AVATAR_MAX_BASE64_BYTES);
    assert.equal(isAvatarBase64SizeAcceptable(okBase64), true);
  });

  test('rejects payloads over the ceiling', () => {
    const tooBig = 'A'.repeat(Math.ceil((AVATAR_MAX_BASE64_BYTES * 4) / 3) + 100);
    assert.equal(isAvatarBase64SizeAcceptable(tooBig), false);
  });
});

describe('toAvatarDataUri', () => {
  test('defaults to an image/jpeg data URI', () => {
    assert.equal(toAvatarDataUri('abc123'), 'data:image/jpeg;base64,abc123');
  });

  test('honors an explicit mime type', () => {
    assert.equal(toAvatarDataUri('abc123', 'image/png'), 'data:image/png;base64,abc123');
  });
});
