import { Platform, ViewStyle } from 'react-native';

// Was byte-for-byte duplicated as `darkActionSheet` in app/(tabs)/trips.tsx and `actionSheet`
// in app/(tabs)/social.tsx, each file's own comment pointing at the other instead of
// extracting it. See CHANGELOG.md's cleanliness-audit entry.
//
// maxHeight caps this bottom sheet so a longer list of options can't grow it past the point
// where its content (or a trailing Cancel button, on a shorter screen) gets pushed off-screen.
// paddingTop (36, vs. the 24 every other side uses) and the 82% maxHeight cap both push this
// sheet's top content further from the status bar — reported too close to the top on a real
// device even with an earlier height cap and ScrollView in place.
export const darkActionSheetStyle: ViewStyle = {
  backgroundColor: '#0F172A',
  borderTopLeftRadius: 32,
  borderTopRightRadius: 32,
  paddingHorizontal: 24,
  paddingTop: 36,
  paddingBottom: Platform.OS === 'ios' ? 48 : 24,
  borderWidth: 1,
  borderColor: '#1E293B',
  maxHeight: '82%',
};
