# Powermaxx

Powermaxx adalah Chrome Extension berbasis **Plasmo + Manifest V3** untuk workflow automation dan scraping marketplace (Shopee/TikTok), lalu mengirim data ke API Powermaxx.

## Referensi Resmi

- Chrome Extensions MV3 Service Worker: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
- Chrome Extensions Content Scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome Extensions Message Passing: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- Chrome Extensions `chrome.scripting`: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome Extensions Permissions: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- Plasmo Entry Files: https://docs.plasmo.com/framework/entry-files
- Plasmo Background Service Worker: https://docs.plasmo.com/framework/background-service-worker
- Plasmo Content Scripts: https://docs.plasmo.com/framework/content-scripts
- Plasmo Manifest Customization: https://docs.plasmo.com/framework/customization/manifest

## Requirements

- Node.js 18+ (disarankan)
- npm
- Google Chrome

## Setup

```bash
npm install
```

## Menjalankan Lokal

```bash
npm run dev
```

Load unpacked extension dari folder:
- `build/chrome-mv3-dev`

## Build Production

```bash
npm run build
npm run package
```

## Arsitektur Ringkas

- `src/background.ts`: orchestrator runtime messaging, bulk/worker bridge, tab control.
- `src/contents/marketplace.ts`: runner scraping/fetch marketplace + bridge listener.
- `src/popup.tsx`: login (`email + password`) dan kontrol cepat `Fetch + Send`.
- `src/options.tsx`: pengaturan Base URL API + endpoint marketplace.
- `src/core/*`: kontrak tipe, logger, storage settings, helper messaging.

## Permission Model

- `host_permissions` statis: domain marketplace yang dipakai scraping.
- `optional_host_permissions`: domain Powermaxx API diminta saat runtime.

## Testing / Verifikasi Cepat

1. Jalankan `npm run build`.
2. Jalankan `npm run dev`.
3. Buka popup dan login dengan email + password akun Powermaxx.
4. Buka tab seller Shopee/TikTok (sudah login seller).
5. Di popup klik `Fetch + Send`.
6. Verifikasi response status dan event bridge untuk mode web integration.

## Troubleshooting

- Jika muncul `Sesi login belum tersedia`: login dulu dari Popup (email + password).
- Jika `Tab marketplace tidak ditemukan`: fokus ke tab seller aktif.
- Jika `Bridge belum aktif`: grant optional host permission dan register bridge origin.
- Jika export gagal fetch: cek base URL API, HTTPS, CORS, dan status login.
