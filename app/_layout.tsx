import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from '@expo-google-fonts/instrument-serif';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { getColors } from '@/constants/theme';
import { SessionProvider } from '@/hooks/useSession';
import { hasOverlayPermission, showBubble } from '@/modules/overlay-bubble';
import { useSettings } from '@/store/settings';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on a pushed screen (settings / modal) keeps a back button present.
  initialRouteName: 'index',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Hue's design voice, ported from hue-web: Instrument Serif (display) + JetBrains
  // Mono (eyebrows). Registered under their @expo-google-fonts export names, which the
  // type tokens in constants/theme.ts reference by string.
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    JetBrainsMono_500Medium,
  });

  // Load persisted settings (incl. API keys) from secure storage before first paint.
  const hydrated = useSettings((s) => s.hydrated);
  const loadSettings = useSettings((s) => s.load);
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded && hydrated) {
      SplashScreen.hideAsync();
    }
  }, [loaded, hydrated]);

  if (!loaded || !hydrated) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme() ?? 'dark';
  const c = getColors(colorScheme);

  // Re-assert the floating bubble on launch if the user left it enabled and the overlay
  // permission still stands (the service doesn't survive a reboot). No-op off Android.
  const bubbleEnabled = useSettings((s) => s.settings.bubbleEnabled);
  useEffect(() => {
    if (bubbleEnabled && hasOverlayPermission()) void showBubble();
  }, [bubbleEnabled]);

  // Extend the stock navigation themes with Hue's tokens so navigation chrome
  // (screen backgrounds, headers, borders) matches the in-screen design system.
  const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: c.bg,
      card: c.bg,
      text: c.ink,
      border: c.border,
      primary: c.accent,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <SessionProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: c.bg },
            headerShadowVisible: false,
            headerTintColor: c.ink,
            headerTitleStyle: { color: c.ink },
            contentStyle: { backgroundColor: c.bg },
          }}>
          {/* Home owns its own top bar (live state + settings shortcut), so no native header. */}
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'About' }} />
        </Stack>
      </SessionProvider>
    </ThemeProvider>
  );
}
