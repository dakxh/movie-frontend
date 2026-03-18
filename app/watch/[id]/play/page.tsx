import Link from 'next/link';
import VideoPlayer from '@/components/VideoPlayer';

const CATALOG_URL = 'https://huggingface.co/datasets/Gravatar44/record/resolve/main/global_catalog.json';

interface CatalogItem {
  id: number;
  type: 'movie' | 'series';
  title: string;
  hls_manifest_url?: string;
}

export default async function MoviePlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  
  const catRes = await fetch(CATALOG_URL, { next: { revalidate: 3600 } });
  const catalog: CatalogItem[] = await catRes.json();
  const movie = catalog.find((i) => i.id.toString() === id);

  if (!movie || movie.type !== 'movie' || !movie.hls_manifest_url) {
    return <div className="p-8 text-neutral-500 font-mono tracking-widest">INVALID MOVIE ASSET</div>;
  }

  return (
    <main className="h-screen w-screen bg-black flex flex-col">
      <div className="absolute top-0 left-0 w-full p-4 z-50 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-300">
        <Link href={`/watch/${id}`} className="text-neutral-400 hover:text-white font-mono text-xs uppercase tracking-widest flex items-center gap-2">
          <span>←</span> Back to Details
        </Link>
        <span className="text-neutral-500 font-mono text-xs tracking-widest">{movie.title}</span>
      </div>

      <div className="flex-1 w-full h-full">
        <VideoPlayer src={movie.hls_manifest_url} title={movie.title} />
      </div>
    </main>
  );
}