---
name: ux-design
description: Wajib dibaca sebelum coding di marketplace, terutama development frontend, UI, halaman, komponen, form, navigasi, styling, dan perbaikan UX. Mengatur task flow, clickability, copy ringkas, spacing, accessibility, konsistensi antar-page, serta UX review sebelum pekerjaan diterima.
---

# UX-first development dan konsistensi antar-page

Skill ini adalah pedoman wajib development, bukan kumpulan inspirasi estetika. Baca seluruh `SKILL.md` ini sebelum coding. Agent utama dan implementer yang mendapat izin delegasi wajib membacanya sendiri; sekadar menyebut nama skill tidak cukup.

## 1. Kapan dan bagaimana menerapkan

- **Semua coding:** periksa dampaknya terhadap tugas, status, feedback, serta risiko kesalahan pengguna. Untuk pekerjaan backend/internal tanpa dampak UX, catat singkat bahwa visual review tidak berlaku; jangan membuat perubahan UI atau menjalankan browser hanya untuk memenuhi formalitas.
- **Frontend wajib menerapkan seluruh gate yang relevan:** halaman, komponen, form, tabel, navigation, layout, CSS/theme/token, dialog, dan state interaksi—termasuk bug fix dan refactor yang memengaruhi hasil render.
- Backend yang memengaruhi error, status, atau kontrak UI juga wajib mempertimbangkan pengalaman pengguna; jangan mengubahnya tanpa menelusuri consumer.
- Baca [AGENTS.md](../../../AGENTS.md), [development-workflow](../development-workflow/SKILL.md), dan skill yang relevan, seperti `nextjs`, `tdd`, `systematic-debugging`, serta `better-auth-best-practices`. Skill ini tidak menggantikan approval, Context7, testing, atau aturan delegasi repo.
- [frontend-design](../frontend-design/SKILL.md) boleh membantu polish visual, tetapi arahan keunikan, pergantian font/palet, layout eksperimental, atau variasi antar-design **tidak boleh mengalahkan usability, accessibility, dan konsistensi aplikasi**. Jangan memilih arah estetika baru untuk setiap halaman.

Dasar riset beserta referensi primer: [Riset UX untuk pedoman design agent](../../../.scratch/ux-design/research/ux-design-research.md). Dokumen riset adalah penjelasan dan konteks historis; instruksi operasional berada di skill ini dan `AGENTS.md`. Baca bagian sumber yang relevan ketika membutuhkan detail atau memeriksa sebuah klaim; tidak perlu mengulang riset yang sudah terverifikasi tanpa alasan.

## 2. Prioritas keputusan

1. Kebutuhan pengguna dan kebenaran aturan bisnis.
2. Kejelasan tugas, navigasi, akibat tindakan, dan status.
3. Accessibility, pencegahan kesalahan, dan pemulihan.
4. Konsistensi design system, hierarki, grouping, dan efisiensi scanning.
5. Polish visual yang mendukung pekerjaan, bukan dekorasi yang bersaing dengannya.

UI yang lolos typecheck dan bisa diklik oleh Playwright belum tentu memiliki UX baik. Jangan menambah paragraf untuk menutupi kontrol atau alur yang tidak jelas.

## 3. Sebelum coding frontend

Buat catatan singkat — di percakapan untuk perubahan kecil, di artefak spec/plan untuk perubahan nontrivial; gunakan keputusan yang sudah disepakati dan jangan menambah dokumen/approval seremonial untuk perubahan kecil:

- **Tugas:** siapa pengguna, apa yang ingin diselesaikan, kondisi awal, dan hasil sukses.
- **Referensi:** cari halaman/pattern sejenis yang telah disepakati dan periksa komponen shared beserta token di konteks render sebenarnya. Jangan bertanya kepada pengguna tentang fakta yang bisa dicari di repo.
- **Hierarki:** tentukan informasi utama, primary action, grouping, dan tindakan sekunder. Untuk perubahan nontrivial, masukkan sketsa/susunan, state matrix, dan label final ke artefak spec/plan yang disetujui (lihat `development-workflow` §2) sehingga dapat direview sebelum implementasi; untuk perubahan kecil satu sesi, catatan di percakapan cukup.
- **Content inventory:** klasifikasikan copy menjadi perlu sekarang, pencegah kesalahan penting, bantuan tambahan, atau duplikasi yang dapat digabung/dihapus.
- **State:** identifikasi idle, selected, keyboard focus, loading, empty, sukses, error, disabled, permission-restricted, dan unsaved state yang relevan. Untuk perubahan nontrivial, state matrix beserta copy/label final masuk ke artefak spec/plan, bukan hanya slice notes; state yang belum diputuskan dicatat sebagai open item.
- **Batas scope:** perubahan flow, makna status, syarat bisnis, atau bahasa visual yang belum disepakati harus ditanyakan dahulu. Jangan melakukan redesign lintas halaman diam-diam.

