# Investigasi gagal simpan carousel manual

## Akar masalah

Pada form baru, [HomepageSectionForm.tsx:99](../../../apps/admin/src/components/admin/homepage/HomepageSectionForm.tsx#L99) menginisialisasi `content` ke `{}`. [CarouselProductSectionForm.tsx:72](../../../apps/admin/src/components/admin/homepage/CarouselProductSectionForm.tsx#L72) membaca nilai tersebut sebagai mode manual untuk tampilan saja. Memilih produk [hanya memperbarui ID](../../../apps/admin/src/components/admin/homepage/CarouselProductSectionForm.tsx#L192); saat submit, [form meneruskan `content` apa adanya](../../../apps/admin/src/components/admin/homepage/HomepageSectionForm.tsx#L119). [Halaman create](../../../apps/admin/src/app/admin/homepage/new/page.tsx#L43) mengirim data itu sebagai JSON.

[Validator carousel](../../../apps/admin/src/lib/homepage-content.ts#L31) mewajibkan `content.mode` bernilai `manual` atau `filter`, sesuai [kontrak Homepage CMS](../../../docs/features/homepage-cms.md#L37). [Route POST](../../../apps/admin/src/app/api/admin/homepage/route.ts#L150) mengembalikan HTTP 400 dengan pesan `Invalid content shape for section type` sebelum menulis section atau pilihan produk ke database.

## Bukti lokal

Menguji langsung `validateContent` dari repo dengan payload JSON sintetis:

| Kasus | Hasil |
| --- | --- |
| `content: {}`, dua ID produk | Ditolak pada path `mode` |
| ID sama, `content: { mode: "manual" }` | Diterima |
| `content: { mode: "filter", filter: {}, limit: 10 }` | Diterima |

Pengujian ini tidak menjalankan browser, mengirim request ke server dev, atau mengubah database. Versi deploy dan payload aktual dari browser belum diperiksa.

## Saran

Untuk sementara, ganti ke **Filter Otomatis**, lalu kembali ke **Pilih Produk Manual** sebelum menyimpan. [Handler pergantian mode](../../../apps/admin/src/components/admin/homepage/CarouselProductSectionForm.tsx#L171) menuliskan mode secara eksplisit tanpa mengubah pilihan produk; workaround belum diuji di server dev.

Jika dilanjutkan ke implementasi, selaraskan default manual pada payload form create dan edit tanpa melonggarkan validasi API. Tambahkan regresi untuk memilih produk lalu menyimpan tanpa mengganti mode, serta cek urutan pilihan tetap tersimpan. Perubahan schema, database dan deploy di luar lingkup investigasi ini.
