import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { styles } from '@/components/ui';
import { api, type Gift } from '@/lib/api';
import { colors } from '@/lib/theme';

export function GiftSheet({ visible, streamId, coins, onClose, onSent, onNeedCoins }: {
  visible: boolean;
  streamId: string;
  coins: number;
  onClose: () => void;
  onSent: (coinsLeft: number) => void;
  onNeedCoins: () => void;
}) {
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible && !gifts.length) api<{ gifts: Gift[] }>('/catalog').then((c) => setGifts(c.gifts)).catch(() => {});
  }, [visible, gifts.length]);

  const send = async (gift: Gift) => {
    if (gift.coins > coins) return onNeedCoins();
    setSending(gift.id);
    setError('');
    try {
      const res = await api<{ coins: number }>(`/streams/${streamId}/gifts`, { body: { giftId: gift.id, quantity: 1 } });
      onSent(res.coins);
    } catch (e: any) {
      if (e.status === 402) onNeedCoins();
      else setError(e.message);
    } finally {
      setSending(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose} />
      <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, gap: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.h2}>Send a gift</Text>
          <Pressable onPress={onNeedCoins}><Text style={{ color: colors.accent2, fontWeight: '700' }}>🪙 {coins}  +</Text></Pressable>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {gifts.map((g) => (
            <Pressable key={g.id} onPress={() => send(g)} style={{ width: '33.3%', alignItems: 'center', paddingVertical: 12, opacity: sending && sending !== g.id ? 0.4 : 1 }}>
              <Text style={{ fontSize: 40 }}>{g.emoji}</Text>
              <Text style={styles.body}>{g.name}</Text>
              <Text style={{ color: colors.accent2, fontSize: 13 }}>🪙 {g.coins}</Text>
            </Pressable>
          ))}
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>
    </Modal>
  );
}
