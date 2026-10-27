import { Tabs } from 'expo-router/js-tabs';
import { Text } from 'react-native';
import { colors } from '@/lib/theme';

const icon = (glyph: string) => () => <Text style={{ fontSize: 20 }}>{glyph}</Text>;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Live', tabBarIcon: icon('🔥') }} />
      <Tabs.Screen name="golive" options={{ title: 'Go Live', tabBarIcon: icon('🎥') }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet', tabBarIcon: icon('💰') }} />
      <Tabs.Screen name="me" options={{ title: 'Me', tabBarIcon: icon('🙂') }} />
    </Tabs>
  );
}
