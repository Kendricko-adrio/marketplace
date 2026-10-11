// Fictional fixtures, fixed dates and evidence. This is NOT a policy implementation.
export const stages = {
  payment: { label: 'Menunggu pembayaran', guidance: 'Tunggu pembayaran pelanggan.', tone: 'neutral', queues: ['all'] },
  settlement: { label: 'Verifikasi tertunda', guidance: 'Pembayaran diterima. Tunggu verifikasi Jubelio.', tone: 'warning', queues: ['followup', 'all'], impact: 'Barang belum dapat diproses karena verifikasi transaksi Jubelio belum selesai.' },
  prepare: { label: 'Siapkan barang', guidance: 'Siapkan barang, lalu tandai siap.', tone: 'blue', queues: ['work', 'all'], action: 'Tandai siap' },
  ready: { label: 'Barang siap', guidance: 'Barang siap. Pesan pengiriman.', tone: 'blue', queues: ['work', 'all'], action: 'Pesan pengiriman' },
  booked: { label: 'Menunggu penjemputan', guidance: 'Tunggu kurir. Catat serah terima setelah barang diserahkan.', tone: 'blue', queues: ['work', 'all'], action: 'Catat serah terima' },
  handed: { label: 'Diserahkan ke kurir', guidance: 'Barang diserahkan. Tunggu update kurir.', tone: 'neutral', queues: ['monitor', 'followup', 'all'] },
  transit: { label: 'Dalam pengiriman', guidance: 'Barang dalam pengiriman. Pantau pengiriman.', tone: 'blue', queues: ['monitor', 'all'] },
  delivered: { label: 'Barang diterima', guidance: 'Barang telah diterima. Pengiriman selesai.', tone: 'green', queues: ['done', 'all'] },
  manual: { label: 'Selesai manual', guidance: 'Order ditutup manual.', tone: 'neutral', queues: ['done', 'all'] },
  unknown: { label: 'Booking belum pasti', guidance: 'Konfirmasi ke Jubelio. Jangan pesan ulang.', tone: 'warning', queues: ['followup', 'all'], impact: 'Booking mungkin sudah terbentuk. Memesan ulang dapat membuat pengiriman ganda.' },
  dispatched: { label: 'Menunggu hasil booking', guidance: 'Hasil booking belum tersedia. Jangan pesan ulang.', tone: 'warning', queues: ['followup', 'all'], impact: 'Permintaan sudah dikirim; hasilnya belum tercatat.' },
  damaged: { label: 'Barang rusak', guidance: 'Barang rusak. Tindak lanjuti di luar aplikasi.', tone: 'danger', queues: ['followup', 'all'], impact: 'Kendala barang memblokir packing, booking, dan serah terima. Order tetap processing / paid.' },
  returned: { label: 'Barang dikembalikan', guidance: 'Kurir melaporkan pengembalian. Tindak lanjuti kendala.', tone: 'danger', queues: ['followup', 'all'] },
  hold: { label: 'Pengiriman tertahan', guidance: 'Pengiriman tertahan. Konfirmasi ke kurir.', tone: 'warning', queues: ['monitor', 'all'] },
};

const fixtures = [
  ['prepare', 'Nadia Contoh', 'Bandung'], ['ready', 'Arif Contoh', 'Bandung'],
  ['booked', 'Rani Contoh', 'Bandung'], ['prepare', 'Dimas Contoh', 'Jakarta'],
  ['unknown', 'Sinta Contoh', 'Bandung'], ['handed', 'Bayu Contoh', 'Bandung'],
  ['transit', 'Mira Contoh', 'Jakarta'], ['delivered', 'Farah Contoh', 'Bandung'],
  ['manual', 'Reza Contoh', 'Bandung'], ['settlement', 'Tika Contoh', 'Bandung'],
  ['damaged', 'Aldi Contoh', 'Bandung'], ['dispatched', 'Dewi Contoh', 'Bandung'],
  ['returned', 'Nino Contoh', 'Bandung'], ['hold', 'Lina Contoh', 'Jakarta'],
  ['payment', 'Yuda Contoh', 'Bandung'],
];

export const initialOrders = fixtures.map(([stage, customer, branch], i) => ({
  id: `ORD-2610-${String(i + 1).padStart(4, '0')}`,
  date: `2026-10-${String(1 + Math.floor(i / 5)).padStart(2, '0')}`,
  time: `${String(8 + i % 5).padStart(2, '0')}:15`,
  customer, branch, stage, released: false,
  awb: ['booked', 'handed', 'transit', 'delivered', 'manual', 'returned', 'hold'].includes(stage) ? `DEMO${String(i + 1).padStart(8, '0')}` : null,
  handoff: ['handed', 'manual'].includes(stage),
  events: [
    { label: 'Order dibuat', source: 'System', time: `0${1 + Math.floor(i / 5)} Okt 2026 · ${8 + i % 5}:15` },
    ...(stage !== 'payment' ? [{ label: 'Pembayaran diverifikasi', source: 'System', time: 'Waktu kejadian tidak tersedia' }] : []),
    ...(['ready', 'booked', 'handed', 'unknown', 'dispatched'].includes(stage) ? [{ label: 'Barang ditandai siap', source: 'Admin · Staff Demo', time: 'Waktu tercatat tidak tersedia' }] : []),
    ...(['handed', 'manual'].includes(stage) ? [{ label: 'Serah terima dicatat', source: 'Admin · Staff Demo', time: 'Waktu tercatat tidak tersedia' }] : []),
    ...(['transit', 'delivered', 'returned', 'hold'].includes(stage) ? [{ label: stages[stage].label, source: 'Courier · evidence simulasi', time: 'Waktu kejadian tidak tersedia', received: 'Update diterima sistem: 04 Okt 2026 · 14:30' }] : []),
    ...(stage === 'manual' ? [{ label: 'Order ditutup manual', source: 'Admin · Staff Demo', time: 'Waktu tercatat tidak tersedia' }] : []),
  ],
}));
export const queueOptions = [ ['work', 'Perlu dikerjakan'], ['followup', 'Follow-up'], ['monitor', 'Monitoring'], ['done', 'Selesai'], ['all', 'Semua delivery'] ];
