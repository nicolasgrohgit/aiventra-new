import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COIN_PACKS, GIFTS, coinsForProduct, diamondsForGift, findGift,
  payoutUsd, platformMarginPerCoin, MIN_PAYOUT_DIAMONDS,
} from './economy';

test('every coin pack stays profitable after worst-case store fee and creator payout', () => {
  for (const pack of COIN_PACKS) {
    assert.ok(platformMarginPerCoin(pack) > 0, `${pack.productId} loses money`);
  }
});

test('gift ids and product ids are unique', () => {
  assert.equal(new Set(GIFTS.map((g) => g.id)).size, GIFTS.length);
  assert.equal(new Set(COIN_PACKS.map((p) => p.productId)).size, COIN_PACKS.length);
});

test('lookups', () => {
  assert.equal(coinsForProduct('coins_100'), 100);
  assert.equal(coinsForProduct('nope'), undefined);
  assert.equal(diamondsForGift(findGift('crown')!, 3), 300);
});

test('payout rounds down to cents', () => {
  assert.equal(payoutUsd(MIN_PAYOUT_DIAMONDS), 30);
  assert.equal(payoutUsd(3333), 9.99);
});
