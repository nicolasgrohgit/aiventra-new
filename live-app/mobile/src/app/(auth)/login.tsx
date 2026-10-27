import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, styles } from '@/components/ui';
import { useSession } from '@/lib/session';
import { APP_NAME, colors } from '@/lib/theme';

export default function Login() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim(), password);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
        <Text style={[styles.h1, { fontSize: 40, color: colors.accent }]}>{APP_NAME}</Text>
        <Text style={styles.muted}>Go live in a tap. Sing, chat, vibe — 24/7.</Text>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Button title="Log in" onPress={submit} busy={busy} />
        <View style={{ alignItems: 'center' }}>
          <Link href="/signup" style={[styles.body, { color: colors.accent2 }]}>New here? Create an account</Link>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
