import { Platform, StyleSheet, View, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/themed-text';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header Section */}
        <View style={styles.header}>
          <ThemedText type="title" style={styles.greeting}>Good Morning, User ✨</ThemedText>
          <ThemedText style={styles.subtitle}>Welcome to your new Aiventra experience.</ThemedText>
        </View>

        {/* Hero Card */}
        <View style={styles.heroCard}>
          <View style={styles.heroContent}>
            <ThemedText type="subtitle" style={styles.heroTitle}>Premium Insights</ThemedText>
            <ThemedText style={styles.heroText}>
              Your personalized data is ready. Discover what matters most.
            </ThemedText>
            <View style={styles.button}>
              <ThemedText style={styles.buttonText}>Explore Now</ThemedText>
            </View>
          </View>
          <Image
            source={require('@/assets/images/react-logo.png')}
            style={styles.heroImage}
            contentFit="contain"
          />
        </View>

        {/* Quick Actions List */}
        <ThemedText type="subtitle" style={styles.sectionTitle}>Quick Actions</ThemedText>
        <View style={styles.actionsGrid}>
          {['Analytics', 'Reports', 'Settings', 'Profile'].map((action, i) => (
            <View key={i} style={styles.actionCard}>
              <View style={[styles.iconPlaceholder, { backgroundColor: `hsla(${i * 60 + 200}, 70%, 50%, 0.2)` }]} />
              <ThemedText style={styles.actionText}>{action}</ThemedText>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A', // Deep dark theme background
  },
  scrollContent: {
    padding: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 100,
  },
  header: {
    marginBottom: 32,
    marginTop: 10,
  },
  greeting: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    color: '#A0A0A0',
    fontSize: 16,
    letterSpacing: 0.2,
  },
  heroCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 24,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 36,
    borderWidth: 1,
    borderColor: '#333333',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
    overflow: 'hidden',
  },
  heroContent: {
    flex: 1,
    paddingRight: 16,
    zIndex: 2,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    marginBottom: 8,
    fontWeight: '700',
  },
  heroText: {
    color: '#A0A0A0',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 30,
    alignSelf: 'flex-start',
  },
  buttonText: {
    color: '#000000',
    fontWeight: '700',
    fontSize: 14,
  },
  heroImage: {
    width: 100,
    height: 100,
    opacity: 0.1,
    position: 'absolute',
    right: -20,
    bottom: -20,
    transform: [{ scale: 1.5 }],
    zIndex: 1,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    marginBottom: 16,
    fontWeight: '700',
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  actionCard: {
    width: '47%',
    backgroundColor: '#141414',
    padding: 20,
    borderRadius: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#222222',
  },
  iconPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: 12,
  },
  actionText: {
    color: '#E0E0E0',
    fontSize: 15,
    fontWeight: '600',
  },
});
