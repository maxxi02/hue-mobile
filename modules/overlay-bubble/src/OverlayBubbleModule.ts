import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

// JS surface for the Android chat-head overlay (a floating bubble drawn over other apps).
// The native module exists only on Android; on every other platform `native` is null and
// each call is a safe no-op, so callers don't need their own platform guards. Tapping the
// bubble opens the app at huemobile:// (handled natively via a deep link), so there's no JS
// event to subscribe to — expo-router routes the link to the home screen, which is voice mode.

interface OverlayBubbleNativeModule {
  /** Whether the user has granted the "draw over other apps" (SYSTEM_ALERT_WINDOW) right. */
  hasOverlayPermission: () => boolean
  /** Open the system overlay-permission screen; resolves to the granted state on return. */
  requestOverlayPermission: () => Promise<boolean>
  /** Start the foreground service and show the floating bubble. */
  show: () => Promise<void>
  /** Hide the bubble and stop the foreground service. */
  hide: () => Promise<void>
}

const native = requireOptionalNativeModule<OverlayBubbleNativeModule>('OverlayBubble')

/** True only where the native bubble is available (a release/dev build on Android). */
export const isOverlayBubbleSupported = Platform.OS === 'android' && native != null

export function hasOverlayPermission(): boolean {
  return native?.hasOverlayPermission() ?? false
}

export async function requestOverlayPermission(): Promise<boolean> {
  return (await native?.requestOverlayPermission()) ?? false
}

export async function showBubble(): Promise<void> {
  await native?.show()
}

export async function hideBubble(): Promise<void> {
  await native?.hide()
}
