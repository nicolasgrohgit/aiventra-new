import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  encryptWithKey,
  decryptWithKey,
  generateDataKey,
  wrapDataKey,
  unwrapDataKey,
  isEncryptedValue,
  isEncryptionConfigured,
  getMasterKey,
  _resetMasterKeyCacheForTests,
} from './field-encryption';

const ORIGINAL_ENV = process.env.ENCRYPTION_MASTER_KEY;

afterEach(() => {
  process.env.ENCRYPTION_MASTER_KEY = ORIGINAL_ENV;
  _resetMasterKeyCacheForTests();
});

describe('encryptWithKey / decryptWithKey', () => {
  test('round-trips a plaintext string', () => {
    const key = generateDataKey();
    const ciphertext = encryptWithKey('Dinner with the Rome client', key);
    assert.notEqual(ciphertext, 'Dinner with the Rome client');
    assert.equal(decryptWithKey(ciphertext, key), 'Dinner with the Rome client');
  });

  test('round-trips an empty string', () => {
    const key = generateDataKey();
    const ciphertext = encryptWithKey('', key);
    assert.equal(decryptWithKey(ciphertext, key), '');
  });

  test('produces a different ciphertext each call (random IV)', () => {
    const key = generateDataKey();
    const a = encryptWithKey('same input', key);
    const b = encryptWithKey('same input', key);
    assert.notEqual(a, b);
    assert.equal(decryptWithKey(a, key), 'same input');
    assert.equal(decryptWithKey(b, key), 'same input');
  });

  test('decrypting with the wrong key fails loudly instead of returning garbage', () => {
    const key = generateDataKey();
    const wrongKey = generateDataKey();
    const ciphertext = encryptWithKey('secret', key);
    assert.throws(() => decryptWithKey(ciphertext, wrongKey));
  });

  test('decryptWithKey passes through a value that is not in ciphertext format', () => {
    const key = generateDataKey();
    // Simulates a legacy, never-encrypted Event field read before migration runs.
    assert.equal(decryptWithKey('Dinner', key), 'Dinner');
    assert.equal(decryptWithKey('', key), '');
  });

  test('isEncryptedValue distinguishes ciphertext from plaintext', () => {
    const key = generateDataKey();
    assert.equal(isEncryptedValue(encryptWithKey('x', key)), true);
    assert.equal(isEncryptedValue('Dinner'), false);
    assert.equal(isEncryptedValue(''), false);
    assert.equal(isEncryptedValue(undefined), false);
  });
});

describe('wrapDataKey / unwrapDataKey', () => {
  test('round-trips a data key under a configured master key', () => {
    process.env.ENCRYPTION_MASTER_KEY = crypto.randomBytes(32).toString('hex');
    _resetMasterKeyCacheForTests();
    const dataKey = generateDataKey();
    const wrapped = wrapDataKey(dataKey);
    assert.ok(wrapped);
    const unwrapped = unwrapDataKey(wrapped as string);
    assert.ok(unwrapped);
    assert.equal(Buffer.compare(dataKey, unwrapped as Buffer), 0);
  });

  test('no-ops (returns null) when no master key is configured', () => {
    delete process.env.ENCRYPTION_MASTER_KEY;
    _resetMasterKeyCacheForTests();
    assert.equal(isEncryptionConfigured(), false);
    assert.equal(getMasterKey(), null);
    assert.equal(wrapDataKey(generateDataKey()), null);
  });

  test('rejects a master key that is not 64 hex characters', () => {
    process.env.ENCRYPTION_MASTER_KEY = 'not-a-valid-hex-key';
    _resetMasterKeyCacheForTests();
    assert.equal(getMasterKey(), null);
  });
});