Jika tidak ada referensi yang disepakati atau pattern lama bermasalah, usulkan pattern dan jelaskan dampaknya. Jangan menjadikan halaman buruk sebagai standar hanya demi keseragaman.

### Sumber kebenaran rancangan UX

- Rancangan UX yang disetujui hidup di spec/plan bersama scope dan acceptance, bukan di slice notes atau ingatan percakapan. Bila bagian rancangan belum diputuskan, catat sebagai open item dan tanyakan—jangan mengarang state, komponen, atau label saat implementasi.
- Jangan menambah state, komponen, atau variant yang tidak ada di rancangan hanya karena lebih mudah dibangun; state yang tidak ditulis tidak akan diimplementasikan, dan sebaliknya state karangan menjadi UX yang tidak pernah direview.
- Bila pemilik meminta prototype, prototype itu menjadi referensi **mengikat** untuk struktur layar, alur, penamaan tombol/aksi, urutan informasi, dan state. Token, theme, serta komponen shared existing tetap sumber kebenaran visual: jangan menyalin CSS atau nilai ad hoc prototype, dan jangan menambah font/palet baru.
- Contoh kasus yang harus dicegah: prototype sudah menyetujui tab pada daftar promo, tetapi implementasi memilih tone warna sendiri karena komposisi visual tidak pernah ditetapkan sebagai keputusan—akibatnya perlu plan pemulihan UX terpisah. Rujuk [`.scratch/discounts/plan/admin-discounts-prototype-alignment.md`](../../../.scratch/discounts/plan/admin-discounts-prototype-alignment.md) sebagai pelajaran, bukan sebagai pola yang diulang.

## 4. Aturan implementasi

### A. Konsistensi antar-page tidak opsional

- Gunakan token dan shared components sebagai sumber kebenaran. Telusuri alias sebenarnya; jangan menganggap komponen UI selalu berada di folder app.
- Pertahankan typography, semantic color, spacing scale, radius, shadow, ukuran kontrol, serta hierarki heading dan action yang telah disepakati.
- Fungsi yang sama memakai pattern visual dan perilaku yang sama: button, tabs, form, tabel, filter, pagination, dialog, badge, serta feedback.
- Makna status yang sama memakai label dan treatment yang konsisten. Jangan mengubah warna atau istilahnya dari satu halaman ke halaman lain tanpa alasan domain yang disepakati.
- Page header, grouping field, penempatan tindakan utama, dan feedback mengikuti pattern jenis halaman sepadan. Layout boleh berbeda sesuai tugas; bahasa visual tidak boleh berubah-ubah.
- Jangan membuat variant lokal, nilai visual ad hoc, font/palet baru, atau animasi berbeda hanya untuk membedakan satu halaman. Gunakan variant yang ada; usulkan penambahan shared pattern bila memang belum memadai.
- Perubahan shared token/component harus diperiksa pada consumer yang relevan, bukan hanya halaman pemicu. Perluas scope melalui persetujuan pengguna bila dampaknya melampaui pekerjaan yang disetujui.

Contoh: tabs pada Diskon dan Harga boleh memiliki label berbeda, tetapi tinggi, padding, indikator aktif, hover/focus, serta aturan responsive mengikuti shared pattern yang sama.

### B. Kontrol terbaca sebagai kontrol saat idle

