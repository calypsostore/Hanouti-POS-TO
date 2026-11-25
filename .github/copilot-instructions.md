# Copilot instructions

## Android APK download link

When the user requests an Android APK release, use two separate pushes:

1. Push the requested app/version changes and publish the APK release.
2. Wait until the GitHub release is published, then fetch its APK asset's actual
   `browser_download_url`. Update `LATEST_APK_URL` in
   `src/screens/LoginScreen.tsx` to that verified URL. It is used only by the
   footer `admin_panel_settings` download icon. The top-right `apk1` logo is
   an interactive joke trigger, but must never navigate to or download the APK.
   Validate the change, then commit and push it separately as the second push.

Do not guess the version or asset URL. Do not consider the release task complete
until the second push succeeds and the footer download icon points to the
verified APK. Never publish or push a release unless the user asks.
