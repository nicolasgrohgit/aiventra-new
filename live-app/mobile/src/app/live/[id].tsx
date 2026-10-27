import {
  AudioSession, LiveKitRoom, VideoTrack, isTrackReference, useDataChannel, useParticipants, useTracks,
} from '@livekit/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GiftSheet } from '@/components/GiftSheet';
import { styles } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

interface JoinInfo {
  stream: { id: string; title: string; hostId: string; hostName: string };
  token: string;
  url: string;
}

interface ChatLine {
  id: string;
  from: string;
  text: string;
  gift?: boolean;
}

export default function LiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [join, setJoin] = useState<JoinInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await AudioSession.startAudioSession();
        const info = await api<JoinInfo>(`/streams/${id}/join`, { body: {} });
        if (!cancelled) setJoin(info);
      } catch (e: any) {
        Alert.alert('Unavailable', e.message);
        router.back();
      }
    })();
    return () => {
      cancelled = true;
      AudioSession.stopAudioSession();
    };
  }, [id, router]);

  if (!join) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return <Room join={join} />;
}

function Room({ join }: { join: JoinInfo }) {
  const { user } = useSession();
  const isHost = user?.id === join.stream.hostId;
  const router = useRouter();

  return (
    <LiveKitRoom
      serverUrl={join.url}
      token={join.token}
      connect
      audio={isHost}
      video={isHost}
      options={{ adaptiveStream: { pixelDensity: 'screen' } }}
      onDisconnected={() => { if (!isHost) router.back(); }}
    >
      <RoomView join={join} isHost={isHost} />
    </LiveKitRoom>
  );
}

function RoomView({ join, isHost }: { join: JoinInfo; isHost: boolean }) {
  const router = useRouter();
  const { user, refresh } = useSession();
  const tracks = useTracks([Track.Source.Camera]);
  const participants = useParticipants();
  const hostTrack = tracks.find((t) => t.participant.identity === join.stream.hostId);

  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const [giftsOpen, setGiftsOpen] = useState(false);
  const [coins, setCoins] = useState(user?.coins ?? 0);
  const [burst, setBurst] = useState<string | null>(null);
  const burstTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lineSeq = useRef(0);

  const push = useCallback((line: Omit<ChatLine, 'id'>) => {
    setLines((prev) => [...prev.slice(-80), { ...line, id: String(lineSeq.current++) }]);
  }, []);

  const { send } = useDataChannel('chat', (msg) => {
    const text = new TextDecoder().decode(msg.payload).slice(0, 200);
    push({ from: msg.from?.name || 'viewer', text });
  });

  // Gift events come from the server (authoritative), never from other clients.
  useDataChannel('gift', (msg) => {
    if (msg.from) return;
    const g = JSON.parse(new TextDecoder().decode(msg.payload));
    push({ from: g.from, text: `sent ${g.quantity > 1 ? `${g.quantity}× ` : ''}${g.name} ${g.emoji}`, gift: true });
    setBurst(g.emoji);
    clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(() => setBurst(null), 1800);
  });

  const sendChat = async () => {
    const text = draft.trim().slice(0, 200);
    if (!text) return;
    setDraft('');
    push({ from: user?.displayName ?? 'me', text });
    await send(new TextEncoder().encode(text), { reliable: true }).catch(() => {});
  };

  const end = async () => {
    if (isHost) {
      const res = await api<{ diamondsEarned: number }>(`/streams/${join.stream.id}/end`, { body: {} }).catch(() => null);
      if (res) Alert.alert('Stream ended', `You earned 💎 ${res.diamondsEarned} this stream.`);
    }
    refresh().catch(() => {});
    router.back();
  };

  const moreMenu = () =>
    Alert.alert(join.stream.hostName, undefined, [
      { text: 'Report stream', onPress: report },
      {
        text: 'Block host', style: 'destructive', onPress: async () => {
          await api(`/blocks/${join.stream.hostId}`, { body: {} }).catch(() => {});
          router.back();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const report = () =>
    Alert.alert('Report', 'What is wrong?', [
      ...['Nudity / sexual content', 'Minor on camera', 'Harassment or hate', 'Scam / off-app payment', 'Violence or self-harm'].map((reason) => ({
        text: reason,
        onPress: async () => {
          await api('/reports', { body: { targetUserId: join.stream.hostId, streamId: join.stream.id, reason } }).catch(() => {});
          Alert.alert('Thanks', 'Our team will review this stream.');
        },
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {hostTrack && isTrackReference(hostTrack) ? (
        <VideoTrack trackRef={hostTrack} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} objectFit="cover" mirror={isHost} />
      ) : (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={styles.muted}>{isHost ? 'Starting camera…' : 'Waiting for host video…'}</Text>
        </View>
      )}

      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 }}>
            <View style={{ backgroundColor: '#00000088', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, flexShrink: 1 }}>
              <Text style={{ color: '#fff', fontWeight: '800' }} numberOfLines={1}>{join.stream.hostName}</Text>
              <Text style={{ color: '#ffffffaa', fontSize: 12 }} numberOfLines={1}>{join.stream.title}</Text>
            </View>
            <Text style={{ color: '#fff', backgroundColor: colors.live, borderRadius: 4, paddingHorizontal: 6, fontWeight: '800', fontSize: 12, overflow: 'hidden' }}>LIVE</Text>
            <Text style={{ color: '#fff', fontWeight: '700' }}>👁 {Math.max(0, participants.length - 1)}</Text>
            <View style={{ flex: 1 }} />
            {!isHost && <Pressable onPress={moreMenu} hitSlop={10}><Text style={{ color: '#fff', fontSize: 22 }}>⋯</Text></Pressable>}
            <Pressable onPress={end} hitSlop={10}><Text style={{ color: '#fff', fontSize: 22 }}>{isHost ? '⏹' : '✕'}</Text></Pressable>
          </View>

          {burst && (
            <View pointerEvents="none" style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 120 }}>{burst}</Text>
            </View>
          )}

          <View style={{ padding: 12, gap: 8 }}>
            <FlatList
              // inverted list renders index 0 at the bottom, so newest goes first
              data={[...lines].reverse()}
              keyExtractor={(l) => l.id}
              style={{ maxHeight: 220 }}
              inverted
              renderItem={({ item }) => (
                <Text style={{ color: '#fff', backgroundColor: item.gift ? '#FF3D7F55' : '#00000066', alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginVertical: 2, overflow: 'hidden' }}>
                  <Text style={{ fontWeight: '800', color: colors.accent2 }}>{item.from} </Text>
                  {item.text}
                </Text>
              )}
            />
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={sendChat}
                placeholder="Say something nice…"
                placeholderTextColor="#ffffff88"
                returnKeyType="send"
                maxLength={200}
                style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: '#00000088', color: '#fff', paddingHorizontal: 16 }}
              />
              {!isHost && (
                <Pressable onPress={() => setGiftsOpen(true)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 22 }}>🎁</Text>
                </Pressable>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {!isHost && (
        <GiftSheet
          visible={giftsOpen}
          streamId={join.stream.id}
          coins={coins}
          onClose={() => setGiftsOpen(false)}
          onSent={setCoins}
          onNeedCoins={() => {
            setGiftsOpen(false);
            router.push('/wallet');
          }}
        />
      )}
    </View>
  );
}