- Button, link, tabs, dan disclosure memiliki cue konvensional yang terlihat sebelum hover: bentuk, underline, struktur region, indikator, atau kombinasinya.
- Hover dan cursor bukan satu-satunya petunjuk clickable. Jangan membuat kontrol tampak seperti teks pasif atau teks pasif tampak seperti link.
- Selected dan keyboard focus dapat dibedakan; jangan memakai warna saja untuk informasi penting.
- Gunakan semantik yang tepat untuk action, navigation, dan tabs. Jangan membuat elemen non-interaktif clickable tanpa keyboard behavior dan semantik yang benar; utamakan komponen yang sudah sesuai.
- Tidak semua kontrol memerlukan border/background sendiri. Pilih cue yang jelas dan konsisten, bukan membungkus semua teks dalam card.
- Periksa token gabungan pada background sebenarnya: contoh kegagalan yang harus dicegah ialah `bg-muted` dan `bg-background` bernilai sama sehingga indikator tab menghilang.

### C. Copy ringkas, bantuan kontekstual

- Utamakan judul bermakna, data, status, dan tindakan. Hapus pengulangan informasi tanpa menghilangkan perbedaan bisnis yang penting.
- Label action menjelaskan hasil, misalnya “Simpan draft” atau “Publish promo”, bukan “OK”.
- Gunakan bahasa pekerjaan pengguna, bukan otomatis menampilkan istilah internal database/API. Pertahankan istilah teknis yang memang dikenal pengguna.
- Hint field singkat dan dekat dengan field; jangan menumpuk aturan lintas fitur di setiap header/form.
- Bantuan tambahan boleh masuk disclosure berlabel jelas. Informasi yang dibutuhkan mayoritas pengguna, syarat penting, risiko biaya, atau konsekuensi tindakan tidak boleh disembunyikan di tooltip/hover/disclosure.
- Jangan memendekkan copy dengan mengubah makna uang, waktu, batas penggunaan, atau lifecycle. Validasi makna terhadap aturan bisnis.

Contoh: di dekat “Simpan draft”, jelaskan singkat bahwa promo belum aktif. Detail mekanisme revision tidak perlu menjadi paragraf pengantar di setiap halaman. Namun, efek publish terhadap promo aktif tetap terlihat pada titik review.

### D. Spacing dan pattern mengikuti makna

- Label dan hint lebih dekat ke input terkait daripada ke field berikutnya. Jarak antarseksi lebih besar daripada jarak di dalam kelompok.
- Kelompokkan field berdasarkan tugas, bukan sekadar memenuhi grid. Gunakan heading, whitespace, divider, atau surface seperlunya.
- Ikuti spacing scale design system; angka 4/8/16/24/32 px bukan standar UX universal dan tidak boleh menggantikan token yang sudah disepakati.
- Tabs untuk bagian terkait yang perlu ditukar cepat tanpa dibaca sekaligus. Jangan memakai tabs untuk menyembunyikan urutan wajib atau informasi yang perlu dibandingkan bersamaan.
- Periksa viewport dan theme yang didukung dalam scope: tidak ada kontrol penting terpotong, label bertabrakan, atau hubungan kelompok hilang. Hindari overflow halaman; tabel lebar boleh memakai region scroll yang jelas bila sesuai pattern.

### E. Feedback, error, dan keselamatan tindakan

- Satu primary action dominan untuk konteks tugas; tindakan sekunder tidak berebut emphasis.
- Pengguna tahu apakah tindakan sedang berjalan, berhasil, gagal, atau masih memiliki perubahan belum tersimpan. Cegah submit ganda sesuai pola aplikasi.
- Error menjelaskan masalah dan langkah pemulihan, dekat dengan konteksnya; pertahankan input pengguna saat gagal bila aman.
- Bila tindakan tidak tersedia, sampaikan alasan yang relevan. Jangan mengandalkan tombol disabled tanpa penjelasan saat pengguna perlu tahu cara melanjutkan.
- Konfirmasi proporsional untuk akibat serius; jangan menambah dialog pada setiap klik. Jangan mengubah aturan backend demi menyederhanakan tampilan.
- Bedakan empty karena belum ada data, filter tanpa hasil, kegagalan memuat, dan ketiadaan izin.

### F. Accessibility minimum

