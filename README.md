# Hue

Hue mobile app, built with [Expo](https://expo.dev) (SDK 56) and Expo Router.

## Development

```bash
pnpm install
pnpm expo run:android   # local dev build (SDK 56 cannot run in Expo Go)
```

## Build a standalone release APK

```bash
npx expo prebuild -p android
cd android && ./gradlew assembleRelease --no-daemon
# output: android/app/build/outputs/apk/release/app-release.apk
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

> The release APK is signed with the debug keystore (Expo default). Generate a
> dedicated release keystore before distributing on the Play Store.
