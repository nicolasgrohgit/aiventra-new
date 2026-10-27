import Constants from 'expo-constants';
import { Platform } from 'react-native';
import Purchases, { PRODUCT_CATEGORY, type PurchasesStoreProduct } from 'react-native-purchases';

const extra = (Constants.expoConfig?.extra ?? {}) as { revenuecatIosKey?: string; revenuecatAndroidKey?: string };
const apiKey = Platform.OS === 'ios' ? extra.revenuecatIosKey : extra.revenuecatAndroidKey;
let configured = false;

/** Ties store purchases to our user id, so the RevenueCat webhook knows whom to credit. */
export async function identifyPurchaser(userId: string) {
  if (!apiKey) return;
  if (!configured) {
    Purchases.configure({ apiKey, appUserID: userId });
    configured = true;
  } else {
    await Purchases.logIn(userId);
  }
}

export async function resetPurchaser() {
  if (configured) await Purchases.logOut().catch(() => {});
}

export async function loadCoinProducts(productIds: string[]): Promise<PurchasesStoreProduct[]> {
  if (!configured) return [];
  const products = await Purchases.getProducts(productIds, PRODUCT_CATEGORY.NON_SUBSCRIPTION);
  return products.sort((a, b) => a.price - b.price);
}

/** Resolves true on success, false if the user cancelled. Coins arrive via the server webhook. */
export async function buyProduct(product: PurchasesStoreProduct): Promise<boolean> {
  try {
    await Purchases.purchaseStoreProduct(product);
    return true;
  } catch (e: any) {
    if (e?.userCancelled) return false;
    throw e;
  }
}

export const purchasesEnabled = () => Boolean(apiKey);