- Label field nyata, keyboard navigation, focus terlihat, serta semantik/state kontrol yang sesuai. Placeholder bukan pengganti label.
- Text contrast: 4.5:1 untuk teks biasa dan 3:1 untuk large text menurut SC 1.4.3 beserta pengecualiannya. Hint informatif bukan dekorasi.
- Cue non-text yang diperlukan untuk mengenali kontrol/state: 3:1 terhadap warna bersebelahan menurut SC 1.4.11 beserta pengecualiannya; bukan kewajiban border pada setiap kontrol.
- Informasi penting tidak color-only. Keyboard focus tidak boleh hilang tanpa pengganti yang terlihat.
- Target pointer memenuhi SC 2.5.8: minimal 24×24 CSS px atau pengecualian yang sah, termasuk aturan spacing. Kontrol penting/touch dapat diarahkan ke sekitar 44×44 bila sesuai konteks; jangan menyebut 44×44 sebagai minimum AA.
- Untuk tabs, periksa selected state, relasi panel, dan interaksi keyboard mengikuti WAI-ARIA APG. Gunakan dokumentasi/source terkini ketika implementasi menyentuh API library.
- Jangan mengklaim kepatuhan WCAG penuh dari screenshot, atribut ARIA, atau satu automated check. Detail dan sumber tersedia pada bagian accessibility di dokumen riset.

## 5. Gate penerimaan frontend

Agent utama bertanggung jawab menjalankan verifikasi. Implementer yang didelegasikan hanya menulis perubahan/tests dan menyerahkan catatan; tidak menjalankan browser, tests, atau validation commands yang dilarang oleh aturan repo.

Sebelum pekerjaan frontend dinyatakan selesai, agent utama wajib:

1. **Review hasil render:** periksa halaman di browser pada viewport/theme yang relevan, lalu bandingkan dengan rancangan UX yang disetujui (state matrix, label/copy, reuse map); membaca JSX atau mengecek class saja tidak cukup.
2. **Bandingkan antar-page:** gunakan halaman/pattern referensi sejenis pada kondisi yang sama. Periksa typography, spacing, warna, ukuran kontrol, posisi tindakan, serta selected/focus/error treatment. Untuk shared changes, periksa consumer yang terdampak.
3. **Jalankan task:** mulai dari kondisi awal, lakukan tindakan utama, lalu periksa status dan hasilnya. Periksa state relevan yang telah diidentifikasi dan keyboard behavior kontrol yang diubah.
4. **Tests dan checks:** gunakan `tdd`, tambahkan/update Playwright coverage perilaku user-visible sesuai `AGENTS.md`, lalu jalankan verification ladder yang relevan. Ikuti izin terpisah untuk legacy E2E. Jika Playwright gagal, diagnosis dari laporan Markdown; jangan membuka screenshot attachment kegagalan.
5. **Laporkan bukti:** tuliskan referensi konsistensi, behavior/state yang diperiksa, hasil checks, dan keterbatasan. Jika browser/infrastruktur tidak tersedia, nyatakan UX verification masih terblokir; jangan mengklaim frontend selesai atau sudah UX-friendly.

Heuristic review dan automated tests bukan pengganti usability testing dengan pengguna representatif. Jangan mengarang angka waktu, keberhasilan, atau klaim peningkatan UX yang belum diukur.

### Blocker: perbaiki atau eskalasi sebelum menerima hasil

- Style/perilaku pattern yang sama berbeda antar-page tanpa pengecualian yang disepakati.
- Kontrol penting menyerupai teks pasif saat idle; selected/focus state tidak jelas.
- Pengguna tidak dapat mengenali tindakan lanjutan atau akibat pentingnya.
- Informasi kritis tersembunyi atau hanya tersedia lewat hover.
- Copy panjang/berulang mengalahkan data dan tindakan tanpa alasan task yang jelas.
- Error tidak memberi jalan pemulihan atau menghilangkan input tanpa kebutuhan.
- Hasil render/task flow dan konsistensi belum diperiksa, tetapi pekerjaan diklaim selesai.

Perbaikan tetap dibatasi scope yang disetujui. Jika blocker membutuhkan keputusan produk atau redesign yang lebih luas, laporkan dan minta persetujuan—jangan melakukan perubahan lintas halaman secara diam-diam.
