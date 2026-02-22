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
| Fetch only | `Ambil Data` (tanpa kirim) | `Ambil Data` di `Aksi Lanjutan` (`POWERMAXX_POPUP_FETCH_ONLY`) | Done |
| Send only | `Kirim Data` dari cache payload | `Kirim Data` di `Aksi Lanjutan` (`POWERMAXX_POPUP_SEND_VIEWER`) | Done |
| Fetch + Send | Ada | Ada | Done |
| Fetch + Send + AWB | Ada | Ada | Done |
| Download AWB | Shopee + TikTok | Shopee + TikTok | Done |
| Update Order | Ada | Ada | Done |
| Update Income | Ada | Ada | Done |
| Viewer | Halaman viewer detail | Viewer ringkas (summary + raw JSON) | Done (simplified by decision) |
| Bulk | Bulk page + run batch | Bulk Operator + headless background executor | Done |
| Worker mode | claim/heartbeat/report/complete | claim/heartbeat/report/complete + dedupe report | Done |
| Bridge web contract | `powermaxx` -> `powermaxx_extension` | Kontrak kompatibel + coexistence guard | Done |
| Host permission flow | optional host request | optional host request + bridge register | Done |
| Error taxonomy | campuran | diseragamkan (`automation-error`) | Done |

## Perbedaan yang Disengaja (Bukan Bug)

1. Viewer disederhanakan menjadi ringkasan + JSON (sheet tabel dihapus sesuai keputusan UX).
2. UI popup diringkas dengan pola `Aksi Utama` + `Aksi Lanjutan` agar tidak padat.
3. Bulk dijalankan headless di background, bukan membuka legacy bulk runner page.
4. Menu akun hanya muncul saat login; aksi `Ganti Akun` tidak dipakai.

## Cutover Gate (Wajib Lulus)

1. `npm run verify` pass.
2. Popup flow pass:
1. Login.
2. `Ambil Data`.
3. `Kirim Data`.
4. `Fetch + Send`.
5. `Fetch + Send + AWB`.
6. `Download AWB`.
3. Viewer menampilkan payload terbaru setelah `Ambil Data` atau `Fetch + Send`.
4. Bulk Operator menampilkan progress event (`run_started` -> `run_finished`).
5. Bridge mode pass untuk `single`, `bulk`, `worker` dengan envelope legacy.
6. Backend menerima payload extension lama + baru (kompatibilitas API sudah diverifikasi tim backend).

## Catatan UAT Produksi

1. Uji Shopee dan TikTok dengan akun seller yang benar-benar aktif.
2. Uji skenario token expired (`401/403/419`) dan pastikan sesi lokal dibersihkan.
3. Uji dua extension terpasang bersamaan (legacy + baru) untuk memastikan coexistence guard menahan duplicate run.
