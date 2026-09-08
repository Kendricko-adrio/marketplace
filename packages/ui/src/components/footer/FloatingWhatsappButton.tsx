import { SocialIcon } from "./SocialIcons";

export interface FloatingWhatsappButtonProps {
  href: string;
  accessibleName?: string;
}

export default function FloatingWhatsappButton({
  href,
  accessibleName = "Hubungi ADF Sports melalui WhatsApp",
}: FloatingWhatsappButtonProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={accessibleName}
      className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_10px_30px_rgba(18,140,73,0.35)] ring-1 ring-black/5 transition duration-200 hover:-translate-y-1 hover:bg-[#20bd5a] hover:shadow-[0_14px_36px_rgba(18,140,73,0.45)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#25D366]/40 focus-visible:ring-offset-2"
    >
      <SocialIcon platform="whatsapp" size={28} />
    </a>
  );
}
