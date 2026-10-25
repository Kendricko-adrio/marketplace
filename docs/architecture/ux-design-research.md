# Riset UX untuk pedoman design agent

Tanggal riset: 2026-10-23.

**Status: riset telah diadopsi menjadi skill wajib `ux-design` atas instruksi eksplisit pengguna.** Pedoman operasional berada di [`.agents/skills/ux-design/SKILL.md`](../../.agents/skills/ux-design/SKILL.md), dengan kewajiban membaca sebelum coding dan frontend acceptance gate di [`AGENTS.md`](../../AGENTS.md). Dokumen ini mempertahankan hasil riset dan asal rekomendasi; bukan persetujuan redesign halaman Diskon atau perluasan scope implementasi aplikasi.

## 1. Ruang lingkup dan metode

Pemicu: pengguna melaporkan halaman Diskon terlalu banyak teks, kurang pemisahan visual, dan tab pada editor draft tidak terlihat clickable.

Yang diperiksa:

- Dua screenshot yang diberikan pengguna, masing-masing halaman daftar promo dan editor draft. Nama file lokal: `pi-clipboard-47996875-ea7e-41eb-8dbc-defdb2635023.png` dan `pi-clipboard-0c8b23ba-3000-4f3b-8838-10238706008b.png`. File Temp bukan arsip permanen repo.
- Source halaman Diskon, komponen shared UI, token warna admin, dan skill `frontend-design` yang terpasang.
- Pencarian melalui Ollama `web_search`, kemudian pembacaan halaman sumber langsung melalui `web_fetch`: penelitian NN/g, panduan GOV.UK Design System, dan standar/pola W3C WAI.

Pada tahap riset awal tidak ada perubahan aplikasi, instalasi skill, browser interaction test, pengukuran computed style/contrast, atau usability test dengan pengguna. Tindak lanjut yang diminta pengguna adalah membuat skill lokal dan mewajibkan lookup melalui `AGENTS.md`; tidak mengubah frontend. Tidak ada subagent yang digunakan. Context7 tidak diperlukan untuk pekerjaan dokumentasi/instruksi ini karena tidak ada implementasi API library/framework; sumber UX dibaca langsung dari penerbitnya.

## 2. Apa yang dimaksud UX yang baik?

UX mencakup seluruh pengalaman berinteraksi dengan produk, bukan hanya tampilan UI. UI yang menarik tetap dapat menghasilkan UX buruk apabila produk tidak memenuhi kebutuhan pengguna. Usability adalah bagian dari UX: kemudahan belajar, efisiensi, kemudahan digunakan kembali, kesalahan dan pemulihannya, serta kepuasan. [S1][S2]

Untuk admin marketplace, definisi kerja yang diusulkan:

> Pengguna dapat mengenali kondisi saat ini, menemukan tindakan yang dibutuhkan, memahami akibatnya, menyelesaikan pekerjaan, dan pulih dari kesalahan tanpa harus membaca manual halaman.

Contoh: operator ingin membuat diskon Rp17.000. Ia seharusnya dapat menemukan “Buat draft”, mengisi aturan, menyimpan, lalu mengetahui bahwa diskon **belum aktif**. Memahami mekanisme internal revision bukan prasyarat untuk menyelesaikan tugas itu. Namun, akibat publish terhadap promo yang aktif tetap harus dijelaskan ketika relevan. Ini penerapan prinsip status, bahasa pengguna, dan recognition rather than recall—bukan keputusan mengubah lifecycle backend. [S3]

## 3. Temuan pada repo dan screenshot

### 3.1 Tab kehilangan pembeda background

Fakta source yang terverifikasi:

