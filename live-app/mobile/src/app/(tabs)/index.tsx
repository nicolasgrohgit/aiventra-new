import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles } from '@/components/ui';
import { api } from '@/lib/api';
import { APP_NAME, colors } from '@/lib/theme';

interface LiveStream {
  id: string;
  title: string;
  viewers: number;
  hostName: string;
}

// Deterministic per-stream gradient so the grid looks alive without thumbnails.
const PALETTES: [string, string][] = [
  ['#FF3D7F', '#7B2FF7'], ['#FFB13D', '#FF3D7F'], ['#00C6FF', '#7B2FF7'], ['#3DFFB1', '#007CF0'], ['#F7971E', '#FFD200'],
];
const paletteFor = (id: string) => PALETTES[id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTES.length];

export default function Feed() {
  const router = useRouter();
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStreams((await api<{ streams: LiveStream[] }>('/streams')).streams);
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <Text style={[styles.h1, { paddingHorizontal: 16, paddingBottom: 8, color: colors.accent }]}>{APP_NAME}</Text>
      <FlatList
        data={streams}
        keyExtractor={(s) => s.id}
        numColumns={2}
        contentContainerStyle={{ padding: 8, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8 }}>
            <Text style={{ fontSize: 48 }}>📡</Text>
            <Text style={styles.h2}>{error || 'Nobody is live right now'}</Text>
            <Text style={[styles.muted, { textAlign: 'center' }]}>Be the first — tap Go Live.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable style={{ flex: 1 / 2, padding: 6 }} onPress={() => router.push(`/live/${item.id}`)}>
            <LinearGradient colors={paletteFor(item.id)} style={{ aspectRatio: 3 / 4, borderRadius: 16, padding: 10, justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ backgroundColor: colors.live, color: '#fff', fontWeight: '800', fontSize: 11, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' }}>LIVE</Text>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>👁 {item.viewers}</Text>
              </View>
              <View>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }} numberOfLines={2}>{item.title}</Text>
                <Text style={{ color: '#ffffffcc', fontSize: 13 }}>{item.hostName}</Text>
              </View>
            </LinearGradient>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
