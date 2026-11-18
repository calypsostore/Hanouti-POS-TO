# 7anouti-POS

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```sh
npm install
npm run dev
```

The local mock accounts are:

| Role | Username / email | Initial password |
| --- | --- | --- |
| Staff | `cafe12.sarah` | `1234` |
| Owner | `owner@cafelamarsa.tn` | `owner123` |
| Super admin | `admin@7anouti.tn` | `admin123` |

These mock accounts are seeded in the browser's local storage. All three are
configured to require a password change at their first login.

## Build and preview

```sh
npm run typecheck
npm run lint
npm run build
npm run preview
```

## Deploy to Vercel

Import the Git repository into Vercel and deploy the Vite project with the
default build command `npm run build` and output directory `dist`. Pushes to the
connected production branch trigger a web deployment. Set `VITE_CAP_SERVER_URL`
to the deployed HTTPS Vercel URL only when an Android app should load the hosted
web build.

## Android / Capacitor

Set `CAP_SERVER_URL` or `VITE_CAP_SERVER_URL` to the HTTPS deployment URL when
you want the Android wrapper to load hosted content. Leave it unset to package
the locally built `dist` files.

```sh
npm run build
npm run cap:add
npm run cap:sync
npm run cap:open
```

`npm run cap:add` generates the native `android` project. Review that generated
project in source control before committing it; do not generate or commit it
blindly. Run `cap:sync` after changing the web build or native plugins. In
Android Studio, select the desired build variant and use **Build > Build
Bundle(s) / APK(s) > Build APK(s)**, then use the generated APK from
`android/app/build/outputs/apk/`.

## When a new APK is needed

- A normal Git push updates the hosted web app. If the installed Capacitor app
  uses `CAP_SERVER_URL` / `VITE_CAP_SERVER_URL`, it receives the deployed web
  changes without rebuilding or redistributing the APK.
- Rebuild and distribute an APK when native Android code, Capacitor/native
  plugin configuration, permissions, app identity, or other bundled native
  resources change.
- If the app packages local `dist` assets instead of loading the hosted URL,
  rebuild the APK to ship web changes as well.
