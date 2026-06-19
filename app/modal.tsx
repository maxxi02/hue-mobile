import { StatusBar } from 'expo-status-bar'
import { Platform, StyleSheet, Text, View } from 'react-native'

import { radius, space, type, useTheme } from '@/constants/theme'

export default function AboutScreen() {
  const t = useTheme()
  return (
    <View style={[styles.container, { backgroundColor: t.colors.bg }]}>
      <Text style={[styles.title, { color: t.colors.ink }]}>Hue</Text>
      <Text style={[styles.body, { color: t.colors.inkMuted }]}>
        A real-time interview companion. Bring your own API key — everything runs on your device,
        and your keys are stored in the Android Keystore, never on a server.
      </Text>
      <View style={[styles.note, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Text style={[styles.noteText, { color: t.colors.inkMuted }]}>
          The orb’s color tells you what Hue is doing — listening, thinking, or answering.
        </Text>
      </View>

      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: space.xl, gap: space.lg },
  title: { ...type.display },
  body: { ...type.bodyLg },
  note: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg },
  noteText: { ...type.body },
})
