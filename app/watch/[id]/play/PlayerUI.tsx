'use client';

import { useEffect, useRef, useState } from 'react';

const CORS_PROXY_BASE = "https://xkca.dadalapathy756.workers.dev/?url=";

const LOCAL_STORAGE_VTT_KEY = 'movie_player_vtt_config';
const LOCAL_STORAGE_PGS_KEY = 'movie_player_pgs_config';

// Eagerly initialized out of scope to begin fetching before component mount (Fast TTFF)
const playerLibsPromise = typeof window !== 'undefined'
  ? Promise.all([
    import('artplayer').then(m => m.default),
    import('hls.js').then(m => m.default),
    import('artplayer-plugin-vtt-thumbnail').then(m => m.default).catch(() => null)
  ])
  : Promise.resolve([null, null, null]);

function generateProperResolvedHfPath(u: string): string {
  if (!u || typeof u !== 'string') return u;
  const sanitized = u.split('?download=true')[0].split('&download=true')[0];
  if (!sanitized.startsWith('https://huggingface.co/buckets/') || sanitized.includes('/resolve/')) return sanitized;
  const parts = sanitized.split('/');
  if (parts.length > 6) parts.splice(6, 0, 'resolve');
  return parts.join('/');
}

function getSplitRoutedUrl(rawAbsoluteUrl: string): string {
  const urlToFetch = generateProperResolvedHfPath(rawAbsoluteUrl);
  if (/\.(ts|mp4|m4s|webp|vtt)$/i.test(urlToFetch)) return urlToFetch;
  if (urlToFetch.includes('huggingface.co/buckets/')) return CORS_PROXY_BASE + encodeURIComponent(urlToFetch);
  return urlToFetch;
}

const createHfBucketsProxyLoader = (BaseLoader: any, proxyFn: (url: string) => string) => {
  return class HfBucketsProxyLoader extends BaseLoader {
    load(context: any, config: any, callbacks: any) {
      if (context.url) context.url = proxyFn(context.url);
      super.load(context, config, callbacks);
    }
  };
};

type SubTrack = { id: string; name: string; type: 'vtt' | 'pgs' | 'off'; hlsId?: number; url?: string };

