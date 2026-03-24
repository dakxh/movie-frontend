// app/watch/[id]/play/PlayerUI.tsx
'use client';

import { useEffect, useRef, useState } from 'react';

const CORS_PROXY_BASE = "https://xkca.dadalapathy756.workers.dev/?url=";
const proxyCache = new Map<string, string>();

function generateProperResolvedHfPath(u: string): string {
  if (!u || typeof u !== 'string') return u;
  let sanitized = u.split('?download=true')[0].split('&download=true')[0];
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
  if (proxyCache.has(rawAbsoluteUrl)) return proxyCache.get(rawAbsoluteUrl)!;
  const urlToFetch = generateProperResolvedHfPath(rawAbsoluteUrl);
  let finalUrl = urlToFetch;
  if (urlToFetch.includes('huggingface.co/buckets/')) {
    finalUrl = CORS_PROXY_BASE + encodeURIComponent(urlToFetch);
  }
  proxyCache.set(rawAbsoluteUrl, finalUrl);
  return finalUrl;
}

const emptyAss = 'data:text/plain;charset=utf-8,' + encodeURIComponent(
  '[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
);

type SubTrack = { url: string; label: string; type: 'ass' | 'pgs' | 'off' };

export default function PlayerUI({ streamInfo }: { streamInfo: any }) {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<any>(null);
  const hlsRef = useRef<any>(null);

  const pgsWorkerRef = useRef<Worker | null>(null);
  const syncLoopRef = useRef<number | null>(null);
  const activeSubTypeRef = useRef<'ass' | 'pgs' | 'none'>('none');

  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string }[]>([]);
  const [activeAudio, setActiveAudio] = useState<number>(0);
  const [subTracks, setSubTracks] = useState<SubTrack[]>([]);
  const [activeSub, setActiveSub] = useState<string>('');

  useEffect(() => {
    let isMounted = true;

    const initializePlayer = async () => {
      try {
        let manifestUrl = streamInfo.hls_manifest_url;
        if (manifestUrl) manifestUrl = ensureCorsHeaderProxy(generateProperResolvedHfPath(manifestUrl));

        const fonts = (streamInfo.fonts || []).map((f: string) => ensureCorsHeaderProxy(f));

        const parsedAss: SubTrack[] = (streamInfo.ass_subtitles || []).map((sub: any) => ({
          url: ensureCorsHeaderProxy(generateProperResolvedHfPath(typeof sub === 'string' ? sub : sub.url)),
          label: (typeof sub === 'string' ? 'Subtitle' : sub.label) + ' (Text)',
          type: 'ass'
        }));

        const parsedPgs: SubTrack[] = (streamInfo.pgs_overlays || []).map((sub: any) => ({
          url: ensureCorsHeaderProxy(generateProperResolvedHfPath(typeof sub === 'string' ? sub : sub.url)),
          label: (typeof sub === 'string' ? 'Overlay' : sub.label) + ' (Image)',
          type: 'pgs'
        }));

        const allSubs: SubTrack[] = [
          { url: 'off', label: 'Off', type: 'off' }, 
          ...parsedAss, 
          ...parsedPgs
        ];
        
        setSubTracks(allSubs);

        let initialJassubUrl = emptyAss;
        if (allSubs.length > 1) {
            setActiveSub(allSubs[1].url);
            
            if (allSubs[1].type === 'ass') {
              initialJassubUrl = allSubs[1].url;
              activeSubTypeRef.current = 'ass';
            } else if (allSubs[1].type === 'pgs') {
              activeSubTypeRef.current = 'pgs';
            }
        } else {
            setActiveSub('off');
        }

        const Artplayer = (await import('artplayer')).default;
        const Hls = (await import('hls.js')).default;
        const artplayerPluginJassub = (await import('artplayer-plugin-jassub')).default;

        if (!isMounted || !playerContainerRef.current) return;

        class HfBucketsProxyLoader extends Hls.DefaultConfig.loader {
          load(context: any, config: any, callbacks: any) {
            if (context.url) context.url = ensureCorsHeaderProxy(context.url);
            super.load(context, config, callbacks);
          }
        }

        const artOptions: any = {
          container: playerContainerRef.current,
          url: manifestUrl,
          type: 'm3u8',
          volume: 0.7,
          autoplay: true,
          setting: true,
          fullscreen: true,
          customType: {
            m3u8: function (video: HTMLVideoElement, url: string, artInstance: any) {
              if (Hls.isSupported()) {
                if (artInstance.hls) artInstance.hls.destroy();

                const hls = new Hls({
                  loader: HfBucketsProxyLoader as any,
                  enableWorker: true,
                  maxBufferLength: 120,
                  maxMaxBufferLength: 180,
                  maxBufferSize: 100 * 1024 * 1024,
                  manifestLoadingTimeOut: 15000,
                  fragLoadingTimeOut: 30000,
                  lowLatencyMode: false
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
                    const tracks = data.audioTracks.map((track: any, index: number) => ({
                      id: index,
                      name: track.name || track.lang || track.language || `Audio Track ${index + 1}`
                    }));
                    setAudioTracks(tracks);
                    setActiveAudio(hls.audioTrack !== -1 ? hls.audioTrack : 0);
                  }
                });

              } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
              }
            }
          }
        };

        artOptions.plugins = [
          artplayerPluginJassub({
            debug: false,
            subUrl: initialJassubUrl,
            fonts: fonts,
            workerUrl: '/jassub-worker.js',
            wasmUrl: '/jassub-worker.wasm',
            modernWasmUrl: '/jassub-worker.wasm',
          })
        ];

        artRef.current = new Artplayer(artOptions);
        
        artRef.current.on('ready', () => {
           const canvas = document.createElement('canvas');
           canvas.style.position = 'absolute';
           canvas.style.top = '0';
           canvas.style.left = '0';
           canvas.style.width = '100%';
           canvas.style.height = '100%';
           canvas.style.objectFit = 'contain'; 
           canvas.style.pointerEvents = 'none';
           canvas.style.zIndex = '20'; 
           
           // Initialize default resolution so it isn't 300x150. Worker will overwrite.
           canvas.width = 1920;
           canvas.height = 1080;
           
           artRef.current.template.$player.appendChild(canvas);

           // @ts-ignore
           const offscreen = canvas.transferControlToOffscreen();
           
           const worker = new Worker('/pgs-worker.js');
           pgsWorkerRef.current = worker;

           worker.postMessage({
               type: 'INIT',
               canvas: offscreen,
               url: activeSubTypeRef.current === 'pgs' ? allSubs[1].url : null
           }, [offscreen]);

           // FIX: Blazing fast requestAnimationFrame loop to ensure Lookahead cache accurately tracks scrubbing
           const startSyncEngine = () => {
               if (activeSubTypeRef.current === 'pgs' && pgsWorkerRef.current && artRef.current) {
                   pgsWorkerRef.current.postMessage({ type: 'TIME', time: artRef.current.currentTime });
               }
               syncLoopRef.current = requestAnimationFrame(startSyncEngine);
           };
           syncLoopRef.current = requestAnimationFrame(startSyncEngine);
        });

        setIsLoading(false);

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

  const switchSubtitle = (sub: SubTrack) => {
    if (!artRef.current) return;
    const p = artRef.current.plugins?.artplayerPluginJassub;
    
    if (sub.type === 'ass') {
       activeSubTypeRef.current = 'ass';
       
       if (pgsWorkerRef.current) {
           pgsWorkerRef.current.postMessage({ type: 'CLEAR' });
       }

       if (p) {
         if (typeof p.switchSubtitle === 'function') p.switchSubtitle(sub.url);
         else if (typeof p.switch === 'function') p.switch(sub.url);
         else if (p.jassub && typeof p.jassub.setTrackByUrl === 'function') p.jassub.setTrackByUrl(sub.url);
       }
    } 
    else if (sub.type === 'pgs') {
       activeSubTypeRef.current = 'pgs';

       if (p) {
         if (typeof p.switchSubtitle === 'function') p.switchSubtitle(emptyAss);
         else if (typeof p.switch === 'function') p.switch(emptyAss);
         else if (p.jassub && typeof p.jassub.setTrackByUrl === 'function') p.jassub.setTrackByUrl(emptyAss);
       }

       if (pgsWorkerRef.current) {
           pgsWorkerRef.current.postMessage({ type: 'LOAD', url: sub.url });
       }
    }
    else {
       activeSubTypeRef.current = 'none';
       if (pgsWorkerRef.current) pgsWorkerRef.current.postMessage({ type: 'CLEAR' });
       if (p) {
         if (typeof p.switchSubtitle === 'function') p.switchSubtitle(emptyAss);
         else if (typeof p.switch === 'function') p.switch(emptyAss);
         else if (p.jassub && typeof p.jassub.setTrackByUrl === 'function') p.jassub.setTrackByUrl(emptyAss);
       }
    }
    
    setActiveSub(sub.url);
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
                subTracks.map((sub, idx) => (
                  <button
                    key={idx}
                    onClick={() => switchSubtitle(sub)}
                    className={`px-4 py-2 rounded-xl text-xs tracking-wider transition-all duration-200 ${activeSub === sub.url
                      ? 'bg-blue-500 text-white font-bold shadow-md shadow-blue-500/20'
                      : 'bg-transparent text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
                      }`}
                  >
                    {sub.label}
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