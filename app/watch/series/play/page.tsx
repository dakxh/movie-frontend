import Link from 'next/link';
import VideoPlayer from '../../../../components/VideoPlayer';

export default async function SeriesPlayPage({ searchParams }: { searchParams: Promise<{ manifest?: string, title?: string }> }) {
  // Next.js 15 requires awaiting searchParams
  const { manifest, title } = await searchParams;

  if (!manifest) {
    return <div className="p-8 text-neutral-500 font-mono tracking-widest">NO MANIFEST PROVIDED</div>;
  }

  const decodedManifest = decodeURIComponent(manifest);
  const displayTitle = title ? decodeURIComponent(title) : 'Episode Playback';

  return (
    <main className="h-screen w-screen bg-black flex flex-col">
      {/* Minimalistic Header */}
      <div className="absolute top-0 left-0 w-full p-4 z-50 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-300">
        {/* Using a generic javascript back function here to return to the specific show's detail page seamlessly */}
        <button 
          onClick={() => { /* Client component needed for router.back(), so we use a simple generic link approach or rely on browser back */ }}
          className="text-neutral-400 font-mono text-xs uppercase tracking-widest hover:text-white"
        >
          {/* Note: In a pure RSC without "use client", linking to javascript:history.back() or just advising browser back is standard for brutalist minimalism, or you can hardcode a home link */}
          <Link href="/">← Catalog</Link>
        </button>
        <span className="text-neutral-500 font-mono text-xs tracking-widest">{displayTitle}</span>
      </div>

      {/* The Player */}
      <div className="flex-1 w-full h-full flex items-center justify-center">
        <VideoPlayer src={decodedManifest} title={displayTitle} />
      </div>
    </main>
  );
}