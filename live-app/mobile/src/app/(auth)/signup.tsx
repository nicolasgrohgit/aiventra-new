import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, styles } from '@/components/ui';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

export default function Signup() {
  const { signUp } = useSession();
  const [form, setForm] = useState({ email: '', password: '', displayName: '', dob: '' });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await signUp({ ...form, email: form.email.trim(), acceptTerms });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>Create account</Text>
        <Text style={styles.muted}>You must be 18 or older.</Text>
        <Field label="Display name" value={form.displayName} onChangeText={set('displayName')} maxLength={30} />
        <Field label="Email" value={form.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" />
        <Field label="Password (8+ characters)" value={form.password} onChangeText={set('password')} secureTextEntry />
        <Field label="Date of birth (YYYY-MM-DD)" value={form.dob} onChangeText={set('dob')} placeholder="1998-04-21" keyboardType="numbers-and-punctuation" maxLength={10} />
        <Pressable onPress={() => setAcceptTerms((v) => !v)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.accent, backgroundColor: acceptTerms ? colors.accent : 'transparent' }} />
          <Text style={[styles.muted, { flex: 1 }]}>
            I am 18+ and agree to the Terms of Service and Community Guidelines (no nudity, harassment, minors, or off-app payment requests).
          </Text>
        </Pressable>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Button title="Sign up" onPress={submit} busy={busy} />
        <View style={{ alignItems: 'center' }}>
          <Link href="/login" style={[styles.body, { color: colors.accent2 }]}>I already have an account</Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
