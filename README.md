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
- `src/contents/marketplace.ts`: runner scraping/fetch/AWB marketplace + bridge listener.
- `src/popup.tsx`: login (`email + password`) dan kontrol cepat berbasis `Aksi Utama` + `Aksi Lanjutan`.
- `src/options.tsx`: pengaturan Base URL API + endpoint marketplace + konfigurasi AWB dengan section collapsible.
- `src/tabs/bulk.tsx`: UI operator bulk headless untuk submit daftar order + monitor progress event worker.
- `src/tabs/viewer.tsx`: viewer payload fetch/send terakhir (ringkasan + raw JSON + copy/download).
- `src/features/awb/*`: flow AWB Shopee/TikTok (content runner + background executor).
- `src/features/viewer/shared/storage.ts`: persistence payload viewer di `chrome.storage.local`.
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
6. Uji `Fetch + Send + AWB` dan `Download AWB`.
7. Dari popup buka `Bulk Operator`, kirim batch kecil, lalu pastikan progress event `run_started` sampai `run_finished` muncul.
8. Dari popup buka `Viewer` dan pastikan payload terakhir bisa dilihat/copy/download.
9. Verifikasi response status dan event bridge untuk mode web integration.

## Regression Guard

1. Jalankan static guard kontrak bridge:
   - `npm run check:bridge-regression`
2. Lanjutkan dengan build check:
   - `npx tsc --noEmit`
   - `npm run build`
3. Lihat checklist browser E2E di:
   - `docs/bridge-regression-checklist.md`
4. Jalankan verifikasi agregat sekali perintah:
   - `npm run verify`

## Troubleshooting

- Jika muncul `Sesi login belum tersedia`: login dulu dari Popup (email + password).
- Jika `Tab marketplace tidak ditemukan`: fokus ke tab seller aktif.
- Jika `Bridge belum aktif`: grant optional host permission dan register bridge origin.
- Jika export gagal fetch: cek base URL API, HTTPS, CORS, dan status login.
- Jika AWB gagal: cek endpoint AWB di Options, pastikan tab yang aktif adalah halaman detail order marketplace.
- Jika bulk mode auto gagal: cek `defaultMarketplace` di Options, lalu pastikan order memang tersedia di marketplace fallback.