export default function PlayerUI({ streamInfo }: { streamInfo: any }) {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<any>(null);
  const hlsRef = useRef<any>(null);

  const pgsCanvasRef = useRef<HTMLCanvasElement | null>(null);
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
  const [activeSubType, setActiveSubType] = useState<'vtt' | 'pgs' | 'none'>('none');

  // Subtitle Configuration State
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [vttConfig, setVttConfig] = useState({ size: 1.0, bottom: 5 });
  const [pgsConfig, setPgsConfig] = useState({ size: 0.8, bottom: 7 });
  const [isClientMounted, setIsClientMounted] = useState(false);

  const toggleSettingsMenuRef = useRef(() => setIsSettingsMenuOpen(prev => !prev));
  toggleSettingsMenuRef.current = () => setIsSettingsMenuOpen(prev => !prev);

  // Hydrate states from localStorage safely on client mount
  useEffect(() => {
    try {
      const savedVtt = localStorage.getItem(LOCAL_STORAGE_VTT_KEY);
      if (savedVtt) setVttConfig(JSON.parse(savedVtt));

      const savedPgs = localStorage.getItem(LOCAL_STORAGE_PGS_KEY);
      if (savedPgs) setPgsConfig(JSON.parse(savedPgs));
    } catch (e) {
      console.warn("Could not parse saved subtitle configurations.");
    }
    setIsClientMounted(true);
  }, []);

  // Sync VTT configs to localStorage
  useEffect(() => {
    if (isClientMounted) {
      localStorage.setItem(LOCAL_STORAGE_VTT_KEY, JSON.stringify(vttConfig));
    }
  }, [vttConfig, isClientMounted]);

  // Sync PGS configs to localStorage
  useEffect(() => {
    if (isClientMounted) {
      localStorage.setItem(LOCAL_STORAGE_PGS_KEY, JSON.stringify(pgsConfig));
    }
  }, [pgsConfig, isClientMounted]);

  useEffect(() => {
    if (pgsCanvasRef.current) {
      pgsCanvasRef.current.style.bottom = `${pgsConfig.bottom}%`;
      pgsCanvasRef.current.style.transform = `translateX(-50%) scale(${pgsConfig.size}) translateZ(0)`;
    }
  }, [pgsConfig.size, pgsConfig.bottom]);

  useEffect(() => {
    let isMounted = true;

    const initializePlayer = async () => {
      try {
        const manifestUrl = streamInfo._safe_manifest_url;
        const thumbsUrl = streamInfo._safe_timeline_thumbnails_url;

        const parsedPgs: SubTrack[] = (streamInfo.pgs_overlays || []).map((sub: any, idx: number) => ({
          id: `pgs_${idx}`,
          name: (sub.label || `Overlay ${idx + 1}`) + ' (Image)',
          type: 'pgs',
          url: sub._safe_url
        }));

        if (parsedPgs.length > 0) {
          setSubTracks([{ id: 'off', name: 'Off', type: 'off' }, ...parsedPgs]);
        }

        if (!pgsWorkerRef.current && typeof window !== 'undefined') {
          pgsWorkerRef.current = new Worker('/pgs-worker.js');
        }
        if (parsedPgs.length > 0 && parsedPgs[0].url) {
          pgsWorkerRef.current!.postMessage({ type: 'PRECACHE', url: parsedPgs[0].url });
        }

        const [Artplayer, Hls, VttThumbnailPlugin] = await playerLibsPromise;
        if (!Artplayer || !Hls || !isMounted || !playerContainerRef.current) return;

        const HfBucketsProxyLoader = createHfBucketsProxyLoader(Hls.DefaultConfig.loader, getSplitRoutedUrl);

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

        const hls = new Hls({
          loader: HfBucketsProxyLoader as any,
          enableWorker: true,
          maxBufferLength: dynamicMaxBufferLength,
          maxMaxBufferLength: dynamicMaxMaxBufferLength,
          maxBufferSize: dynamicMaxBufferSize,
          renderTextTracksNatively: true,
          // @ts-ignore
          subtitleDisplay: false as any
        });

        hlsRef.current = hls;

        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        });

        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
          if (data.audioTracks && data.audioTracks.length > 0) {
            const tracks = data.audioTracks.map((track: any, index: number) => {
              let rawName = track.name || track.lang || track.language || `Audio Track ${index + 1}`;
              if (rawName.startsWith('U_')) rawName = rawName.replace('U_', '');
              else if (rawName.startsWith('P_')) rawName = rawName.replace('P_', '');
              return { id: index, name: rawName };
            });
            setAudioTracks(tracks);
          }
        });

        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
          setActiveAudio(data.id);
        });

        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, data) => {
          if (data.subtitleTracks && data.subtitleTracks.length > 0) {
            const vttTracks: SubTrack[] = data.subtitleTracks.map((track: any, index: number) => ({
              id: `vtt_${index}`,
              hlsId: index,
              name: (track.name || track.lang || track.language || `Subtitle Track ${index + 1}`) + ' (Text)',
              type: 'vtt'
            }));

            setSubTracks(prev => {
              const existingPgs = prev.filter(p => p.type === 'pgs');
              return [{ id: 'off', name: 'Off', type: 'off' }, ...vttTracks, ...existingPgs];
            });

            if (hls.subtitleTrack !== -1) {
              setActiveSub(`vtt_${hls.subtitleTrack}`);
              activeSubTypeRef.current = 'vtt';
              setActiveSubType('vtt');
            }
          }
        });

        hls.loadSource(manifestUrl);

        const subtitleSvg = `<svg width="25" height="25" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path fill="none" stroke="currentColor"/>
        <path d="M9.954 2.21a9.99 9.99 0 0 1 4.091-.002A3.993 3.993 0 0 0 16 5.07a3.993 3.993 0 0 0 3.457.261A9.99 9.99 0 0 1 21.5 8.876 3.993 3.993 0 0 0 20 12c0 1.264.586 2.391 1.502 3.124a10.043 10.043 0 0 1-2.046 3.543 3.993 3.993 0 0 0-3.456.261 3.993 3.993 0 0 0-1.954 2.86 9.99 9.99 0 0 1-4.091.004A3.993 3.993 0 0 0 8 18.927a3.993 3.993 0 0 0-3.457-.26A9.99 9.99 0 0 1 2.5 15.121 3.993 3.993 0 0 0 4 11.999a3.993 3.993 0 0 0-1.502-3.124 10.043 10.043 0 0 1 2.046-3.543A3.993 3.993 0 0 0 8 5.071a3.993 3.993 0 0 0 1.954-2.86zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
        </svg>`;

        const artOptions: any = {
          container: playerContainerRef.current,
          url: manifestUrl,
          type: 'm3u8',
          volume: 0.9,
          autoplay: true,
          setting: false,
          fullscreen: true,
          subtitle: { url: '', type: 'srt' },
          controls: [
            {
              position: 'right',
              html: `<div class="art-control-subtitle" style="display: flex; align-items: center; justify-content: center; padding: 0 10px; cursor: pointer; height: 100%; transition: color 0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='inherit'">${subtitleSvg}</div>`,
              index: 10,
              tooltip: 'Subtitle Context Menu',
              click: function () {
                toggleSettingsMenuRef.current();
              },
            }
          ],
          plugins: [
            ...(thumbsUrl && VttThumbnailPlugin ? [VttThumbnailPlugin({
              vtt: thumbsUrl,
              style: {
                border: '2px solid #ddcfcf',
                borderRadius: '4px',
                boxShadow: '0 2px 5px rgba(0, 0, 0)',
                scale: '1.2',
                marginBottom: '25px'
              }
            })] : [])
          ],
          customType: {
            m3u8: function (video: HTMLVideoElement, url: string, artInstance: any) {
              if (Hls.isSupported()) {
                hls.attachMedia(video);
                artInstance.hls = hls;
                artInstance.on('destroy', () => hls.destroy());
              } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
              }
            }
          }
        };

        artRef.current = new Artplayer(artOptions);

        artRef.current.on('ready', () => {
          if (pgsCanvasRef.current) {
            pgsCanvasRef.current.remove();
          }

          const canvas = document.createElement('canvas');
          pgsCanvasRef.current = canvas;

          canvas.style.position = 'absolute';
          // Use current config state refs since it may have hydrated before Artplayer initialized
          canvas.style.bottom = `${pgsConfig.bottom}%`;
          canvas.style.left = '50%';
          canvas.style.transform = `translateX(-50%) scale(${pgsConfig.size}) translateZ(0)`;
          canvas.style.transformOrigin = 'bottom center';
          canvas.style.maxWidth = '100%';
          canvas.style.maxHeight = '20%';
          canvas.style.objectFit = 'contain';
          canvas.style.pointerEvents = 'none';
          canvas.style.zIndex = '20';
          canvas.style.willChange = 'contents, transform';
          canvas.style.backfaceVisibility = 'hidden';

          artRef.current.template.$player.appendChild(canvas);

          // @ts-ignore
          const offscreen = canvas.transferControlToOffscreen();
          pgsWorkerRef.current!.postMessage({ type: 'INIT', canvas: offscreen }, [offscreen]);


          const video = artRef.current.video;
          const subtitleDom = artRef.current.template.$subtitle;
          const activeTrackListeners = new Map();

          if (subtitleDom) {
            const renderCues = (event: Event) => {
              const track = event.target as TextTrack;
              if (!['hidden', 'showing'].includes(track.mode)) return;

              const cues = track.activeCues;
              if (!cues || cues.length === 0) {
                subtitleDom.innerHTML = '';
                subtitleDom.style.display = 'none';
                return;
              }

              const activeText = Array.from(cues)
                .map((c: any) => c.text.replace(/\n/g, '<br>'))
                .join('<br>');

              subtitleDom.innerHTML = activeText;
              subtitleDom.style.display = 'block';
            };

            const bindTrack = (track: TextTrack) => {
              if (track.kind === 'subtitles' || track.kind === 'captions') {
                track.mode = 'hidden';
                if (!activeTrackListeners.has(track)) {
                  track.addEventListener('cuechange', renderCues);
                  activeTrackListeners.set(track, renderCues);
                }
              }
            };

            (Array.from(video.textTracks) as TextTrack[]).forEach(bindTrack);
            video.textTracks.addEventListener('addtrack', (e: TrackEvent) => {
              if (e.track) bindTrack(e.track);
            });

            video.textTracks.addEventListener('change', () => {
              (Array.from(video.textTracks) as TextTrack[]).forEach((track: TextTrack) => {
                if (track.mode === 'showing') track.mode = 'hidden';
              });
            });
          }

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
        pgsWorkerRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (artRef.current) {
        artRef.current.destroy(true);
        artRef.current = null;
      }
      if (pgsCanvasRef.current) {
        pgsCanvasRef.current.remove();
        pgsCanvasRef.current = null;
      }
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
    const subtitleDom = artRef.current.template.$subtitle;
    if (track.type === 'vtt') {
      activeSubTypeRef.current = 'vtt';
      setActiveSubType('vtt');
      if (hlsRef.current && track.hlsId !== undefined) hlsRef.current.subtitleTrack = track.hlsId;
      if (pgsWorkerRef.current) pgsWorkerRef.current.postMessage({ type: 'CLEAR' });
    } else if (track.type === 'pgs') {
      activeSubTypeRef.current = 'pgs';
      setActiveSubType('pgs');
      if (hlsRef.current) hlsRef.current.subtitleTrack = -1;

      if (pgsWorkerRef.current) {
        pgsWorkerRef.current.postMessage({ type: 'LOAD', url: track.url });
        lastSentTimeRef.current = -1;
      }
    } else {
      activeSubTypeRef.current = 'none';
      setActiveSubType('none');
      if (hlsRef.current) hlsRef.current.subtitleTrack = -1;
      if (pgsWorkerRef.current) pgsWorkerRef.current.postMessage({ type: 'CLEAR' });
      if (subtitleDom) subtitleDom.innerHTML = '';
    }
    setActiveSub(track.id);
  };

  return (
    <>
      <div
        className="w-full aspect-video bg-neutral-950 relative border-b border-neutral-900 mt-0 group overflow-hidden"
        style={{
          '--vtt-size': vttConfig.size,
          '--vtt-bottom': vttConfig.bottom
        } as React.CSSProperties}
      >
        {isSettingsMenuOpen && (
          <div className="absolute bottom-16 right-4 bg-black/80 backdrop-blur-md border border-neutral-800 p-6 rounded-2xl z-[9999] flex flex-col gap-5 min-w-[320px] shadow-2xl transition-opacity animate-in fade-in slide-in-from-bottom-2 duration-100">
            <div className="flex justify-between items-center mb-1">
              <h3 className="text-white font-bold tracking-widest uppercase text-sm">
                {activeSubType === 'vtt' ? 'Text Subtitle Settings' : activeSubType === 'pgs' ? 'Image Subtitle Settings' : 'Subtitle Settings'}
              </h3>
              <button onClick={() => setIsSettingsMenuOpen(false)} className="text-neutral-400 hover:text-white transition-colors">✕</button>
            </div>

            {activeSubType === 'none' ? (
              <div className="text-xs text-neutral-400 py-4 text-center font-medium">Select a subtitle track to adjust settings.</div>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  <label className="text-xs text-neutral-400 flex justify-between font-semibold uppercase tracking-wider">
                    <span>Scale Size</span>
                    <span className="text-white">
                      {Math.round((activeSubType === 'vtt' ? vttConfig.size : pgsConfig.size) * 100)}%
                    </span>
                  </label>
                  <input
                    type="range" min="0.2" max="2.0" step="0.05"
                    value={activeSubType === 'vtt' ? vttConfig.size : pgsConfig.size}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (activeSubType === 'vtt') setVttConfig(p => ({ ...p, size: val }));
                      else setPgsConfig(p => ({ ...p, size: val }));
                    }}
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                </div>
                <div className="flex flex-col gap-3">
                  <label className="text-xs text-neutral-400 flex justify-between font-semibold uppercase tracking-wider">
                    <span>Vertical Height</span>
                    <span className="text-white">
                      {activeSubType === 'vtt' ? vttConfig.bottom : pgsConfig.bottom}%
                    </span>
                  </label>
                  <input
                    type="range" min="0" max="100" step="1"
                    value={activeSubType === 'vtt' ? vttConfig.bottom : pgsConfig.bottom}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (activeSubType === 'vtt') setVttConfig(p => ({ ...p, bottom: val }));
                      else setPgsConfig(p => ({ ...p, bottom: val }));
                    }}
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-600 text-sm tracking-widest uppercase">
            Initializing Stream Instance...
          </div>
        )}

        {errorMsg && (
          <div className="absolute inset-0 flex flex-col gap-4 items-center justify-center bg-black z-40">
            <span className="text-red-500 text-sm tracking-widest uppercase border border-red-500/30 px-4 py-2 rounded">Stream Failure</span>
            <span className="text-neutral-400 text-xs">{errorMsg}</span>
          </div>
        )}

        <div ref={playerContainerRef} className="w-full h-full absolute inset-0 z-10" />
      </div>

      {!isLoading && !errorMsg && (
        <div className="w-full max-w-screen-2xl mx-auto p-4 md:p-8 flex flex-col md:flex-row justify-between gap-8">
          <div className="flex flex-col gap-3">
            <span className="text-xs text-neutral-600 uppercase tracking-widest font-semibold">Audio Override</span>
            <div className="flex flex-wrap gap-2 bg-neutral-950 p-2 rounded-2xl border border-neutral-900 w-fit">
              {audioTracks.length > 0 ? (
                audioTracks.map((track) => (
                  <button
                    key={track.id} onClick={() => switchAudio(track.id)}
                    className={`px-4 py-2 rounded-xl text-xs tracking-wider transition-all duration-200 ${activeAudio === track.id ? 'bg-white text-black font-bold shadow-md' : 'bg-transparent text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}`}
                  >{track.name}</button>
                ))
              ) : (<span className="px-4 py-2 text-xs text-neutral-700">No alternate audio</span>)}
            </div>
          </div>

          <div className="flex flex-col gap-3 md:items-end">
            <div className="flex items-center gap-3">
              <span className="text-xs text-neutral-600 uppercase tracking-widest font-semibold">Subtitle Override</span>
            </div>
            <div className="flex flex-wrap gap-2 bg-neutral-950 p-2 rounded-2xl border border-neutral-900 w-fit justify-end">
              {subTracks.length > 0 ? (
                subTracks.map((sub) => (
                  <button
                    key={sub.id} onClick={() => switchSubtitle(sub)}
                    className={`px-4 py-2 rounded-xl text-xs tracking-wider transition-all duration-200 ${activeSub === sub.id ? 'bg-blue-500 text-white font-bold shadow-md shadow-blue-500/20' : 'bg-transparent text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}`}
                  >{sub.name}</button>
                ))
              ) : (<span className="px-4 py-2 text-xs text-neutral-700">No alternate subtitles</span>)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}