# Powermaxx

Powermaxx adalah extension Chrome untuk membantu tim operasional marketplace mengambil data order dari tab seller (Shopee/TikTok), lalu mengirimkannya ke sistem Powermaxx dengan alur yang lebih cepat dan konsisten.

## Fitur Utama

- `Fetch + Send + AWB`: update data sekaligus proses AWB dalam satu aksi dari popup.
- `Fetch + Send`: ambil data order dari marketplace aktif lalu kirim ke API Powermaxx.
- `Download AWB`: unduh AWB dari halaman seller marketplace aktif.
- `Viewer`: melihat payload terakhir (ringkasan + JSON mentah) untuk verifikasi cepat.
- `Bulk Operator`: menjalankan batch worker mode dan memantau progres proses.
- `Pengaturan`: mengatur Base URL API dan endpoint yang dipakai extension.

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

## Release Tim (GitHub)

Artifact yang dibagikan ke tim:

- `build/powermaxx-extension-vX.Y.Z.zip` (contoh: `build/powermaxx-extension-v0.1.0.zip`)

Format versi sederhana:

- `PATCH` (`v0.1.1 -> v0.1.2`): bugfix kecil, docs, atau hardening tanpa ubah flow utama.
- `MINOR` (`v0.1.2 -> v0.2.0`): fitur baru yang tetap kompatibel.
- `MAJOR` (`v0.2.0 -> v1.0.0`): perubahan yang berpotensi breaking (kontrak bridge, flow permission, atau alur operator).

Flow release ringkas:

1. Jalankan quality gate:
   - `npm run verify`
2. Bump versi:
   - `npm version patch` atau `npm version minor` atau `npm version major`
3. Generate artifact:
   - `npm run package`
4. Push branch + tag:
   - `git push origin main --follow-tags`
5. Buat GitHub Release dari tag terbaru, lalu upload `build/powermaxx-extension-vX.Y.Z.zip`.

Lihat detail operasional di `docs/release-checklist.md`.

## Instalasi Tim (Tanpa Coding)

1. Buka halaman GitHub Release versi yang akan dipakai tim (contoh: `v0.1.0`).
2. Download file asset: `powermaxx-extension-vX.Y.Z.zip`.
3. Buat folder baru di komputer, lalu extract isi ZIP ke folder tersebut sampai terlihat file `manifest.json`.
4. Buka Chrome ke `chrome://extensions`.
5. Aktifkan `Developer mode` di pojok kanan atas.
6. Jika extension lama `Powermaxx Order Scraper` masih terpasang, nonaktifkan atau hapus dulu agar tidak bentrok.
7. Klik `Load unpacked` atau `Muat yang belum dibuka`, lalu pilih folder hasil extract yang berisi `manifest.json`.
8. Klik ikon `Extensions` (ikon puzzle) di kanan atas Chrome.
9. Cari `Powermaxx`, lalu klik ikon pin (`Sematkan`) supaya ikon Powermaxx selalu muncul di toolbar.
10. Klik ikon `Powermaxx` di toolbar untuk membuka popup extension.
11. Di popup, klik ikon menu tiga garis di kanan atas, lalu pilih `Pengaturan`.
12. Isi `Base URL API` dengan `https://pmx.arvateams.com`, lalu klik `Simpan`.
13. Setelah klik `Simpan`, jika muncul pop-up izin akses situs, klik `Izinkan`.
14. Kembali ke popup, lalu login menggunakan email dan password akun Powermaxx.
15. Jika status berubah ke `Bridge: INACTIVE`, klik `Perbaiki Bridge`, lalu cek ulang.
16. Pastikan status menjadi `Bridge: ACTIVE`.
17. Jika status sudah `Bridge: ACTIVE`, extension siap dipakai. Uji cepat dengan klik `Fetch + Send`.

## Arsitektur Ringkas

