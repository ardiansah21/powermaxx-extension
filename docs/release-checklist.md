# Release Checklist (Tim)

## 1) Tujuan

Menjaga semua anggota tim memakai build extension yang sama melalui GitHub Release.

## 2) Format Versi Sederhana

- Tag release selalu pakai format `vX.Y.Z` (contoh: `v0.1.0`).
- `PATCH` (`X.Y.Z+1`): bugfix kecil, docs, hardening non-breaking.
- `MINOR` (`X.Y+1.0`): fitur baru kompatibel.
- `MAJOR` (`X+1.0.0`): perubahan berisiko breaking (bridge contract, permission flow, atau UX operator utama).

## 3) Langkah Release

1. Pastikan branch rilis di `main` dan clean:
   - `git status --short --branch`
2. Jalankan quality gate:
   - `npm run verify`
3. Bump versi sesuai jenis perubahan:
   - `npm version patch`
   - atau `npm version minor`
   - atau `npm version major`
4. Generate artifact release:
   - `npm run package`
5. Push commit + tag:
   - `git push origin main --follow-tags`
6. Buat GitHub Release:
   - Buka `https://github.com/<org-or-user>/<repo>/releases/new`
   - Pilih tag terbaru.
   - Judul: `Powermaxx vX.Y.Z`.
   - Upload file `build/powermaxx-extension-vX.Y.Z.zip`.
   - Isi ringkasan perubahan + cara cek singkat.

## 4) Verifikasi Setelah Publish

1. Download asset `powermaxx-extension-vX.Y.Z.zip` dari halaman release.
2. Extract ZIP.
3. Jika extension lama `Powermaxx Order Scraper` masih terpasang, nonaktifkan/hapus dulu.
4. Install di Chrome via `Load unpacked` (folder hasil extract).
5. Jalankan smoke test popup:
   - Login.
   - `Refresh Status` sampai `Bridge: ACTIVE`.
   - `Fetch + Send`.

## 5) Rollback Cepat

1. Pilih release sebelumnya di GitHub.
2. Download asset ZIP release tersebut.
3. Re-install `Load unpacked` dari versi sebelumnya.
4. Catat rollback di channel tim beserta alasan.
