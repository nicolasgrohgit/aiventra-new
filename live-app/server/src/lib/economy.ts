// Virtual-currency economics: pure, no I/O, so the margin math is unit-tested.
//
// Flow: viewer buys Coins via Apple/Google IAP (RevenueCat) -> sends a Gift
// (costs Coins) -> streamer receives Diamonds -> streamer requests a cash
// payout in USD, paid manually from the business Wise account.

export interface CoinPack {
  productId: string; // must match the store / RevenueCat product identifier
  coins: number;
  priceUsd: number; // store list price, for display + margin checks only
}

export const COIN_PACKS: CoinPack[] = [
  { productId: 'coins_100', coins: 100, priceUsd: 0.99 },
  { productId: 'coins_550', coins: 550, priceUsd: 4.99 },
  { productId: 'coins_1200', coins: 1200, priceUsd: 9.99 },
  { productId: 'coins_6500', coins: 6500, priceUsd: 49.99 },
];

export interface Gift {
  id: string;
  name: string;
  emoji: string;
  coins: number;
}

export const GIFTS: Gift[] = [
  { id: 'rose', name: 'Rose', emoji: '🌹', coins: 1 },
  { id: 'heart', name: 'Heart', emoji: '💖', coins: 5 },
  { id: 'coffee', name: 'Coffee', emoji: '☕', coins: 20 },
  { id: 'crown', name: 'Crown', emoji: '👑', coins: 100 },
  { id: 'rocket', name: 'Rocket', emoji: '🚀', coins: 500 },
  { id: 'castle', name: 'Castle', emoji: '🏰', coins: 2000 },
];

/** Diamonds credited to the streamer per Coin a viewer spends on a gift. */
export const DIAMONDS_PER_COIN = 1;
/** Cash value of one Diamond at payout time. */
export const USD_PER_DIAMOND = 0.003;
/** Smallest payout request, in Diamonds ($30 at the rate above). */
export const MIN_PAYOUT_DIAMONDS = 10_000;
/** Worst-case app-store commission (Apple/Google standard tier). */
export const WORST_CASE_STORE_FEE = 0.3;

export function findGift(giftId: string): Gift | undefined {
  return GIFTS.find((g) => g.id === giftId);
}

export function coinsForProduct(productId: string): number | undefined {
  return COIN_PACKS.find((p) => p.productId === productId)?.coins;
}

export function diamondsForGift(gift: Gift, quantity = 1): number {
  return gift.coins * quantity * DIAMONDS_PER_COIN;
}

export function payoutUsd(diamonds: number): number {
  return Math.floor(diamonds * USD_PER_DIAMOND * 100) / 100;
}

/** Platform's net revenue share per Coin for a pack, after store fee + creator payout. */
export function platformMarginPerCoin(pack: CoinPack, storeFee = WORST_CASE_STORE_FEE): number {
  const netPerCoin = (pack.priceUsd * (1 - storeFee)) / pack.coins;
  return netPerCoin - DIAMONDS_PER_COIN * USD_PER_DIAMOND;
}