- `src/background.ts`: orchestrator runtime messaging, bulk/worker bridge, tab control.
- `src/contents/marketplace.ts`: runner scraping/fetch/AWB marketplace + bridge listener.
- `src/popup.tsx`: login (`email + password`) dan kontrol cepat berbasis `Aksi Utama` (`Fetch + Send + AWB`, `Fetch + Send`, `Download AWB`), dengan satu group menu header untuk `Viewer`, `Bulk Operator`, dan `Pengaturan`, serta tombol logout via ikon lingkaran inisial user di samping menu; indikator status bridge (`BELUM DICEK/ACTIVE/INACTIVE`) ditampilkan di bawah `Base URL`.
- `src/options.tsx`: pengaturan Base URL API + endpoint marketplace + konfigurasi AWB dengan section collapsible.
- `src/tabs/bulk.tsx`: UI operator bulk headless untuk submit daftar order + monitor progress event worker.
- `src/tabs/viewer.tsx`: viewer payload fetch/send terakhir (ringkasan + raw JSON + copy/download).
- `src/features/awb/*`: flow AWB Shopee/TikTok (content runner + background executor).
- `src/features/viewer/shared/storage.ts`: persistence payload viewer di `chrome.storage.local`.
- `src/core/*`: kontrak tipe, logger, storage settings, helper messaging.

## Definisi Proses Update

- Sumber perintah utama update berasal dari sistem Powermaxx (Laravel) melalui bridge (`powermaxx` -> `powermaxx_extension`).
- Di popup, proses manual dijalankan lewat tombol `Fetch + Send` atau `Fetch + Send + AWB`.
- Extension mengambil data dari marketplace di browser, lalu mengirim hasilnya kembali ke API Powermaxx.

## Permission Model

- `host_permissions` statis: domain marketplace yang dipakai scraping.
- `optional_host_permissions`: domain Powermaxx API diminta saat runtime.

## Testing / Verifikasi Cepat

1. Jalankan `npm run build`.
2. Jalankan `npm run dev`.
3. Buka popup, lalu pastikan `Base URL API` sudah `https://pmx.arvateams.com` (dari menu `Pengaturan`).
4. Login dengan email + password akun Powermaxx.
5. Jika awalnya muncul `Bridge: BELUM DICEK` dan pesan `Bridge belum dicek`, klik `Cek Status Bridge`.
6. Pastikan indikator bridge menunjukkan `ACTIVE` (jika `INACTIVE`, klik `Perbaiki Bridge`).
7. Buka halaman detail order di seller marketplace (Shopee/TikTok).
8. Di popup jalankan proses manual dengan klik `Fetch + Send` atau `Fetch + Send + AWB`.
9. Uji juga `Download AWB` jika diperlukan.
10. Pada alur produksi, proses update dipicu dari sistem Powermaxx (Laravel) dan extension menerima request bridge secara otomatis.
11. Klik icon `Viewer` di header popup, pastikan saat payload kosong viewer melakukan auto-fetch dari tab marketplace aktif.
12. Klik icon `Bulk Operator` di header popup, kirim batch kecil, lalu pastikan progress event `batch.started` sampai `batch.finished` muncul.
13. Di Viewer pastikan payload terakhir bisa dilihat/copy/download.
14. Verifikasi response status dan event bridge untuk mode web integration.
15. Untuk worker mode, verifikasi log observability berikut muncul saat run berjalan:

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
- Gangguan sementara saat polling (server sementara tidak stabil atau timeout/network) tidak menghentikan run; extension retry dengan exponential backoff + jitter.
- Context batch aktif disimpan di `chrome.storage.local` (`batch_id`, `worker_id`, `last_poll`, `last_error`, `stop_reason`) agar service worker bisa auto-resume saat startup/reload.

## Troubleshooting

- Jika muncul `Sesi login belum tersedia`: login dulu dari Popup (email + password).
- Jika `Tab marketplace tidak ditemukan`: fokus ke tab seller aktif.
- Jika `Bridge belum aktif`: grant optional host permission dan register bridge origin.
- Jika awal popup menampilkan `Bridge: BELUM DICEK` + `Bridge belum dicek`: itu normal, klik tombol `Cek Status Bridge`.
- Jika status popup tetap `Bridge: INACTIVE` setelah cek manual: klik `Perbaiki Bridge`, lalu pastikan tab Powermaxx terbuka dan cek ulang.
- Jika export gagal fetch: cek base URL API, HTTPS, CORS, dan status login.
- Jika AWB gagal: cek endpoint AWB di Options, pastikan tab yang aktif adalah halaman detail order marketplace.
- Jika bulk mode auto gagal: cek `defaultMarketplace` di Options, lalu pastikan order memang tersedia di marketplace fallback.
- Jika viewer menampilkan payload kosong: pastikan ada tab seller marketplace aktif lalu klik `Refresh` di halaman Viewer agar auto-fetch berjalan.
