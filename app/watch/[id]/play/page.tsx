import Link from 'next/link';
import PlayerUI from './PlayerUI';
import { getStreamPayload } from '@/lib/catalog';
import { preload } from 'react-dom';

export default async function PlayPage({ 
  params,
  searchParams 
}: { 
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // 1. Unwrap both the route params and the query string params
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const streamId = resolvedSearchParams.streamId as string | undefined;

  // Graceful Fallback: Missing ID
  if (!streamId) {
    return (
      <main className="min-h-screen w-full bg-black flex flex-col items-center justify-center font-mono text-white">
        <div className="flex flex-col gap-4 items-center z-40">
          <span className="text-red-500 text-sm tracking-widest uppercase border border-red-500/30 px-4 py-2 rounded">
            Missing Stream ID
          </span>
          <span className="text-neutral-400 text-xs">No Stream Identifier provided. Please select a source.</span>
          <Link href={`/watch/${resolvedParams.id}`} className="mt-4 text-neutral-400 hover:text-white text-xs tracking-widest uppercase transition-colors">
            ← Back to Details
          </Link>
        </div>
      </main>
    );
  }

  // 2. Fetch using the exact variation ID the database expects
  const streamInfo = await getStreamPayload(streamId);

  // Graceful Fallback: DB Fetch Failure
  if (!streamInfo) {
    return (
      <main className="min-h-screen w-full bg-black flex flex-col items-center justify-center font-mono text-white">
        <div className="flex flex-col gap-4 items-center z-40">
          <span className="text-red-500 text-sm tracking-widest uppercase border border-red-500/30 px-4 py-2 rounded">
            Server Fetch Failure
          </span>
          <span className="text-neutral-400 text-xs">Could not retrieve secure payload from database.</span>
          <Link href={`/watch/${resolvedParams.id}`} className="mt-4 text-neutral-400 hover:text-white text-xs tracking-widest uppercase transition-colors">
            ← Back to Details
          </Link>
        </div>
      </main>
    );
  }

  // PHASE 2: AGGRESSIVE MANIFEST PRELOADING
  if (streamInfo._safe_manifest_url) {
    preload(streamInfo._safe_manifest_url, { as: 'fetch', crossOrigin: 'anonymous' });
  }
  
  if (streamInfo.pgs_overlays?.[0]?._safe_url) {
    preload(streamInfo.pgs_overlays[0]._safe_url, { as: 'fetch', crossOrigin: 'anonymous' });
  }

  return (
    <main className="min-h-screen w-full bg-black flex flex-col font-mono text-white">
      {/* Restored Back Button Overlay */}
      <div className="absolute top-0 left-0 w-full p-4 z-50 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <Link href={`/watch/${resolvedParams.id}`} className="text-neutral-400 hover:text-white text-xs tracking-widest uppercase transition-colors pointer-events-auto">
          ← Back to Details
        </Link>
      </div>

      <PlayerUI streamInfo={streamInfo} />
    </main>
  );
}