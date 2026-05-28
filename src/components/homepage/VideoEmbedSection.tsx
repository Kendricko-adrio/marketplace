import type { VideoEmbedConfig } from "@/types/homepage";

interface VideoEmbedSectionProps {
  config: VideoEmbedConfig;
  title: string;
}

function getEmbedUrl(config: VideoEmbedConfig) {
  if (config.platform === "youtube") {
    const match = config.videoUrl.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
    const id = match ? match[1] : config.videoUrl;
    return `https://www.youtube.com/embed/${id}?autoplay=${config.autoplay ? 1 : 0}`;
  }
  // vimeo
  const match = config.videoUrl.match(/vimeo\.com\/(\d+)/);
  const id = match ? match[1] : config.videoUrl;
  return `https://player.vimeo.com/video/${id}?autoplay=${config.autoplay ? 1 : 0}`;
}

export default function VideoEmbedSection({ config, title }: VideoEmbedSectionProps) {
  const ratio = config.aspectRatio || "16/9";
  return (
    <section className="container mx-auto px-4 py-8">
      <h2 className="text-2xl font-semibold mb-6">{title}</h2>
      <div className="max-w-3xl mx-auto" style={{ aspectRatio: ratio }}>
        <iframe
          src={getEmbedUrl(config)}
          title={title}
          className="w-full h-full rounded-xl"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </section>
  );
}
