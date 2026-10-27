import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, styles } from '@/components/ui';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';

export default function GoLive() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const { stream } = await api<{ stream: { id: string } }>('/streams', { body: { title: title.trim() } });
      setTitle('');
      router.push(`/live/${stream.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: 24, gap: 16 }}>
      <Text style={styles.h1}>Go live</Text>
      <Text style={styles.muted}>Viewers send gifts — every gift coin becomes a diamond you can cash out.</Text>
      <Field label="Stream title" value={title} onChangeText={setTitle} placeholder="Late night karaoke 🎤" maxLength={80} />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button title="Start streaming" onPress={start} busy={busy} />
      <Text style={[styles.muted, { fontSize: 12 }]}>
        Keep it clean: no nudity, no minors on camera, no asking for payments outside the app. Breaking the rules gets streams ended and accounts banned.
      </Text>
    </SafeAreaView>
  );
}
