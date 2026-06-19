package expo.modules.overlaybubble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import kotlin.math.abs

// The floating chat-head itself. A foreground service so it survives while the user is in
// another app (Zoom/Meet); it draws a small circular view through the WindowManager as a
// system overlay. Drag it anywhere; a tap (as opposed to a drag) opens Hue at
// huemobile://, bringing the app forward into voice mode (the home screen).

class BubbleOverlayService : Service() {
  private lateinit var windowManager: WindowManager
  private var bubble: View? = null
  private val params by lazy { buildLayoutParams() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    addBubble()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startAsForeground()
    return START_STICKY
  }

  override fun onDestroy() {
    super.onDestroy()
    bubble?.let {
      runCatching { windowManager.removeView(it) }
      bubble = null
    }
  }

  // --- Bubble view ---

  private fun addBubble() {
    if (bubble != null) return
    val size = dp(56)
    val view = View(this).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#8FA0FF")) // the orb's periwinkle accent
        setStroke(dp(2), Color.parseColor("#33000000"))
      }
      elevation = dp(6).toFloat()
    }
    attachTouchHandler(view)
    windowManager.addView(view, params.apply {
      width = size
      height = size
      x = dp(12)
      y = dp(120)
    })
    bubble = view
  }

  private fun attachTouchHandler(view: View) {
    var initialX = 0
    var initialY = 0
    var downRawX = 0f
    var downRawY = 0f
    var dragged = false
    val touchSlop = dp(8)

    view.setOnTouchListener { _, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          initialX = params.x
          initialY = params.y
          downRawX = event.rawX
          downRawY = event.rawY
          dragged = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = (event.rawX - downRawX).toInt()
          val dy = (event.rawY - downRawY).toInt()
          if (abs(dx) > touchSlop || abs(dy) > touchSlop) dragged = true
          params.x = initialX + dx
          params.y = initialY + dy
          runCatching { windowManager.updateViewLayout(view, params) }
          true
        }
        MotionEvent.ACTION_UP -> {
          if (!dragged) openVoiceMode()
          true
        }
        else -> false
      }
    }
  }

  private fun openVoiceMode() {
    // The home screen is the voice feature, so the bubble just brings the app to its root.
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("huemobile://")).apply {
      setPackage(packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    runCatching { startActivity(intent) }
  }

  private fun buildLayoutParams(): WindowManager.LayoutParams {
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
    return WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.START }
  }

  // --- Foreground notification ---

  private fun startAsForeground() {
    val channelId = "hue_overlay_bubble"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      if (manager.getNotificationChannel(channelId) == null) {
        manager.createNotificationChannel(
          NotificationChannel(channelId, "Floating bubble", NotificationManager.IMPORTANCE_LOW),
        )
      }
    }
    val notification: Notification = notificationBuilder(channelId)
      .setContentTitle("Hue")
      .setContentText("Floating bubble active")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  @Suppress("DEPRECATION")
  private fun notificationBuilder(channelId: String): Notification.Builder {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, channelId)
    } else {
      Notification.Builder(this)
    }
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  companion object {
    private const val NOTIFICATION_ID = 4711
  }
}
