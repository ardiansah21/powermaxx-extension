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
