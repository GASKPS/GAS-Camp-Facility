# Validasi Absensi

Dashboard absensi per Sub Departemen dengan login Supabase. Aplikasi membaca Absensi, Roster, dan Tarikan Live Attendance per NIK dan tanggal. Halaman login menyediakan data contoh untuk mencoba kalender.

## Jalankan dari sumber

Gunakan Node.js 22.12 atau lebih baru.

```sh
npm ci
npm test
npm run dev
```

Salin `.env.example` menjadi `.env.local`, lalu isi Project URL dan Publishable Key Supabase. Untuk produksi, jalankan `npm run build` dengan kedua variabel tersebut di lingkungan build. Sajikan folder `dist` melalui hosting statis. Kunci service role tersedia di lingkungan server Supabase Edge Functions.

## Siapkan proyek Supabase

1. Siapkan akun Administrator yang emailnya sudah dikonfirmasi di **Authentication → Users**.
2. Terapkan semua file SQL di `supabase/migrations/` sesuai urutan nama file.
3. Deploy fungsi **attendance-admin** ke proyek yang sama. `supabase/config.toml` mengatur verifikasi gateway JWT untuk fungsi ini. Fungsi memeriksa JWT melalui Supabase Auth, memeriksa peran Administrator sebelum mengelola akun, dan memeriksa token jadwal sebelum membersihkan arsip. [Panduan autentikasi Edge Functions](https://supabase.com/docs/guides/functions/auth)
4. Jalankan pengaturan berikut di SQL Editor. Ganti Project URL dan email sesuai proyek yang dipakai. Parameter ketiga mengatur pembersihan sekali jalan atas tabel arsip lama dan file di bucket lama `selaras-sumber`. Gunakan `true` untuk proyek yang seluruh arsip sebelumnya merupakan data uji coba.

```sql
select public.attendance_configure(
  'https://PROJECT_REF.supabase.co',
  'administrator@example.com',
  false
);
```

Untuk deploy dengan Supabase CLI yang sudah terhubung ke akun proyek, jalankan `supabase functions deploy attendance-admin --project-ref PROJECT_REF --no-verify-jwt`. Untuk menggunakan dashboard, buka **Edge Functions → Deploy a new function → Via Editor** dan gunakan isi fungsi dari `supabase/functions/attendance-admin/`. [Panduan pemasangan lewat Dashboard](https://supabase.com/docs/guides/functions/quickstart-dashboard)

Pembersihan pertama diminta saat pengaturan selesai, kemudian dijadwalkan setiap hari pukul 00.15 WIT. Arsip mencakup bulan berjalan dan dua bulan sebelumnya. RLS menyembunyikan periode yang kedaluwarsa saat bulan berganti. Fungsi menghapus file lama melalui API Storage dan mencoba kembali file yang masih ada di antrean. [Penjadwalan Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) · [Penghapusan file Storage](https://supabase.com/docs/guides/storage/management/delete-objects)

### Perbarui pemasangan yang sudah berjalan

Jika ruang kerja sudah aktif dari migrasi `202611120001` dan `202611120002`, buka SQL Editor proyek aplikasi dan jalankan seluruh isi `supabase/migrations/202611120003_sub_departments.sql`. Muat ulang web setelah SQL berhasil. Pembaruan ini menyatukan peran Admin, mempertahankan penugasan yang ada, dan mengaktifkan **Jejak perubahan**.

## Akun dan Sub Departemen

- **Administrator** membuat Departemen dan akun, memberi akses, mengaktifkan atau menonaktifkan akun, serta menghapus akun. Administrator dapat membuka kalender dan riwayat seluruh Sub Departemen.
- **Admin** dapat membuat Sub Departemen di bawah Departemennya dan langsung mendapat akses ke Sub Departemen tersebut. Admin dapat mengubah nama dan mengelola absensi di Sub Departemen yang ditugaskan kepadanya.

Riwayat disimpan per Sub Departemen. Akses database dan file memeriksa status aktif serta penugasan. Penghapusan akun mencabut profil akses dan memakai soft delete di Supabase Auth agar file Sub Departemen tersedia bagi Admin yang ditugaskan.

## Gunakan Kalender Hasil

Pilih Sub Departemen dari sidebar. Web membuka bulan terbaru yang mempunyai arsip. Gunakan **Riwayat → Arsip bulanan** untuk membuka periode lain. Tab **Jejak perubahan** mencatat akun, waktu, dan tanggal terkait untuk unggahan, koreksi, serta perubahan status **Sudah dicek**. Riwayat lama diisi dari catatan yang masih tersedia.

Buka **Unggah file**, pilih periode dan rentang tarikan, lalu masukkan dua atau tiga sumber Sub Departemen. Roster bulanan yang tersimpan bisa dipakai pada rentang berikutnya. Kalender menyebutkan file yang diperiksa. Jika sumbernya Roster dan Live Attendance, judulnya **Jadwal Roster**. Unggahan koreksi memperbarui tanggal dalam rentang yang dipilih.

- Kuning untuk satu catatan In atau Out kosong. Ungu untuk dua catatan kosong. Oranye untuk D3 dengan In paling awal lewat 07.01.00. Merah untuk ketidaksesuaian dan peringatan lain. Titik oranye menandai keterlambatan yang bersamaan dengan peringatan lain.
- Klik kartu peringatan untuk menyaring karyawan dan tanggal. **Semua karyawan** membuka kembali seluruh kalender.
- Klik nama karyawan untuk membuka kalender pribadi dan mengatur **Golongan 2 Up**. Roster `D` cocok dengan Absen `D` bagi golongan ini.
- **Kroscek Form Cuti** mengaktifkan perbandingan CR, CT, dan CE berdasarkan kode serta tanggal di Absensi. Pengaturan disimpan di browser untuk akun dan Sub Departemen yang dipilih.
- Klik tanggal merah, centang **Sudah dicek**, lalu konfirmasi untuk menyimpan verifikasi manual. Jika tanggal diperbarui atau hasil pemeriksaannya berubah, peringatan dievaluasi kembali.
- Hitungan OFF menyambung pada tanggal berturut-turut yang memiliki Roster dan Absensi. OFF yang cocok, kode Absen L yang sudah dikonfirmasi lewat **Sudah dicek**, dan rangkaian cuti yang memuat CR memulai siklus baru. Konfirmasi L berlaku untuk data unggahan yang diperiksa. Izin potong CT atau CE 1–6 hari serta hari sakit ikut dalam siklus. COS atau CS menampilkan peringatan cuti on site. Peringatan OFF muncul mulai hari ke-14 dalam siklus. Klik tanggal dan buka rincian **Siklus OFF** untuk melihat posisi dan dasar perhitungannya.

Unduh template dari kartu sumber atau halaman **Form Cuti**. File dapat berupa Excel atau CSV untuk ketiga sumber. Form Cuti menerima template Excel.

## Unggah ke GitHub

Ekstrak ZIP dan unggah isi folder `validasi-absensi` ke repositori GitHub. Gunakan `.env.example` sebagai panduan variabel build. Folder `supabase` berisi SQL dan fungsi server. Folder `public/templates` berisi template Excel.