- [`apps/admin/src/app/globals.css:7`](../../apps/admin/src/app/globals.css#L7) dan [`:17`](../../apps/admin/src/app/globals.css#L17): pada light theme, `--background` dan `--muted` sama-sama `180 2% 95%`.
- [`packages/ui/src/components/ui/tabs.tsx:17`](../../packages/ui/src/components/ui/tabs.tsx#L17): wadah tab memakai `bg-muted`.
- [`packages/ui/src/components/ui/tabs.tsx:32`](../../packages/ui/src/components/ui/tabs.tsx#L32): tab aktif memakai `bg-background`; pembeda lainnya termasuk warna teks dan `shadow-sm`.
- [`apps/admin/src/app/admin/discounts/[id]/discount-editor-client.tsx:969`](../../apps/admin/src/app/admin/discounts/[id]/discount-editor-client.tsx#L969): editor menggunakan komponen tersebut untuk Aturan, Kode, Pemakaian & budget, dan Riwayat.
- Alias shared UI dapat diperiksa di [`apps/admin/tsconfig.json`](../../apps/admin/tsconfig.json).

Artinya, perbedaan background antara wadah, halaman, dan tab aktif yang seharusnya membantu pengelompokan tidak terbentuk di light theme ini. Screenshot konsisten dengan temuan tersebut: tab inactive tampak seperti deretan teks. Ini bukti masalah komposisi token dan konteks pemakaian; memakai komponen standar saja tidak menjamin hasil akhir jelas.

Batas kesimpulan: belum dilakukan pemeriksaan browser atas CSS final, contrast ratio, hover, focus, maupun keyboard. Tidak menyimpulkan seluruh implementasi tabs rusak atau tidak accessible hanya dari screenshot.

### 3.2 Informasi penjelas mengambil perhatian dari pekerjaan utama

Pada screenshot daftar, pengguna menemui pengantar halaman, deskripsi “Daftar promo”, dan paragraf aturan slot promosi sebelum baris data. Source-nya ada di:

- [`apps/admin/src/app/admin/discounts/page.tsx:15`](../../apps/admin/src/app/admin/discounts/page.tsx#L15).
- [`discounts-list-client.tsx:95`](../../apps/admin/src/app/admin/discounts/discounts-list-client.tsx#L95).
- [`discounts-list-client.tsx:117`](../../apps/admin/src/app/admin/discounts/discounts-list-client.tsx#L117).

Pada editor, penjelasan draft/live muncul lagi di deskripsi form; status header juga menampilkan beberapa informasi yang beririsan, seperti Draft, Belum dipublish, dan Ada draft belum dipublish. Lihat [`discount-editor-client.tsx:892`](../../apps/admin/src/app/admin/discounts/[id]/discount-editor-client.tsx#L892) dan [`:982`](../../apps/admin/src/app/admin/discounts/[id]/discount-editor-client.tsx#L982).

**Penilaian heuristik:** informasi tersebut mungkin benar secara bisnis, tetapi penempatan dan pengulangannya menambah beban scanning. Kandidat perbaikan adalah distribusi informasi berdasarkan tugas, bukan menghapus seluruh penjelasan. Kita belum memiliki bukti frekuensi kebutuhan operator untuk setiap informasi. [S3][S5][S6]

### 3.3 Spacing bukan sekadar jumlah ruang kosong

Screenshot memiliki ruang kosong yang cukup besar, tetapi kontrol dan teks tertentu tetap kurang terbaca sebagai kelompok yang berbeda. Memperbesar semua margin tidak otomatis menyelesaikannya. Yang dibutuhkan ialah hubungan yang jelas: label dekat dengan input, hint dekat dengan field yang dijelaskan, serta jarak antarkelompok lebih besar daripada jarak di dalam kelompok. [S7]

### 3.4 Skill estetika belum menjadi pedoman usability

[`frontend-design/SKILL.md:13`](../../.agents/skills/frontend-design/SKILL.md#L13) mendorong arah estetika yang bold; bagian berikutnya menekankan keunikan, typography, motion, serta komposisi yang tidak biasa. Skill itu menyebut constraints accessibility, tetapi belum menetapkan pemeriksaan wajib atas task flow, clickability saat idle, pengurangan copy, state matrix, dan bukti hasil usability review.

**Kesimpulan terbatas:** ada celah pada pedoman yang tersedia. Ini bukan bukti bahwa skill tersebut merupakan satu-satunya penyebab hasil buruk, dan tidak membenarkan agent mengabaikan usability. Untuk layar admin operasional, kejelasan dan konsistensi perlu didahulukan dari kebaruan visual. Prinsip consistency and standards mendukung penggunaan konvensi yang sudah dikenali pengguna. [S3]

## 4. Prinsip riset dan konsekuensi praktis

### A. Clickability harus terlihat sebelum hover

**Dasar:** studi eyetracking NN/g pada 71 peserta membandingkan halaman dengan signifier kuat dan lemah. Versi signifier lemah membutuhkan rata-rata 22% lebih lama dalam tugas menemukan tempat mengeklik. Angka ini khusus eksperimen tersebut, bukan prediksi peningkatan untuk aplikasi kita atau seluruh task flow. [S4]

**Usulan aturan:**

- Kontrol memiliki petunjuk yang terlihat saat idle: bentuk tombol, underline link, struktur tab, atau kombinasi cue konvensional yang memadai.
- Jangan mengandalkan hover atau perubahan cursor sebagai satu-satunya petunjuk. Keduanya baru membantu setelah pengguna mengarah ke target dan tidak tersedia dengan cara yang sama di touch.
- Bedakan clickable, selected, focused, dan disabled. Selected menjawab “bagian mana yang terbuka”; focus menjawab “elemen mana yang menerima input keyboard”.
- Hindari membuat teks biasa tampak seperti link. Semua kontrol tidak harus memiliki background atau border sendiri; pattern tab dengan baseline dan indikator aktif yang jelas juga merupakan kandidat.

Contoh: deretan Aturan / Kode / Pemakaian / Riwayat memiliki wadah atau struktur tab yang dikenali, indikator aktif berbentuk underline/bentuk, serta focus ring yang terlihat. Pilihan visual final belum diputuskan. [S4][S8][S13][S14]

### B. Tulis untuk scanning dan keputusan

**Dasar:** studi NN/g menunjukkan kecenderungan scanning, bukan membaca seluruh teks kata demi kata; rangkuman penelitian 2020 melaporkan pola dasar ini bertahan lintas studi. Ini kecenderungan, bukan klaim bahwa tidak ada pengguna yang membaca mendalam. [S5]

**Usulan aturan:**

- Dahulukan judul bermakna, data penting, status, dan tindakan.
- Setiap teks harus menjawab kebutuhan konkret: apa yang harus diisi, apa akibat tindakan, atau bagaimana memperbaiki masalah.
- Hindari penjelasan yang mengulang judul, label, atau badge tanpa informasi baru.
- Gunakan bahasa pekerjaan pengguna; audit istilah seperti “Revision live”, “Consumed”, “Hold”, dan “di-clip”. Jangan menganggap semua istilah English buruk—validasi apakah operator memang menggunakannya. [S3]
- Hint field yang selalu terlihat sebaiknya singkat dan spesifik; GOV.UK menganjurkan satu kalimat pendek untuk hint sederhana. Penjelasan kompleks membutuhkan tempat yang sesuai, bukan sekadar font lebih kecil. [S11]

Contoh kandidat: “Sekali per order, di-clip ke subtotal setelah Markdown” → “Potongan tidak melebihi subtotal setelah harga coret”. Copy ini tetap perlu diperiksa terhadap aturan bisnis sebelum dipakai.

### C. Progressive disclosure, bukan menyembunyikan informasi penting

**Dasar:** tampilkan kebutuhan utama lebih dahulu, dengan akses jelas ke informasi yang lebih jarang dibutuhkan. GOV.UK secara eksplisit melarang memakai details untuk menyembunyikan informasi yang dibutuhkan mayoritas pengguna. [S6][S10]

Sebelum memindahkan copy, klasifikasikan:

| Kategori | Penempatan yang diusulkan |
|---|---|
| Dibutuhkan untuk keputusan sekarang | Terlihat dekat tindakan/field terkait |
| Mencegah kesalahan penting | Terlihat sebelum tindakan berisiko; tidak tooltip-only |
| Penjelasan tambahan untuk sebagian pengguna | Disclosure berlabel jelas, dapat diakses dengan keyboard |
| Mengulang informasi yang sudah jelas | Gabungkan atau hapus duplikasi setelah memeriksa makna |

Contoh: “Simpan draft tidak mengaktifkan promo” tetap tersedia dekat aksi simpan atau status. Penjelasan detail interaksi subsidi ongkir dan slot promosi bisa menjadi kandidat “Cara promo digabungkan”, apabila terbukti tidak dibutuhkan pada tugas daftar sehari-hari. Konsekuensi biaya pada publish tetap harus terlihat saat review.

### D. Spacing menunjukkan struktur

**Dasar:** prinsip proximity—elemen dekat dipersepsikan berhubungan, elemen lebih jauh dipersepsikan sebagai kelompok berbeda. Terlalu jauh juga dapat membuat hint atau tindakan terkait terlewat. [S7]

**Usulan aturan:**

- Kelompokkan berdasarkan makna, misalnya Identitas promo, Potongan, dan Jadwal; bukan berdasarkan keinginan memenuhi grid.
- Jarak label–input lebih kecil daripada jarak antarfield; jarak antarseksi lebih besar daripada jarak antarfield.
- Gunakan token spacing konsisten dan periksa komposisi final pada viewport sasaran.
- Angka seperti 4/8/16/24/32 px dapat menjadi starting scale bila sesuai design system. Itu **usulan token lokal**, bukan standar universal UX atau kewajiban WCAG.
- Jangan membungkus setiap kalimat dalam card. Border/background dipakai untuk memperjelas region atau interaksi, bukan menambah noise.

### E. Gunakan pola sesuai pekerjaan

GOV.UK menyarankan tabs untuk bagian terkait yang pengguna perlu berpindah cepat tanpa melihat semuanya bersamaan. Tabs bukan pilihan tepat ketika pengguna harus membaca urutan langkah atau membandingkan informasi lintas panel. [S8]

**Usulan aturan:** pilih antara section, tabs, details, atau langkah berurutan berdasarkan task; bukan untuk sekadar mengurangi panjang halaman. Jangan menyembunyikan error atau syarat publish pada panel yang tidak terlihat tanpa petunjuk yang jelas.

### F. Tindakan, feedback, dan pemulihan adalah bagian design

**Dasar:** heuristik status, error prevention, user control, dan error recovery; GOV.UK juga membedakan primary/secondary actions dan menganjurkan label yang menjelaskan aksi. [S3][S9]

**Usulan aturan:**

- Ada satu primary action yang dominan untuk konteks tugas; tindakan lain tidak berebut emphasis.
- Label menjelaskan hasil, misalnya “Simpan draft” dan “Publish promo”, bukan hanya “OK”.
- Setelah simpan, pengguna tahu hasilnya dan apakah masih ada perubahan belum tersimpan.
- Loading, sukses, error, empty, disabled, serta permission-restricted state dirancang, bukan ditambahkan belakangan.
- Saat gagal menyimpan, pertahankan input dan berikan langkah pemulihan; saat tindakan tidak tersedia, jelaskan alasannya bila relevan.
- Konfirmasi dipakai secara proporsional untuk akibat serius, bukan ditambahkan ke setiap klik.

Contoh: publish gagal karena budget belum diisi → jelaskan field yang perlu diperbaiki dan arahkan ke bagian terkait tanpa menghilangkan draft. Ini rekomendasi pengalaman, bukan klaim bahwa perilaku aplikasi saat ini telah diuji.

### G. Accessibility adalah baseline, bukan bukti lengkap UX baik

Batas yang diverifikasi dari W3C:

| Aspek | Kriteria dan nuansa |
|---|---|
| Text contrast | SC 1.4.3: teks biasa minimal 4.5:1; large text 3:1, dengan pengecualian yang dijelaskan sumber. Hint yang informatif bukan dekorasi. [S12] |
| Non-text contrast | SC 1.4.11: cue visual yang diperlukan untuk mengenali kontrol/state minimal 3:1 terhadap warna bersebelahan, dengan pengecualian. **Bukan** kewajiban memberi semua tombol border 3:1. [S13] |
| Tidak color-only | SC 1.4.1: warna bukan satu-satunya cara menyampaikan makna. Gunakan indikator bentuk, teks, atau cue tambahan yang sesuai. [S14] |
| Target pointer | SC 2.5.8: target minimal 24×24 CSS px atau memenuhi pengecualian, termasuk aturan spacing tertentu; bukan aturan mutlak bahwa setiap target harus berukuran itu. Kontrol lebih besar sering lebih mudah digunakan. [S15] |
| Keyboard focus | SC 2.4.7: posisi focus harus terlihat. Jangan menghilangkan outline tanpa pengganti yang terlihat. [S16] |
| Tabs | APG menjelaskan tablist/tab/tabpanel, selected state, serta navigasi keyboard. Panduan pattern ini bukan pengganti audit WCAG. [S17] |

Target sekitar 44×44 CSS px dapat diusulkan untuk kontrol penting/touch bila sesuai konteks. Itu target kenyamanan proyek yang lebih kuat, **bukan minimum AA 24×24**. Jangan menyatakan kepatuhan WCAG dari screenshot atau keberadaan atribut ARIA saja.

## 5. Bentuk skill yang direkomendasikan

Rekomendasi skill **UX-first** telah diwujudkan sebagai [`ux-design`](../../.agents/skills/ux-design/SKILL.md), bukan tambahan daftar tren visual. `AGENTS.md` mewajibkan lookup sebelum coding dan menetapkan bahwa usability serta konsistensi mengalahkan arahan estetika yang bertentangan pada `frontend-design`. Bagian berikut mempertahankan landasan rekomendasi; untuk aturan yang berlaku, ikuti skill tersebut.

Urutan prioritas yang diusulkan:

1. Kebenaran kebutuhan dan aturan bisnis.
2. Kejelasan task flow, navigasi, dan akibat tindakan.
3. Accessibility dan error recovery.
4. Hierarki, grouping, dan efisiensi scanning.
5. Polish visual yang konsisten dengan design system.

### Ketentuan pengguna: konsistensi antar-page wajib

Tambahan arahan eksplisit pengguna setelah riset: **style tidak boleh berubah-ubah antar-page**. Ketentuan ini sudah dimasukkan ke skill wajib `ux-design`; bukan sekadar rekomendasi estetika. Prinsip consistency and standards mendukung penggunaan pola yang dapat dikenali kembali oleh pengguna. [S3]

- Gunakan satu design system sebagai acuan antar-page: typography, semantic color, spacing scale, radius, shadow, ukuran kontrol, serta hierarki heading dan action.
- Button, tabs, form, tabel, filter, pagination, dialog, badge, dan feedback dengan fungsi sama harus memiliki tampilan dan perilaku yang konsisten. Makna status yang sama tidak boleh berganti warna/label antar-page tanpa alasan domain yang jelas.
- Gunakan shared components dan token yang sudah disepakati. Jangan membuat variant lokal atau nilai visual ad hoc untuk menghasilkan style baru pada satu halaman.
- Pertahankan pola page header, posisi tindakan utama untuk jenis halaman sepadan, pengelompokan field, dan penempatan feedback. Layout boleh mengikuti kebutuhan tugas; konsistensi tidak berarti semua halaman harus memiliki susunan identik.
- Jangan memilih ulang font, palet, motion, atau arah estetika setiap mengerjakan halaman. Arahan variasi kreatif dalam `frontend-design` tidak boleh mengalahkan ketentuan konsistensi pengguna.
- Pilih halaman/pattern referensi yang telah disepakati, bukan menyalin sembarang halaman lama. Jika pattern yang ada bermasalah, usulkan perbaikan shared pattern dan dampaknya; jangan mempertahankan UX buruk demi keseragaman atau diam-diam melakukan redesign lintas halaman.
- Pattern baru yang memang dibutuhkan harus mengikuti token yang sama, memiliki alasan task yang jelas, dan disepakati sebelum menjadi pengecualian. Perubahan bahasa visual lintas halaman memerlukan persetujuan pengguna.

Contoh: halaman Diskon dan Harga sama-sama menggunakan tabs. Label dan isi panel boleh berbeda, tetapi tinggi kontrol, padding, indikator aktif, hover/focus, dan aturan responsive mengikuti pattern shared yang sama. Satu halaman tidak boleh memakai tabs menyerupai teks biasa sementara halaman lain memakai segmented control hanya karena preferensi agent saat implementasi.

### Workflow wajib yang diusulkan

**Sebelum code**

- Nyatakan pengguna, tugas utama, kondisi awal, dan hasil sukses; tandai asumsi yang belum diverifikasi.
- Periksa design system yang ada, termasuk token di konteks halaman, bukan hanya contoh komponen terisolasi. Tentukan halaman/pattern referensi yang disepakati untuk memeriksa konsistensi antar-page.
- Buat content inventory: tampilkan sekarang / kontekstual / disclosure / duplikasi.
- Sketsa hierarki dan tindakan utama. Minta keputusan pengguna bila ada perubahan flow atau informasi bisnis yang material.

**Saat implementasi**

- Gunakan kontrol semantik dan pola konvensional; jangan mengubah teks biasa menjadi kontrol tanpa cue.
- Terapkan grouping dan state secara konsisten.
- Pertahankan informasi risiko dan syarat penting pada titik keputusan.
- Ikuti approval dan testing gate repo; skill UX tidak memberi izin memperluas scope.

**Sebelum dinyatakan selesai**

- Lakukan review halaman yang sudah dirender pada viewport sasaran, bukan hanya membaca JSX. Bandingkan dengan halaman referensi sejenis pada theme dan viewport yang sama; periksa typography, spacing, warna, kontrol, serta state interaksinya.
- Periksa idle, selected, hover, keyboard focus, disabled, loading, empty, error, sukses, dan unsaved state yang relevan.
- Uji alur pengguna melalui Playwright; jangan hanya membuktikan elemen bisa dipanggil dengan selector.
- Catat bukti dan keterbatasan. Automated tests dapat membuktikan behavior tertentu, tetapi tidak membuktikan bahwa pengguna mengenali kontrol atau memahami copy.
- Untuk klaim kemudahan penggunaan, lakukan evaluasi dengan pengguna representatif dan iterasi; heuristic review agent tidak menggantikannya. [S2]

### Kandidat blocker dalam UX review

- Style atau perilaku pattern yang sama berbeda antar-page tanpa pengecualian yang disepakati; ketentuan konsistensi ini berasal langsung dari pengguna.
- Kontrol penting terlihat seperti teks pasif saat idle.
- Selected/focus state tidak dapat dikenali.
- Tidak ada tindakan lanjutan yang jelas pada state yang memerlukannya.
- Instruksi kritis hanya tersedia lewat hover atau tersembunyi jauh dari titik keputusan.
- Teks bantuan panjang/berulang menutupi data dan tindakan utama tanpa alasan task yang jelas.
- Error tidak memberi jalan pemulihan atau input pengguna hilang tanpa kebutuhan.
- Hasil final belum diperiksa di browser tetapi dilaporkan “UX sudah baik”.

Ketentuan konsistensi antar-page berasal dari arahan eksplisit pengguna. Blocker lainnya berasal dari rekomendasi riset, bukan kutipan standar universal. Pengguna kemudian menginstruksikan adopsinya sebagai skill wajib beserta lookup di `AGENTS.md`; daftar operasional yang berlaku berada pada bagian gate penerimaan skill `ux-design`. Persetujuan ini tidak mengizinkan redesign aplikasi, delegasi, commit, atau deployment.

## 6. Contoh arah penerapan pada Diskon

Bukan final design atau izin implementasi:

| Saat ini | Kandidat arah UX | Yang harus dipertahankan/divalidasi |
|---|---|---|
| Beberapa paragraf pengantar sebelum tabel | Judul ringkas, tindakan Buat draft, filter dan tabel sebagai fokus; bantuan tambahan terpisah | Informasi yang benar-benar diperlukan untuk menafsirkan kuota/budget tetap tersedia dekat konteksnya |
| Tabs tampak seperti deretan teks | Region navigasi jelas dengan indikator aktif, cue interaksi idle, dan focus terlihat | Semantik tabs, keyboard, responsive layout, dan keterbacaan theme |
| Beberapa status beririsan pada draft baru | Ringkasan status yang tidak redundan | Bedakan promo belum pernah aktif dari promo aktif yang memiliki perubahan draft |
| Penjelasan teknis tersebar di form | Hint singkat per field; penjelasan tambahan terkelompok | Makna uang, jadwal WIB, aturan batas waktu, dan dampak publish tidak boleh berubah |

Skenario evaluasi yang diusulkan: operator membuka Diskon, membuat draft Rp17.000, mengisi jadwal, menyimpan, membuka budget, lalu menjelaskan apakah promo sudah aktif dan apa yang masih perlu dilakukan. Amati keberhasilan, salah klik, keraguan, dan pemahaman status. Baseline serta target waktu belum diukur; jangan mengarang persentase keberhasilan atau klaim penghematan waktu.

## 7. Referensi primer

Semua halaman berikut dibaca melalui `web_fetch` setelah pencarian Ollama. Artikel riset lama digunakan dengan konteks; angka eksperimen tidak diekstrapolasi menjadi jaminan hasil produk.

- **[S1]** NN/g — [The Definition of User Experience](https://www.nngroup.com/articles/definition-user-experience/). UX lebih luas daripada UI dan usability.
- **[S2]** NN/g — [Usability 101](https://www.nngroup.com/articles/usability-101-introduction-to-usability/). Komponen usability dan evaluasi berulang dengan pengguna.
- **[S3]** NN/g — [10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/). Status, bahasa pengguna, consistency, error prevention/recovery, recognition, minimalism.
- **[S4]** NN/g — [Flat UI Elements Attract Less Attention and Cause Uncertainty](https://www.nngroup.com/articles/flat-ui-less-attention-cause-uncertainty/), 2017. Eksperimen signifier dan batas generalisasinya.
- **[S5]** NN/g — [How People Read Online: New and Old Findings](https://www.nngroup.com/articles/how-people-read-online/), 2020; konteks awal: [How Users Read on the Web](https://www.nngroup.com/articles/how-users-read-on-the-web/), 1997.
- **[S6]** NN/g — [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/). Pemisahan kebutuhan utama dan lanjutan beserta syarat discoverability.
- **[S7]** NN/g — [Proximity Principle in Visual Design](https://www.nngroup.com/articles/gestalt-proximity/), 2020. Grouping, whitespace, dan risiko elemen terkait terlalu berjauhan.
- **[S8]** GOV.UK Design System — [Tabs](https://design-system.service.gov.uk/components/tabs/). Kapan menggunakan/menghindari tabs dan batas bukti riset komponennya.
- **[S9]** GOV.UK Design System — [Button](https://design-system.service.gov.uk/components/button/). Label, primary/secondary actions, dan tindakan destruktif.
- **[S10]** GOV.UK Design System — [Details](https://design-system.service.gov.uk/components/details/). Informasi tambahan; bukan tempat menyembunyikan kebutuhan mayoritas pengguna.
- **[S11]** GOV.UK Design System — [Text input: Hint text](https://design-system.service.gov.uk/components/text-input/#hint-text). Hint singkat dan keterbatasan penjelasan panjang.
- **[S12]** W3C WAI — [Understanding SC 1.4.3: Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- **[S13]** W3C WAI — [Understanding SC 1.4.11: Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
- **[S14]** W3C WAI — [Understanding SC 1.4.1: Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).
- **[S15]** W3C WAI — [Understanding SC 2.5.8: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- **[S16]** W3C WAI — [Understanding SC 2.4.7: Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html).
- **[S17]** W3C WAI APG — [Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

Dokumen Understanding membantu menjelaskan kriteria; teks normatif standar berada di [WCAG 2.2](https://www.w3.org/TR/WCAG22/). Riset ini tidak mencakup audit kepatuhan penuh.
