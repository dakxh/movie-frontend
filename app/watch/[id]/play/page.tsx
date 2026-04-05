import Link from 'next/link';
import PlayerUI from './PlayerUI';

// Utility to ensure we are hitting the raw/resolve endpoint for JSON directly from the server
function generateProperResolvedHfPath(u: string): string {
  if (!u || typeof u !== 'string') return u;
  const sanitized = u.split('?download=true')[0].split('&download=true')[0];
  if (!sanitized.startsWith('https://huggingface.co/buckets/') || sanitized.includes('/resolve/')) {
    return sanitized;
  }
  const parts = sanitized.split('/');
  if (parts.length > 6) {
    parts.splice(6, 0, 'resolve');
    return parts.join('/');
  }
  return sanitized;
}

export default async function MoviePlayPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const metaUrl = searchParams.metaUrl as string | undefined;

  if (!metaUrl) {
    return (
      <main className="min-h-screen w-full bg-black flex flex-col items-center justify-center font-mono text-white">
        <div className="flex flex-col gap-4 items-center z-40">
          <span className="text-red-500 text-sm tracking-widest uppercase border border-red-500/30 px-4 py-2 rounded">
            Missing Metadata
          </span>
          <span className="text-neutral-400 text-xs">No metadata URL provided. Please go back and select a video.</span>
          <Link href={`/watch/${id}`} className="mt-4 text-neutral-400 hover:text-white text-xs tracking-widest uppercase transition-colors">
            ← Back to Details
          </Link>
        </div>
      </main>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let streamInfo: any = null;
  let errorMsg = null;

  try {
    const fetchUrl = generateProperResolvedHfPath(metaUrl);
    
    // DIRECT SERVER FETCH WITH ISR
    const response = await fetch(fetchUrl, { next: { revalidate: 3600 } });
    if (!response.ok) throw new Error(`Failed to fetch metadata: ${response.status}`);
    
    streamInfo = await response.json();

    // PERFORMANCE FIX: Obfuscate the manifest URL key.
    // This stops Next.js's aggressive automatic string parser from injecting a <link rel="preload"> 
    // which causes false-positive CORS errors in the browser console.
    if (streamInfo && streamInfo.hls_manifest_url) {
      streamInfo._safe_manifest_url = streamInfo.hls_manifest_url;
      delete streamInfo.hls_manifest_url;
    }

  } catch (err: unknown) {
    errorMsg = (err as Error).message || 'An unknown error occurred loading the stream metadata on the server.';
  }

  return (
    <main className="min-h-screen w-full bg-black flex flex-col font-mono text-white">
      {/* HEADER OVERLAY */}
      <div className="absolute top-0 left-0 w-full p-4 z-50 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <Link href={`/watch/${id}`} className="text-neutral-400 hover:text-white text-xs tracking-widest uppercase transition-colors pointer-events-auto">
          ← Back to Details
        </Link>
        {streamInfo && (
          <span className="text-neutral-500 text-xs tracking-widest hidden md:block">
            {streamInfo.series_title || streamInfo.title}
          </span>
        )}
      </div>

      {/* ERROR STATE */}
      {errorMsg && (
        <div className="flex-1 flex flex-col gap-4 items-center justify-center bg-neutral-950 border-b border-neutral-900">
          <span className="text-red-500 text-sm tracking-widest uppercase border border-red-500/30 px-4 py-2 rounded">
            Server Fetch Failure
          </span>
          <span className="text-neutral-400 text-xs">{errorMsg}</span>
        </div>
      )}

      {/* SUCCESS STATE - PASS TO CLIENT */}
      {!errorMsg && streamInfo && (
        <PlayerUI streamInfo={streamInfo} />
      )}
    </main>
  );
}