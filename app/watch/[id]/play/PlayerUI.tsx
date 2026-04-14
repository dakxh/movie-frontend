'use client';

import { useEffect, useRef, useState } from 'react';

const CORS_PROXY_BASE = "https://xkca.dadalapathy756.workers.dev/?url=";

// PARALLEL IMPORTS: Eagerly fetch massive video libraries while React mounts
const playerLibsPromise = typeof window !== 'undefined' 
  ? Promise.all([import('artplayer').then(m => m.default), import('hls.js').then(m => m.default)])
  : Promise.resolve([null, null]);

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

// SPLIT-ROUTING: Only proxy text files. Binary media goes direct to Hugging Face.
function getSplitRoutedUrl(rawAbsoluteUrl: string): string {
  const urlToFetch = generateProperResolvedHfPath(rawAbsoluteUrl);
  
  if (/\.(ts|mp4|m4s|webp)$/i.test(urlToFetch)) {
    return urlToFetch; // Direct CDN Fetch (Saves proxy bandwidth, zero TTFB penalty)
  }
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

type SubTrack = { id: string; name: string; type: 'vtt' | 'pgs' | 'off'; hlsId?: number; url?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function PlayerUI({ streamInfo }: { streamInfo: any }) {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const artRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hlsRef = useRef<any>(null);

  const pgsWorkerRef = useRef<Worker | null>(null);
  const syncLoopRef = useRef<number | null>(null);
  const activeSubTypeRef = useRef<'vtt' | 'pgs' | 'none'>('none');
  const lastSentTimeRef = useRef<number>(-1);

  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string }[]>([]);
  const [activeAudio, setActiveAudio] = useState<number>(0);
  
  const [subTracks, setSubTracks] = useState<SubTrack[]>([]);
  const [activeSub, setActiveSub] = useState<string>('off');

  useEffect(() => {
    let isMounted = true;

    const initializePlayer = async () => {
      try {
        let manifestUrl = streamInfo._safe_manifest_url || streamInfo.hls_manifest_url;
        if (manifestUrl) manifestUrl = getSplitRoutedUrl(generateProperResolvedHfPath(manifestUrl));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsedPgs: SubTrack[] = (streamInfo.pgs_overlays || []).map((sub: any, idx: number) => ({
          id: `pgs_${idx}`,
          name: (typeof sub === 'string' ? 'Overlay' : sub.label) + ' (Image)',
          type: 'pgs',
          url: getSplitRoutedUrl(generateProperResolvedHfPath(typeof sub === 'string' ? sub : sub.url))
        }));

        if (parsedPgs.length > 0) {
          setSubTracks([{ id: 'off', name: 'Off', type: 'off' }, ...parsedPgs]);
          
          if (parsedPgs[0].url) {
             fetch(parsedPgs[0].url, { priority: 'low' }).catch(() => {});
          }
        }

        const [Artplayer, Hls] = await playerLibsPromise;
        if (!Artplayer || !Hls || !isMounted || !playerContainerRef.current) return;

        const HfBucketsProxyLoader = createHfBucketsProxyLoader(Hls.DefaultConfig.loader, getSplitRoutedUrl);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nav = (typeof navigator !== 'undefined' ? navigator : {}) as any;
        const deviceMemory = nav.deviceMemory || 4; 
        const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
        const effectiveType = connection ? connection.effectiveType : '4g';
        const downlink = connection ? connection.downlink : 10;
        
        let dynamicMaxBufferSize = 100 * 1024 * 1024; 
        let dynamicMaxBufferLength = 120;
        let dynamicMaxMaxBufferLength = 180;
        
        if (deviceMemory < 4 || effectiveType === '3g') {
            dynamicMaxBufferSize = 30 * 1024 * 1024; 
            dynamicMaxBufferLength = 30;
            dynamicMaxMaxBufferLength = 60;
        } else if (deviceMemory >= 8 && downlink > 15) {
            dynamicMaxBufferSize = 150 * 1024 * 1024; 
            dynamicMaxBufferLength = 240;
            dynamicMaxMaxBufferLength = 360;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const artOptions: any = {
          container: playerContainerRef.current,
          url: manifestUrl,
          type: 'm3u8',
          volume: 0.7,
          autoplay: true,
          setting: false,
          fullscreen: true,
          customType: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            m3u8: function (video: HTMLVideoElement, url: string, artInstance: any) {
              if (Hls.isSupported()) {
                if (artInstance.hls) artInstance.hls.destroy();

                const hls = new Hls({
                  loader: HfBucketsProxyLoader as any,
                  enableWorker: true,
                  maxBufferLength: dynamicMaxBufferLength,
                  maxMaxBufferLength: dynamicMaxMaxBufferLength,
                  maxBufferSize: dynamicMaxBufferSize,
                });

                hlsRef.current = hls;
                hls.loadSource(url);
                hls.attachMedia(video);
                artInstance.hls = hls;

                artInstance.on('destroy', () => hls.destroy());

                hls.on(Hls.Events.ERROR, function (event, data) {
                  if (data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
                });

                hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
                  if (data.audioTracks && data.audioTracks.length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const tracks = data.audioTracks.map((track: any, index: number) => {
                      let rawName = track.name || track.lang || track.language || `Audio Track ${index + 1}`;
                      if (rawName.startsWith('U_')) rawName = rawName.replace('U_', '');
                      else if (rawName.startsWith('P_')) rawName = rawName.replace('P_', '');
                      else if (rawName.startsWith('M_')) rawName = '[C] '+rawName.replace('M_', '');
                      return { id: index, name: rawName };
                    });
                    setAudioTracks(tracks);
                    setActiveAudio(hls.audioTrack !== -1 ? hls.audioTrack : 0);
                  }
                });

                hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, data) => {
                  if (data.subtitleTracks && data.subtitleTracks.length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const vttTracks: SubTrack[] = data.subtitleTracks.map((track: any, index: number) => ({
                      id: `vtt_${index}`,
                      hlsId: index,
                      name: (track.name || track.lang || track.language || `Subtitle Track ${index + 1}`) + ' (Text)',
                      type: 'vtt'
                    }));
                    
                    setSubTracks([{ id: 'off', name: 'Off', type: 'off' }, ...vttTracks, ...parsedPgs]);
                    setActiveSub((prev) => {
                      if (prev !== 'off' && prev.startsWith('pgs_')) return prev;
                      return hls.subtitleTrack !== -1 ? `vtt_${hls.subtitleTrack}` : 'off';
                    });
                  }
                });

              } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
              }
            }
          }
        };

        artRef.current = new Artplayer(artOptions);
        
        artRef.current.on('ready', () => {
           const canvas = document.createElement('canvas');
           
           // --- NEW: DYNAMIC BOUNDING BOX CSS ---
           // We style the canvas exactly like a standard VTT subtitle wrapper
           canvas.style.position = 'absolute';
           canvas.style.bottom = '8%'; // Anchor to bottom of screen
           canvas.style.left = '50%';  // Center horizontally
           
           // Hardware acceleration + perfect horizontal centering
           canvas.style.transform = 'translateX(-50%) translateZ(0)'; 
           
           // Constrain the bounding box so it scales gracefully on ultrawide or mobile
           canvas.style.maxWidth = '85%'; 
           canvas.style.maxHeight = '20%'; 
           canvas.style.objectFit = 'contain'; 
           
           canvas.style.pointerEvents = 'none';
           canvas.style.zIndex = '20'; 
           canvas.style.willChange = 'contents';
           canvas.style.backfaceVisibility = 'hidden';
           
           // NOTE: We intentionally DO NOT set canvas.width=1920 or canvas.height=1080 here anymore.
           
           artRef.current.template.$player.appendChild(canvas);

           // @ts-ignore
           const offscreen = canvas.transferControlToOffscreen();
           
           const worker = new Worker('/pgs-worker.js');
           pgsWorkerRef.current = worker;

           worker.postMessage({
               type: 'INIT',
               canvas: offscreen,
               url: null 
           }, [offscreen]);

           const startSyncEngine = () => {
               if (activeSubTypeRef.current === 'pgs' && pgsWorkerRef.current && artRef.current) {
                   const rawTime = artRef.current.video ? artRef.current.video.currentTime : artRef.current.currentTime;
                   if (rawTime !== lastSentTimeRef.current) {
                       pgsWorkerRef.current.postMessage({ type: 'TIME', time: rawTime || 0 });
                       lastSentTimeRef.current = rawTime;
                   }
               }
               syncLoopRef.current = requestAnimationFrame(startSyncEngine);
           };
           syncLoopRef.current = requestAnimationFrame(startSyncEngine);
        });

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
      if (syncLoopRef.current) cancelAnimationFrame(syncLoopRef.current);
      if (pgsWorkerRef.current) {
          pgsWorkerRef.current.postMessage({ type: 'CLEAR' });
          pgsWorkerRef.current.terminate();
      }
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

  const switchSubtitle = (track: SubTrack) => {
    if (!artRef.current) return;

    if (track.type === 'vtt') {
       activeSubTypeRef.current = 'vtt';
       if (hlsRef.current && track.hlsId !== undefined) hlsRef.current.subtitleTrack = track.hlsId;
       if (pgsWorkerRef.current) pgsWorkerRef.current.postMessage({ type: 'CLEAR' });
    } 
    else if (track.type === 'pgs') {
       activeSubTypeRef.current = 'pgs';
       if (hlsRef.current) hlsRef.current.subtitleTrack = -1; 
       if (pgsWorkerRef.current) pgsWorkerRef.current.postMessage({ type: 'LOAD', url: track.url });
    }
    else {
       activeSubTypeRef.current = 'none';
       if (hlsRef.current) hlsRef.current.subtitleTrack = -1;
       if (pgsWorkerRef.current) pgsWorkerRef.current.postMessage({ type: 'CLEAR' });
    }
    
    setActiveSub(track.id);
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
                    onClick={() => switchSubtitle(sub)}
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
