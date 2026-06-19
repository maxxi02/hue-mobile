package expo.modules.overlaybubble

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Bridges the floating chat-head overlay to JS. It does three things: report/request the
// "draw over other apps" permission, and start/stop the foreground service that actually
// renders the bubble (see BubbleOverlayService). Tapping the bubble is handled entirely in
// the service via a deep link, so there's no event plumbing here.

class OverlayBubbleModule : Module() {
  // Held while the system overlay-permission screen is open, resolved in OnActivityResult.
  private var pendingPermission: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("OverlayBubble")

    Function("hasOverlayPermission") {
      canDrawOverlays()
    }

    AsyncFunction("requestOverlayPermission") { promise: Promise ->
      if (canDrawOverlays()) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val activity = appContext.activityProvider?.currentActivity
      val context = appContext.reactContext
      if (activity == null || context == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      pendingPermission = promise
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${context.packageName}"),
      )
      activity.startActivityForResult(intent, OVERLAY_PERMISSION_REQUEST)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == OVERLAY_PERMISSION_REQUEST) {
        pendingPermission?.resolve(canDrawOverlays())
        pendingPermission = null
      }
    }

    AsyncFunction("show") { promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      if (!canDrawOverlays()) {
        promise.reject("E_NO_OVERLAY_PERMISSION", "Overlay permission has not been granted.", null)
        return@AsyncFunction
      }
      val intent = Intent(context, BubbleOverlayService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      promise.resolve(null)
    }

    AsyncFunction("hide") { promise: Promise ->
      val context = appContext.reactContext
      context?.stopService(Intent(context, BubbleOverlayService::class.java))
      promise.resolve(null)
    }
  }

  private fun canDrawOverlays(): Boolean {
    val context = appContext.reactContext ?: return false
    return Settings.canDrawOverlays(context)
  }

  companion object {
    private const val OVERLAY_PERMISSION_REQUEST = 7321
  }
}
