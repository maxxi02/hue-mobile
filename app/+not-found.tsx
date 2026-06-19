import { Link, Stack } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import { space, type, useTheme } from '@/constants/theme'

export default function NotFoundScreen() {
  const t = useTheme()
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View style={[styles.container, { backgroundColor: t.colors.bg }]}>
        <Text style={[styles.title, { color: t.colors.ink }]}>This screen doesn’t exist.</Text>
        <Text style={[styles.body, { color: t.colors.inkMuted }]}>
          The page you were looking for isn’t here.
        </Text>
        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: t.colors.accent }]}>Go to the Session screen</Text>
        </Link>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.sm,
  },
  title: { ...type.title },
  body: { ...type.body, textAlign: 'center' },
  link: { marginTop: space.md, paddingVertical: space.md },
  linkText: { ...type.label },
})
