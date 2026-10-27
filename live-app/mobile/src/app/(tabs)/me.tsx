import { Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, styles } from '@/components/ui';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

export default function Me() {
  const { user, signOut, deleteAccount } = useSession();

  const confirmDelete = () =>
    Alert.alert('Delete account?', 'This permanently deletes your account. Unspent coins and diamonds are forfeited.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteAccount().catch((e) => Alert.alert('Error', e.message)) },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: 24, gap: 16 }}>
      <View style={{ alignItems: 'center', gap: 8, paddingVertical: 16 }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 36, fontWeight: '800' }}>{user?.displayName.charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.h2}>{user?.displayName}</Text>
        <Text style={styles.muted}>{user?.email}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.h2}>Community Guidelines</Text>
        <Text style={styles.muted}>
          18+ only · No nudity or sexual content · No harassment or hate · No minors on camera · Never ask viewers to pay outside the app · Report anything that breaks these rules from the ⋯ menu in any stream.
        </Text>
      </View>
      <Button title="Log out" onPress={signOut} variant="ghost" />
      <Button title="Delete account" onPress={confirmDelete} variant="danger" />
    </SafeAreaView>
  );
}
