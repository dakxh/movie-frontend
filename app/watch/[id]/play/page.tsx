import Link from 'next/link';
import PlayerUI from './PlayerUI';
import { getStreamPayload } from '@/lib/catalog';

export default async function MoviePlayPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const streamId = searchParams.streamId as string | undefined;

  if (!streamId) {
    return (
      <main className="min-h-screen w-full bg-black flex flex-col items-center justify-center font-mono text-white">
        <div className="flex flex-col gap-4 items-center z-40">
          <span className="text-red-500 text-sm tracking-widest uppercase border border-red-500/30 px-4 py-2 rounded">
            Missing Stream ID
          </span>
          <span className="text-neutral-400 text-xs">No Stream Identifier provided. Please select a source.</span>
          <Link href={`/watch/${id}`} className="mt-4 text-neutral-400 hover:text-white text-xs tracking-widest uppercase transition-colors">
            ← Back to Details
          </Link>
        </div>
      </main>
    );
  }

  const streamInfo = await getStreamPayload(streamId);

  if (!streamInfo) {
    return (
      <main className="min-h-screen w-full bg-black flex flex-col items-center justify-center font-mono text-white">
        <div className="flex flex-col gap-4 items-center z-40">
          <span className="text-red-500 text-sm tracking-widest uppercase border border-red-500/30 px-4 py-2 rounded">
            Server Fetch Failure
          </span>
          <span className="text-neutral-400 text-xs">Could not retrieve secure payload from database.</span>
          <Link href={`/watch/${id}`} className="mt-4 text-neutral-400 hover:text-white text-xs tracking-widest uppercase transition-colors">
            ← Back to Details
          </Link>
        </div>
      </main>
    );
  }

  // PERFORMANCE FIX: Obfuscate the manifest URL key.
  // Stops Next.js's aggressive automatic string parser from injecting a <link rel="preload"> 
  // which causes false-positive CORS errors in the browser console.
  if (streamInfo && streamInfo.hls_manifest_url) {
    streamInfo._safe_manifest_url = streamInfo.hls_manifest_url;
    delete streamInfo.hls_manifest_url;
  }

  return (
    <main className="min-h-screen w-full bg-black flex flex-col font-mono text-white">
      <div className="absolute top-0 left-0 w-full p-4 z-50 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <Link href={`/watch/${id}`} className="text-neutral-400 hover:text-white text-xs tracking-widest uppercase transition-colors pointer-events-auto">
          ← Back to Details
        </Link>
      </div>

      <PlayerUI streamInfo={streamInfo} />
    </main>
  );
}