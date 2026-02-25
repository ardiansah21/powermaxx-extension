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
- `src/popup.tsx`: login (`email + password`) dan kontrol cepat berbasis `Aksi Utama`, dengan satu group menu header untuk `Viewer`, `Bulk Operator`, `Pengaturan`, dan `Logout`, plus indikator status bridge minimalis (`ACTIVE/INACTIVE`) di bawah `Base URL` yang disimpan di cache.
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
5. Klik `Refresh Status` untuk check bridge manual, lalu pastikan indikator di popup menunjukkan `ACTIVE` (jika `INACTIVE`, klik `Perbaiki Bridge`).
6. Di popup klik `Fetch + Send`.
7. Uji `Fetch + Send + AWB` dan `Download AWB`.
8. Klik icon `Viewer` di header popup, pastikan saat payload kosong viewer melakukan auto-fetch dari tab marketplace aktif.
9. Klik icon `Bulk Operator` di header popup, kirim batch kecil, lalu pastikan progress event `batch.started` sampai `batch.finished` muncul.
10. Di Viewer pastikan payload terakhir bisa dilihat/copy/download.
11. Verifikasi response status dan event bridge untuk mode web integration.
12. Untuk worker mode, verifikasi log observability berikut muncul saat run berjalan:

- `worker.loop.start`
- `worker.claim.empty`
- `worker.poll.retry`
- `worker.loop.stop` (dengan `stop_reason`)

## Regression Guard

1. Jalankan static guard kontrak bridge:
   - `npm run check:bridge-regression`
2. Lanjutkan dengan build check:
   - `npx tsc --noEmit`
   - `npm run build`
3. Lihat checklist browser E2E di:
   - `docs/bridge-regression-checklist.md`
   - `docs/legacy-parity-cutover-checklist.md`
4. Jalankan verifikasi agregat sekali perintah:
   - `npm run verify`

## Worker Loop Durability

- Worker mode tidak berhenti hanya karena `claim-next` kosong selama run belum terminal.
- Empty claim diperlakukan sebagai idle state dan dipoll ulang dengan backoff 2-5 detik (capped).
- Error transient polling (`429`, `5xx`, timeout/network) tidak menghentikan run; extension retry dengan exponential backoff + jitter.
- Context batch aktif disimpan di `chrome.storage.local` (`batch_id`, `worker_id`, `last_poll`, `last_error`, `stop_reason`) agar service worker bisa auto-resume saat startup/reload.

## Troubleshooting

- Jika muncul `Sesi login belum tersedia`: login dulu dari Popup (email + password).
- Jika `Tab marketplace tidak ditemukan`: fokus ke tab seller aktif.
- Jika `Bridge belum aktif`: grant optional host permission dan register bridge origin.
- Jika status popup `Bridge: INACTIVE`: klik `Perbaiki Bridge`, lalu pastikan tab Powermaxx terbuka dan klik ulang.
- Jika export gagal fetch: cek base URL API, HTTPS, CORS, dan status login.
- Jika AWB gagal: cek endpoint AWB di Options, pastikan tab yang aktif adalah halaman detail order marketplace.
- Jika bulk mode auto gagal: cek `defaultMarketplace` di Options, lalu pastikan order memang tersedia di marketplace fallback.
- Jika viewer menampilkan payload kosong: pastikan ada tab seller marketplace aktif lalu klik `Refresh` di halaman Viewer agar auto-fetch berjalan.
