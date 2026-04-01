'use client';

import { useEffect, useRef, useState } from 'react';

const CORS_PROXY_BASE = "https://xkca.dadalapathy756.workers.dev/?url=";

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

function ensureCorsHeaderProxy(rawAbsoluteUrl: string): string {
  const urlToFetch = generateProperResolvedHfPath(rawAbsoluteUrl);
  if (urlToFetch.includes('huggingface.co/buckets/')) {
    return CORS_PROXY_BASE + encodeURIComponent(urlToFetch);
  }
  return urlToFetch;
}

// Factory function to create the HLS Loader class
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createHfBucketsProxyLoader = (BaseLoader: any, proxyFn: (url: string) => string) => {
  return class HfBucketsProxyLoader extends BaseLoader {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    load(context: any, config: any, callbacks: any) {
      if (context.url) context.url = proxyFn(context.url);
      super.load(context, config, callbacks);
    }
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function PlayerUI({ streamInfo }: { streamInfo: any }) {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const artRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hlsRef = useRef<any>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string }[]>([]);
  const [activeAudio, setActiveAudio] = useState<number>(0);
  
  const [subTracks, setSubTracks] = useState<{ id: number; name: string }[]>([]);
  const [activeSub, setActiveSub] = useState<number>(-1);

  useEffect(() => {
    let isMounted = true;

    const initializePlayer = async () => {
      try {
        let manifestUrl = streamInfo.hls_manifest_url;
        if (manifestUrl) manifestUrl = ensureCorsHeaderProxy(generateProperResolvedHfPath(manifestUrl));

        const Artplayer = (await import('artplayer')).default;
        const Hls = (await import('hls.js')).default;

        if (!isMounted || !playerContainerRef.current) return;

        const HfBucketsProxyLoader = createHfBucketsProxyLoader(Hls.DefaultConfig.loader, ensureCorsHeaderProxy);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const artOptions: any = {
          container: playerContainerRef.current,
          url: manifestUrl,
          type: 'm3u8',
          volume: 0.7,
          autoplay: true,
          setting: true,
          fullscreen: true,
          plugins: [], // Emptied - No Jassub needed
          customType: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            m3u8: function (video: HTMLVideoElement, url: string, artInstance: any) {
              if (Hls.isSupported()) {
                if (artInstance.hls) artInstance.hls.destroy();

                const hls = new Hls({
                  loader: HfBucketsProxyLoader as any,
                  enableWorker: true,
                  maxBufferLength: 120,
                  maxMaxBufferLength: 180,
                  maxBufferSize: 100 * 1024 * 1024,
                });

                hlsRef.current = hls;
                hls.loadSource(url);
                hls.attachMedia(video);
                artInstance.hls = hls;

                artInstance.on('destroy', () => hls.destroy());

                hls.on(Hls.Events.ERROR, function (event, data) {
                  if (data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
                });

                // Audio Parsing & Prefix Resolution
                hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
                  if (data.audioTracks && data.audioTracks.length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const tracks = data.audioTracks.map((track: any, index: number) => {
                      let rawName = track.name || track.lang || track.language || `Audio Track ${index + 1}`;
                      
                      // Prettify pipeline prefix tags
                      if (rawName.startsWith('U_')) rawName = rawName.replace('U_', '') + ' (Original)';
                      else if (rawName.startsWith('P_')) rawName = rawName.replace('P_', '') + ' (Standard)';
                      else if (rawName.startsWith('M_')) rawName = rawName.replace('M_', '') + ' (Night Mode/Dialog)';

                      return { id: index, name: rawName };
                    });
                    setAudioTracks(tracks);
                    setActiveAudio(hls.audioTrack !== -1 ? hls.audioTrack : 0);
                  }
                });

                // Native VTT Subtitle Extraction
                hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, data) => {
                  if (data.subtitleTracks && data.subtitleTracks.length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const tracks = data.subtitleTracks.map((track: any, index: number) => ({
                      id: index,
                      name: track.name || track.lang || track.language || `Subtitle Track ${index + 1}`
                    }));
                    
                    setSubTracks([{ id: -1, name: 'Off' }, ...tracks]);
                    setActiveSub(hls.subtitleTrack !== -1 ? hls.subtitleTrack : -1);
                  }
                });

              } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
              }
            }
          }
        };

        artRef.current = new Artplayer(artOptions);
        setIsLoading(false);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        if (isMounted) {
          setErrorMsg(err.message || 'An unknown error occurred loading the stream client.');
          setIsLoading(false);
        }
      }
    };

    initializePlayer();

    return () => {
      isMounted = false;
      if (hlsRef.current) hlsRef.current.destroy();
      if (artRef.current) artRef.current.destroy(true);
    };
  }, [streamInfo]);

  const switchAudio = (trackId: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = trackId;
      setActiveAudio(trackId);
    }
  };

  const switchSubtitle = (trackId: number) => {
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = trackId;
      setActiveSub(trackId);
    }
  };

  return (
    <>
      <div className="w-full aspect-video bg-neutral-950 relative border-b border-neutral-900 mt-0">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-600 text-sm tracking-widest uppercase">
            Initializing Stream Instance...
          </div>
        )}

        {errorMsg && (
          <div className="absolute inset-0 flex flex-col gap-4 items-center justify-center bg-black z-40">
            <span className="text-red-500 text-sm tracking-widest uppercase border border-red-500/30 px-4 py-2 rounded">
              Stream Failure
            </span>
            <span className="text-neutral-400 text-xs">{errorMsg}</span>
          </div>
        )}

        <div ref={playerContainerRef} className="w-full h-full absolute inset-0 z-10" />
      </div>

      {!isLoading && !errorMsg && (
        <div className="w-full max-w-screen-2xl mx-auto p-4 md:p-8 flex flex-col md:flex-row justify-between gap-8">
          
          <div className="flex flex-col gap-3">
            <span className="text-xs text-neutral-600 uppercase tracking-widest font-semibold">
              Audio Override
            </span>
            <div className="flex flex-wrap gap-2 bg-neutral-950 p-2 rounded-2xl border border-neutral-900 w-fit">
              {audioTracks.length > 0 ? (
                audioTracks.map((track) => (
                  <button
                    key={track.id}
                    onClick={() => switchAudio(track.id)}
                    className={`px-4 py-2 rounded-xl text-xs tracking-wider transition-all duration-200 ${activeAudio === track.id
                      ? 'bg-white text-black font-bold shadow-md'
                      : 'bg-transparent text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
                      }`}
                  >
                    {track.name}
                  </button>
                ))
              ) : (
                <span className="px-4 py-2 text-xs text-neutral-700">No alternate audio</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 md:items-end">
            <span className="text-xs text-neutral-600 uppercase tracking-widest font-semibold">
              Subtitle Override
            </span>
            <div className="flex flex-wrap gap-2 bg-neutral-950 p-2 rounded-2xl border border-neutral-900 w-fit justify-end">
              {subTracks.length > 0 ? (
                subTracks.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => switchSubtitle(sub.id)}
                    className={`px-4 py-2 rounded-xl text-xs tracking-wider transition-all duration-200 ${activeSub === sub.id
                      ? 'bg-blue-500 text-white font-bold shadow-md shadow-blue-500/20'
                      : 'bg-transparent text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
                      }`}
                  >
                    {sub.name}
                  </button>
                ))
              ) : (
                <span className="px-4 py-2 text-xs text-neutral-700">No alternate subtitles</span>
              )}
            </div>
          </div>

        </div>
      )}
    </>
  );
}