import { registerGlobals } from '@livekit/react-native';

// WebRTC globals must exist before any LiveKit code runs.
registerGlobals();

import 'expo-router/entry';
