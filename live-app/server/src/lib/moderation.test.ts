import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBlockedTerm } from './moderation';

test('flags blocked terms regardless of case/punctuation', () => {
  assert.equal(findBlockedTerm('Add my TeleGram!!'), 'telegram');
  assert.equal(findBlockedTerm('dm for nudes'), 'nudes');
});

test('does not flag substrings of innocent words', () => {
  assert.equal(findBlockedTerm('Singing in Essex tonight'), undefined);
  assert.equal(findBlockedTerm('mining minority report'), undefined);
});
