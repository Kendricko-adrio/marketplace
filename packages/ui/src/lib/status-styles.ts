/**
 * Satu treatment visual statis per tone status.
 *
 * Kelas di bawah hanya merujuk token `--status-<tone>-*` yang didefinisikan
 * di `apps/store/src/app/globals.css` dan `apps/admin/src/app/globals.css`
 * (nilai light/dark identik di kedua app). Tidak ada hardcode hex atau kelas
 * ad hoc per halaman: StatusBadge, ikon hasil checkout, dan container feedback
 * memakai fungsi ini agar status bermakna sama selalu tampil sama.
 *
 * Token CSS bersifat opaque, jadi kontras teks dapat diukur dari computed
 * style hasil render. Tidak ada `hover:` di sini — badge status pasif tidak
 * boleh berubah tone saat hover.
 */
import type { StatusTone } from "./status-presentation";

const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  waiting:
    "border-[color:var(--status-waiting-border)] bg-[color:var(--status-waiting-background)] text-[color:var(--status-waiting-foreground)]",
  progress:
    "border-[color:var(--status-progress-border)] bg-[color:var(--status-progress-background)] text-[color:var(--status-progress-foreground)]",
  ready:
    "border-[color:var(--status-ready-border)] bg-[color:var(--status-ready-background)] text-[color:var(--status-ready-foreground)]",
  info: "border-[color:var(--status-info-border)] bg-[color:var(--status-info-background)] text-[color:var(--status-info-foreground)]",
  success:
    "border-[color:var(--status-success-border)] bg-[color:var(--status-success-background)] text-[color:var(--status-success-foreground)]",
  error:
    "border-[color:var(--status-error-border)] bg-[color:var(--status-error-background)] text-[color:var(--status-error-foreground)]",
  cancelled:
    "border-[color:var(--status-cancelled-border)] bg-[color:var(--status-cancelled-background)] text-[color:var(--status-cancelled-foreground)]",
  neutral:
    "border-[color:var(--status-neutral-border)] bg-[color:var(--status-neutral-background)] text-[color:var(--status-neutral-foreground)]",
};

/** Kelas surface/foreground/border untuk satu tone status. */
export function getStatusToneClassName(tone: StatusTone): string {
  return STATUS_TONE_CLASSES[tone] ?? STATUS_TONE_CLASSES.neutral;
}
