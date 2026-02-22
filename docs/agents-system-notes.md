# Catatan Perilaku Sistem

- Background service worker tidak mengakses DOM secara langsung; operasi DOM/scraping dilakukan di content context sesuai Chrome MV3.
- Komunikasi antarkonteks memakai message passing (`runtime.sendMessage` / `tabs.sendMessage`).
- Bridge web menggunakan kontrak postMessage legacy:
  - inbound `source: "powermaxx"`
  - outbound `source: "powermaxx_extension"`
- Worker mode menjalankan alur run queue backend: claim -> heartbeat -> report -> complete.
- Bulk mode berjalan serial di background dan melaporkan progress event ke bridge source tab.
- Error logging mengikuti format terstruktur: `feature`, `domain`, `step`, `context`.
- Popup login disederhanakan: saat belum login hanya menampilkan form `Email + Password`; section `Fetch + Send` disembunyikan sampai sesi aktif.
- Menu sesi di popup hanya tersedia saat login dan saat ini hanya memuat aksi `Logout` (fitur `Ganti Akun` dihapus untuk menghindari state UI ganda).
- Worker `run_order report` memakai dedupe key per `run_id:run_order_id` dan disimpan sementara di `chrome.storage.local` untuk mencegah report duplikat saat retry/restart.
- Worker dan bulk menggunakan klasifikasi error dasar (`TIMEOUT`, `PROCESSING_FAILED`, dll) agar event/status lebih konsisten untuk debugging.
- Bridge injeksi menambahkan marker internal `__pmx_bridge_owner` dan `__pmx_request_id` pada outbound event dari extension baru untuk observability.
- Jika ada response bridge eksternal (legacy) yang terdeteksi dalam grace window, handler bridge extension baru membatalkan eksekusi lokal request tersebut untuk menekan duplicate side effects.
