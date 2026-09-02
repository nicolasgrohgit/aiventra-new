import React, { useState } from 'react';
import { Platform, View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

interface NativeDatePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  mode?: 'date' | 'time';
  format?: 'date' | 'time';
  // Passed straight through to @react-native-community/datetimepicker, which already
  // supports it natively on both platforms — disables/clamps any date before this one in
  // the native picker UI itself, rather than only catching it after the fact at submit time.
  minimumDate?: Date;
}

/**
 * A highly generic, cross-platform Native Date/Time picker explicitly resolving UI boundaries cleanly.
 */
export function NativeDatePicker({ value, onChange, mode = 'date', format = 'date', minimumDate }: NativeDatePickerProps) {
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);

  const displayValue = format === 'time'
    ? value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : value.toDateString();

  return (
    <>
      {Platform.OS === 'android' ? (
        <TouchableOpacity style={styles.button} onPress={() => setShowAndroidPicker(true)}>
          <Text style={styles.buttonText}>{displayValue}</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.iosContainer}>
          <DateTimePicker
            value={value}
            mode={mode}
            display="default"
            themeVariant="dark"
            minimumDate={minimumDate}
            onChange={(e, d) => d && onChange(d)}
          />
        </View>
      )}

      {Platform.OS === 'android' && showAndroidPicker && (
        <DateTimePicker
          value={value}
          mode={mode}
          display="default"
          minimumDate={minimumDate}
          onChange={(e, d) => {
            setShowAndroidPicker(false);
            if (d) onChange(d);
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155', borderRadius: 14, padding: 18, marginBottom: 20 },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  iosContainer: { marginBottom: 20, alignSelf: 'flex-start', backgroundColor: '#1E293B', borderRadius: 14, overflow: 'hidden' }
});
