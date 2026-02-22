# AGENTS.md

## 0) Tujuan Utama

Repo ini adalah ekstensi Chrome berbasis Plasmo (Manifest V3) bernama **Powermaxx** untuk automation + scraping marketplace, lalu sinkronisasi data ke API Powermaxx.

Target agent:
- Menjaga arsitektur modular (background/content/UI/shared)
- Meminimalkan breaking changes
- Menjaga kompatibilitas kontrak bridge legacy (`powermaxx` -> `powermaxx_extension`)

## 1) Konteks Cepat

Stack utama:
- Plasmo `0.90.5`
- React `18`
- TypeScript `5`
- Chrome Extension Manifest V3

Peran MV3:
- `background.ts`: orkestrasi, tab control, run worker, messaging
- `contents/*.ts`: akses DOM/fetch kontekstual marketplace
- `popup.tsx` / `options.tsx`: kontrol dan pengaturan

## 2) Cara Menjalankan dan Verifikasi

Perintah utama:
1. `npm run dev`
2. `npm run build`
3. `npm run package`

Verifikasi minimal:
1. Build sukses tanpa error TypeScript.
2. Load unpacked dari `build/chrome-mv3-dev`.
3. Popup bisa trigger `Fetch + Send`.
4. Bridge mode (`single/bulk/worker`) mengirim response envelope kompatibel.

## 3) Aturan README.md

README wajib akurat untuk:
- requirement
- setup
- run/build
- permission model
- alur penggunaan popup/options/bridge

Jika ada perubahan command, flow, atau konfigurasi endpoint, README wajib diupdate pada commit yang sama.

## 4) Aturan Dependency dan Versi

- Jangan tambah dependency besar tanpa alasan jelas.
- Gunakan API bawaan Chrome + Plasmo semaksimal mungkin.
- Jika perlu package baru, pastikan kompatibel dengan stack saat ini.

## 5) Aturan Kerja

- Kerjakan iteratif, aman, dan mudah dites.
- Perubahan kecil dan siap commit.
- Hindari refactor besar tanpa kebutuhan langsung.
- Jika ada trade-off penting, jelaskan risiko dan dampaknya.

## 6) Standar Penulisan Code

- Ikuti style repo (Prettier).
- TypeScript-first untuk kontrak messaging/settings.
- Logging harus terstruktur: `feature/domain/step`.
- Error message harus actionable.
- Setiap modul penting menyertakan rujukan dokumentasi resmi (Chrome MV3 / Plasmo).

## 7) Ikut Beresin Dampaknya

Setiap perubahan wajib cek dampak ke:
- kontrak runtime messaging
- permission flow
- endpoint settings
- README dan docs internal

## 8) Definition of Done

Task selesai jika:
1. Requirement terpenuhi.
2. `npm run build` sukses.
3. Alur popup + bridge utama berjalan.
4. Dokumentasi ter-update.

## 9) Format Jawaban Saat Selesai

Ringkasan
1. Poin perubahan utama.

Cara cek
1. Langkah verifikasi yang bisa dijalankan.

Next step
1. Saran langkah lanjut.

Aturan:
1. Label wajib: `Ringkasan`, `Cara cek`, `Next step`.
2. Item pakai angka.
3. Pertanyaan konfirmasi (jika ada) diletakkan paling akhir, di luar section.

## 10) Keputusan yang Sudah Dikunci

Semua keputusan final dicatat di `docs/agents-decisions.md` dengan format tanggal + dampak.

## 11) Catatan Perilaku Sistem

Catatan behavior berjalan disimpan di `docs/agents-system-notes.md`.

