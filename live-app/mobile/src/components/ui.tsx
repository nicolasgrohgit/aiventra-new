import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { colors } from '@/lib/theme';

export function Button({ title, onPress, busy, variant = 'primary' }: {
  title: string; onPress: () => void; busy?: boolean; variant?: 'primary' | 'ghost' | 'danger';
}) {
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      style={({ pressed }) => [styles.button, styles[variant], pressed && { opacity: 0.8 }]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{title}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput placeholderTextColor={colors.muted} {...props} style={[styles.input, props.style]} />
    </View>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 20, gap: 16 },
  button: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primary: { backgroundColor: colors.accent },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: colors.danger },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  label: { color: colors.muted, fontSize: 13 },
  input: {
    height: 48, borderRadius: 12, backgroundColor: colors.card, color: colors.text,
    paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, fontSize: 16,
  },
  h1: { color: colors.text, fontSize: 28, fontWeight: '800' },
  h2: { color: colors.text, fontSize: 20, fontWeight: '700' },
  body: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: colors.border },
});
