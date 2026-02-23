# Legacy Parity Cutover Checklist

Dokumen ini dipakai untuk memastikan extension baru (`Powermaxx`, Plasmo MV3) bisa menggantikan extension lama (`Powermaxx Order Scraper`) tanpa kehilangan behavior penting.

## Referensi Resmi

- Chrome MV3 service worker lifecycle: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
- Chrome content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome message passing: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- Chrome scripting API: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome permissions: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- Plasmo entry files: https://docs.plasmo.com/framework/entry-files
- Plasmo background service worker: https://docs.plasmo.com/framework/background-service-worker
- Plasmo content scripts: https://docs.plasmo.com/framework/content-scripts

## Matrix Parity

| Area | Legacy | Powermaxx Baru | Status |
| --- | --- | --- | --- |
| Login | Email/password + simpan sesi | Email/password + simpan sesi (`chrome.storage.local`) | Done |
| Logout | Ada | Ada | Done |
| Fetch only | `Ambil Data` (tanpa kirim) | Dipindah ke auto-fetch Viewer (`POWERMAXX_POPUP_FETCH_ONLY`) saat payload kosong | Done |
| Send only | `Kirim Data` dari cache payload | Tetap tersedia di runtime internal (`POWERMAXX_POPUP_SEND_VIEWER`), tidak ditampilkan di popup | Done |
| Fetch + Send | Ada | Ada | Done |
| Fetch + Send + AWB | Ada | Ada | Done |
| Download AWB | Shopee + TikTok | Shopee + TikTok | Done |
| Update Order | Ada | Digabung ke `Fetch + Send` pada popup baru | Done |
| Update Income | Ada | Digabung ke `Fetch + Send` pada popup baru | Done |
| Viewer | Halaman viewer detail | Viewer ringkas (summary + raw JSON) | Done (simplified by decision) |
| Bulk | Bulk page + run batch | Bulk Operator + headless background executor | Done |
| Worker mode | claim/heartbeat/report/complete | claim/heartbeat/report/complete + dedupe report | Done |
| Bridge web contract | `powermaxx` -> `powermaxx_extension` | Kontrak kompatibel + coexistence guard | Done |
| Host permission flow | optional host request | optional host request + bridge register | Done |
| Error taxonomy | campuran | diseragamkan (`automation-error`) | Done |

## Perbedaan yang Disengaja (Bukan Bug)

1. Viewer disederhanakan menjadi ringkasan + JSON (sheet tabel dihapus sesuai keputusan UX).
2. UI popup diringkas ke `Aksi Utama` saja, dan `Viewer` + `Bulk Operator` + `Pengaturan` + `Logout` digabung ke satu group menu header tanpa info sesi tambahan.
3. Bulk dijalankan headless di background, bukan membuka legacy bulk runner page.
4. Menu akun hanya muncul saat login; aksi `Ganti Akun` tidak dipakai.

## Cutover Gate (Wajib Lulus)

1. `npm run verify` pass.
2. Popup flow pass:
1. Login.
2. `Fetch + Send`.
3. `Fetch + Send + AWB`.
4. `Download AWB`.
3. Viewer menampilkan payload terbaru setelah `Fetch + Send`, atau auto-fetch saat payload kosong.
4. Bulk Operator menampilkan progress event (`run_started` -> `run_finished`).
5. Bridge mode pass untuk `single`, `bulk`, `worker` dengan envelope legacy.
6. Backend menerima payload extension lama + baru (kompatibilitas API sudah diverifikasi tim backend).

## Catatan UAT Produksi

1. Uji Shopee dan TikTok dengan akun seller yang benar-benar aktif.
2. Uji skenario token expired (`401/403/419`) dan pastikan sesi lokal dibersihkan.
3. Uji dua extension terpasang bersamaan (legacy + baru) untuk memastikan coexistence guard menahan duplicate run.

## Hasil UAT Terakhir (2026-02-23)

1. `npm run verify` pass.
2. Popup flow pass di seller aktif:
   - Tokopedia/TikTok Shop: `Fetch + Send`, `Fetch + Send + AWB`, `Download AWB`.
   - Shopee: `Fetch + Send`, `Fetch + Send + AWB`, `Download AWB`.
3. Bridge mode:
   - `single`: pass (`run_id` `10111294-920a-4b05-aa15-5a83e0f9922f`, `5e6a3990-755e-46b6-92e2-e97dc83c7eea`, `9eb731c2-a971-49a7-bf83-49934c5893cb`), semuanya `completed 1/1`.
   - `bulk`/`worker`: masih ada blocker pada:
     - `a95050a7-5d3a-4b8d-911f-b1f6579fd206` yang bertahan `running 23/25` dengan 2 order TikTok berstatus `processing 2/3` (`error_code: UNKNOWN`, `Fetch marketplace gagal`).
     - `dcc7935b-bf1e-4702-b6f2-cf9643fd1fbe` yang bertahan `running 18/25` walau sudah ada `timed_out 2`; masih ada 7 order non-terminal (`claimed/processing` di `3/3`) dengan `lease_timeout`/`STALE_PROCESSING`.
4. Session guard pass:
   - Setelah `Logout`, request popup ditolak dengan error terstruktur.
   - Setelah login ulang email/password, flow kembali sukses.
5. Aksi lanjut sebelum cutover penuh:
   - Hardening backend untuk memaksa terminalisasi order non-terminal yang sudah mencapai max attempt (`claimed/processing` di `3/3`) lalu auto-finalize run.
   - Jalankan ulang UAT bulk mixed marketplace (>10 order) sampai `run_finished` konsisten tanpa intervensi manual.
