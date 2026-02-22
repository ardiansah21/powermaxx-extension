# Keputusan yang Sudah Dikunci

- [2026-02-22] Target implementasi dikunci ke repo Plasmo `/Users/ardiansah/Coding/Extension Chrome/powermaxx-extension` — menjaga workflow `npm` + `plasmo dev`.
- [2026-02-22] Nama produk extension: `Powermaxx` — menyelaraskan branding platform general automation + scraping.
- [2026-02-22] Pilot migration: `Popup Fetch+Send` dengan cakupan Shopee + TikTok dan send ke endpoint real.
- [2026-02-22] Bridge compatibility tetap penuh untuk mode `single`, `bulk`, dan `worker`.
- [2026-02-22] Penyimpanan auth memakai `chrome.storage.local`.
- [2026-02-22] Model host permission: specific marketplace + optional host runtime.
- [2026-02-22] Strategi scraping: hybrid (content script utama, fallback `chrome.scripting.executeScript`).
- [2026-02-22] Bulk bridge dijalankan headless di background (tanpa membuka tab bulk UI).
- [2026-02-23] Hardening worker parity: report `run_order` memakai dedupe key per `run_id:run_order_id` + retry terbatas untuk error transient (status 0/408/429).
- [2026-02-23] Bulk headless diberi overlap guard per sumber trigger (`tab-{id}` / `global`) agar run ganda dari sumber yang sama tidak berjalan paralel.
- [2026-02-23] Bridge coexistence guard aktif: saat extension legacy masih merespons event `powermaxx`, bridge Plasmo menahan eksekusi lokal agar mengurangi risiko proses ganda pada browser yang memasang extension lama + baru bersamaan.
- [2026-02-23] Error taxonomy untuk mode `single`/`bulk`/`worker` diseragamkan lewat modul shared `src/core/errors/automation-error.ts` agar status, kode error, dan action hint konsisten.
- [2026-02-22] Parity AWB dimulai di extension baru: popup mendukung `Fetch + Send + AWB` serta `Download AWB`, dan konfigurasi endpoint AWB Shopee/TikTok dipusatkan di `options.tsx` + `powermaxxSettings`.
- [2026-02-22] Ditambahkan tab `Bulk Operator` dan `Viewer` sebagai UI internal extension baru agar eksekusi batch + inspeksi payload tidak lagi bergantung pada halaman legacy.
- [2026-02-22] Bulk headless memakai fallback auto-marketplace berbasis default settings (`shopee` -> `tiktok_shop` atau sebaliknya) untuk order yang dikirim tanpa marketplace eksplisit.
- [2026-02-22] Viewer extension baru dipertahankan sederhana (ringkasan + raw JSON), tanpa tabel sheet tambahan, agar UX tetap ringan dan tidak padat.
- [2026-02-22] UI popup disederhanakan ke pola aksi utama + aksi lanjutan (collapsible), dan halaman options dipecah per section collapsible agar tetap familiar seperti flow lama namun lebih rapi.
- [2026-02-23] Untuk menjaga parity flow popup legacy, aksi dipisah kembali: `Ambil Data` (fetch-only ke viewer) dan `Kirim Data` (export payload viewer terakhir) tetap tersedia di `Aksi Lanjutan`.
