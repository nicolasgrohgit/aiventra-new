import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import type { PurchasesStoreProduct } from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, styles } from '@/components/ui';
import { api } from '@/lib/api';
import { buyProduct, loadCoinProducts, purchasesEnabled } from '@/lib/purchases';
import { colors } from '@/lib/theme';

interface WalletData {
  coins: number;
  diamonds: number;
  diamondsUsd: number;
  payouts: { id: string; amountUsd: number; status: string; createdAt: string }[];
}
interface Catalog {
  coinPacks: { productId: string; coins: number; priceUsd: number }[];
  minPayoutDiamonds: number;
}

export default function Wallet() {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [products, setProducts] = useState<PurchasesStoreProduct[]>([]);
  const [buying, setBuying] = useState<string | null>(null);
  const [destination, setDestination] = useState('');
  const [payoutBusy, setPayoutBusy] = useState(false);

  const load = useCallback(async () => {
    const [w, c] = await Promise.all([api<WalletData>('/wallet'), api<Catalog>('/catalog')]);
    setWallet(w);
    setCatalog(c);
    loadCoinProducts(c.coinPacks.map((p) => p.productId)).then(setProducts).catch((e) => console.warn(e));
  }, []);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  const buy = async (product: PurchasesStoreProduct) => {
    setBuying(product.identifier);
    try {
      if (await buyProduct(product)) {
        // Coins are credited by the server once RevenueCat's webhook lands (usually < 5s).
        setTimeout(() => load().catch(() => {}), 4000);
        Alert.alert('Purchase complete', 'Your coins will appear in a few seconds.');
      }
    } catch (e: any) {
      Alert.alert('Purchase failed', e.message);
    } finally {
      setBuying(null);
    }
  };

  const requestPayout = async () => {
    if (!wallet) return;
    setPayoutBusy(true);
    try {
      await api('/payouts', { body: { diamonds: wallet.diamonds, destination } });
      setDestination('');
      await load();
      Alert.alert('Payout requested', 'Payouts are reviewed and sent within 7 business days.');
    } catch (e: any) {
      Alert.alert('Payout failed', e.message);
    } finally {
      setPayoutBusy(false);
    }
  };

  const coinsFor = (id: string) => catalog?.coinPacks.find((p) => p.productId === id)?.coins ?? 0;
  const canCashOut = !!wallet && !!catalog && wallet.diamonds >= catalog.minPayoutDiamonds;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Text style={styles.h1}>Wallet</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={[styles.card, { flex: 1 }]}>
            <Text style={styles.muted}>Coins</Text>
            <Text style={[styles.h1, { color: colors.accent2 }]}>🪙 {wallet?.coins ?? '–'}</Text>
          </View>
          <View style={[styles.card, { flex: 1 }]}>
            <Text style={styles.muted}>Diamonds</Text>
            <Text style={[styles.h1, { color: '#7FDBFF' }]}>💎 {wallet?.diamonds ?? '–'}</Text>
            <Text style={styles.muted}>≈ ${wallet?.diamondsUsd.toFixed(2) ?? '0.00'}</Text>
          </View>
        </View>

        <Text style={styles.h2}>Buy coins</Text>
        {!purchasesEnabled() && <Text style={styles.muted}>In-app purchases are not configured in this build.</Text>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {products.map((p) => (
            <Pressable key={p.identifier} onPress={() => buy(p)} disabled={!!buying} style={[styles.card, { width: '47%', alignItems: 'center', opacity: buying && buying !== p.identifier ? 0.5 : 1 }]}>
              <Text style={[styles.h2, { color: colors.accent2 }]}>🪙 {coinsFor(p.identifier)}</Text>
              <Text style={styles.body}>{buying === p.identifier ? 'Processing…' : p.priceString}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.h2}>Cash out</Text>
        <View style={styles.card}>
          <Text style={styles.muted}>
            Minimum {catalog?.minPayoutDiamonds.toLocaleString() ?? '–'} diamonds. We pay via Wise (bank transfer in most currencies).
          </Text>
          <Field label="Wise email, or IBAN + account holder name" value={destination} onChangeText={setDestination} autoCapitalize="none" />
          <Button title={canCashOut ? `Request $${wallet!.diamondsUsd.toFixed(2)}` : 'Not enough diamonds yet'} onPress={requestPayout} busy={payoutBusy} variant={canCashOut ? 'primary' : 'ghost'} />
          {wallet?.payouts.map((p) => (
            <Text key={p.id} style={styles.muted}>
              {new Date(p.createdAt).toLocaleDateString()} · ${p.amountUsd.toFixed(2)} · {p.status}
            </Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
