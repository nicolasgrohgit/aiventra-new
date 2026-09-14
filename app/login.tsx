import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { useAuth } from '@/hooks/useAuth';

// Only truthy in a build that actually has this configured (see .env.example's
// EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) — lets the button disappear cleanly in any environment
// that hasn't set it up, rather than being present but broken.
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export default function LoginScreen() {
  const { login, loginWithGoogle } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);

  useEffect(() => {
    if (GOOGLE_WEB_CLIENT_ID) {
      GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    }
  }, []);

  // Added alongside the email-only flow below, not replacing it (see server.ts's
  // POST /api/auth/google comment) — each tester still needs their own distinct account
  // either way, this is just a second way to get one.
  const handleGoogleSignIn = async () => {
    setIsGoogleSigningIn(true);
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) return; // user cancelled — not an error, nothing to show
      const idToken = response.data.idToken;
      if (!idToken) throw new Error('Google did not return an ID token');
      await loginWithGoogle(idToken);
    } catch (err: any) {
      // A cancel/dismiss (user closing the account picker) isn't a real error — the same
      // "just let them try again" treatment as the isSuccessResponse check above.
      if (isErrorWithCode(err) && (err.code === statusCodes.SIGN_IN_CANCELLED || err.code === statusCodes.IN_PROGRESS)) {
        return;
      }
      Alert.alert('Google sign-in failed', err.message || 'Please try again.');
    } finally {
      setIsGoogleSigningIn(false);
    }
  };

  // No real OAuth yet for this path (deliberately deferred for the trusted-beta phase) — but
  // each tester needs their own distinct account, not the one hardcoded mock user every
  // install used to share, so this collects just enough to tell people apart via the existing
  // POST /api/auth/login flow.
  const handleLogin = () => {
    if (!name.trim() || !email.trim()) return;
    login({ name: name.trim(), email: email.trim().toLowerCase() });
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>Odys.ai</Text>
      <Text style={styles.subtitle}>Your Context-Aware Travel Companion</Text>

      {GOOGLE_WEB_CLIENT_ID && (
        <>
          <TouchableOpacity
            style={[styles.googleButton, isGoogleSigningIn && styles.buttonDisabled]}
            onPress={handleGoogleSignIn}
            disabled={isGoogleSigningIn}
          >
            {isGoogleSigningIn ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.dividerText}>or</Text>
        </>
      )}

      <TextInput
        style={styles.input}
        placeholder="Your name"
        placeholderTextColor="#94a3b8"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
      />
      <TextInput
        style={styles.input}
        placeholder="Your email"
        placeholderTextColor="#94a3b8"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TouchableOpacity
        style={[styles.button, (!name.trim() || !email.trim()) && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={!name.trim() || !email.trim()}
      >
        <Text style={styles.buttonText}>Continue</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f8fafc',
  },
  title: {
    fontSize: 46,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#2563eb',
  },
  subtitle: {
    fontSize: 16,
    color: '#64748b',
    marginBottom: 40,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#0f172a',
    marginBottom: 14,
  },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  googleButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  googleButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '600',
  },
  dividerText: {
    color: '#94a3b8',
    fontSize: 14,
    marginVertical: 16,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
