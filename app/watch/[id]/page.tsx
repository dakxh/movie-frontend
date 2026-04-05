import { preload } from 'react-dom'
import Link from 'next/link'
import Image from 'next/image'
import { getCatalogData } from '@/lib/catalog'

interface Episode {
  season_number: number
  episode_number: number
  episode_name: string
  quality: string
  date_added: number
  hls_manifest_url: string
}

interface DeepMetadata {
  id: number
  type: 'movie' | 'series'
  title: string
  year: string
  rating: number
  source: string
  quality: string
  duration?: string
  average_duration?: string
  IMAX?: boolean
  HDR: boolean
  poster_url: string
  backdrop_url?: string
  overview: string
  date_added: number
  available_audio?: string[]
  available_subs?: string[]
  hls_manifest_url?: string
  episodes?: Episode[]
  available_variations?: string[]
  metadata_url?: Record<string, string>
}

// 1. THE TIMEOUT WRAPPER: Used for Deep Metadata fetches
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// Notice we REMOVED generateStaticParams() completely. 
// We are now doing "On-Demand ISR". This spreads the network load across 
// user clicks rather than bombarding HF all at once during server boot.

async function fetchDeepMetadata(id: string): Promise<DeepMetadata | null> {
  // DATA LAYER: O(1) Instant Dictionary Lookup
  const { catalogMap } = await getCatalogData()
  const entry = catalogMap.get(id)
  
  if (!entry) return null

  let metaUrl = ''
  let variations: string[] = []
  let rawManifestUrls: Record<string, string> | undefined = undefined

  if (entry.type === 'movie' && entry.hls_manifest_url) {
    variations = Object.keys(entry.hls_manifest_url)
    metaUrl = entry.hls_manifest_url[variations[0]]
      .replace('master.m3u8', 'metadata.json')
      .replace('/xkca/', '/xkca/resolve/')
    rawManifestUrls = entry.hls_manifest_url
  } else if (entry.type === 'series' && entry.series_metadata_url) {
    metaUrl = entry.series_metadata_url.replace('/xkca/', '/xkca/resolve/')
  } else {
    return null
  }

  try {
    // 2. TIMEOUT INJECTION: Protects the server from hanging on this specific movie
    const metaRes = await fetchWithTimeout(metaUrl, { next: { revalidate: 3600 } }, 5000)
    if (!metaRes.ok) return null

    const deepMetadata: DeepMetadata = await metaRes.json()

    if (variations.length > 0) {
      deepMetadata.available_variations = variations
      deepMetadata.metadata_url = rawManifestUrls 
    }

    return deepMetadata
  } catch (error) {
    console.error(`🚨 Metadata fetch failed or timed out for ID: ${id}`, error);
    return null;
  }
}

function groupEpisodesBySeason(episodes: Episode[]) {
  const grouped: Record<number, Episode[]> = {}
  episodes.forEach(ep => {
    if (!grouped[ep.season_number]) {
      grouped[ep.season_number] = []
    }
    grouped[ep.season_number].push(ep)
  })
  return grouped
}

export default async function WatchPage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await props.params
  const searchParams = await props.searchParams

  const { id } = params
  const activeSeason = searchParams.season as string | undefined

  const data = await fetchDeepMetadata(id)

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center text-neutral-500 font-mono tracking-widest flex-col gap-4">
        <span>404 | ASSET NOT FOUND</span>
        <span className="text-xs text-neutral-600">(Or Hugging Face Sync Delayed)</span>
      </div>
    )
  }

  if (data.type === 'movie' && data.hls_manifest_url) {
    preload(data.hls_manifest_url, { as: 'fetch', crossOrigin: 'anonymous' })
  }

  const isSeries = data.type === 'series'
  const groupedSeasons = isSeries && data.episodes ? groupEpisodesBySeason(data.episodes) : null
  const showEpisodeView = isSeries && activeSeason && groupedSeasons && groupedSeasons[Number(activeSeason)]
  const activeEpisodes = showEpisodeView ? groupedSeasons[Number(activeSeason)] : []

  // 3. THE BLEED IS GONE: We deleted the background fetch() loop here.
  // We now rely purely on the user's browser processing `<Link prefetch={true}>` 

  return (
    <main className="bg-black text-white">
      <section className="relative h-screen w-full overflow-hidden bg-black">

        {!showEpisodeView && data.backdrop_url && (
          <div className="absolute top-0 right-0 w-[90vw] h-[85vh] lg:w-[80vw] lg:h-[85vh]">
            <Image
              src={data.backdrop_url}
              alt=""
              fill
              priority
              className="object-contain object-right-top brightness-75"
            />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/10 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 top-[70dvh] h-[10dvh] bg-gradient-to-b from-transparent via-black/50 to-black pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 top-[80dvh] bg-black pointer-events-none" />

        <div className="relative z-10 h-full w-full flex items-center justify-start">
          <div className="h-full shrink-0">
            <Image
              src={data.poster_url}
              alt={data.title}
              width={600}
              height={900}
              className="h-full w-auto object-contain rounded-xl p-1"
              priority
            />
          </div>

          <div className={`flex-1 md:px-12 lg:px-16 select-none h-full flex flex-col ${showEpisodeView ? 'mt-24 pb-24 overflow-y-auto custom-scrollbar' : 'mt-50 justify-center'}`}>

            {!showEpisodeView && (
              <div className="max-w-3xl flex flex-col gap-4">
                <h1 className="text-4xl md:text-4xl font-bold tracking-tight drop-shadow-lg">
                  {data.title}
                </h1>

                <div className="flex gap-3 text-sm text-neutral-300 drop-shadow-md">
                  <span>{data.year}</span>
                  <span>•</span>
                  <span>{data.duration || data.average_duration || 'N/A'}</span>
                  <span>•</span>
                  <span className="text-yellow-400">★ {data.rating}</span>
                </div>

                {data.type === 'movie' && data.available_variations && data.metadata_url && (
                  <div className="mt-4 bg-black p-6 rounded-md shadow-2xl flex flex-col gap-4">
                    <h3 className="text-neutral-500 font-mono text-xs uppercase tracking-widest">Select Quality</h3>
                    <div className="flex flex-wrap gap-4">
                      {data.available_variations.map((variation) => (
                        <Link
                          key={variation}
                          prefetch={true} 
                          href={`/watch/${id}/play?metaUrl=${encodeURIComponent(data.metadata_url![variation].replace('master.m3u8', 'metadata.json'))}`}
                          className="px-6 py-3 rounded-lg border-2 border-neutral-800 hover:border-neutral-400 hover:text-white text-neutral-300 transition-colors font-mono text-sm tracking-widest bg-neutral-900/50 hover:bg-neutral-800 text-center"
                        >
                          {variation}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {data.type === 'series' && groupedSeasons && Object.keys(groupedSeasons).length > 0 && (
                  <div className="mt-4 bg-black p-6 rounded-md shadow-2xl flex flex-col gap-4">
                    <h3 className="text-neutral-500 font-mono text-xs uppercase tracking-widest">Select Season</h3>
                    <div className="flex flex-wrap gap-4">
                      {Object.keys(groupedSeasons).map((seasonNum) => (
                        <Link
                          key={seasonNum}
                          href={`/watch/${id}?season=${seasonNum}`}
                          className="px-6 py-3 rounded-lg border-2 border-neutral-800 hover:border-neutral-400 hover:text-white text-neutral-300 transition-colors font-mono text-sm tracking-widest bg-neutral-900/50 hover:bg-neutral-800 text-center"
                        >
                          Season {seasonNum}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {showEpisodeView && (
              <div className="max-w-3xl flex flex-col w-full pr-8">
                <div className="mb-8 flex flex-col gap-2">
                  <Link
                    href={`/watch/${id}`}
                    className="text-neutral-200 hover:text-white font-mono text-xs tracking-widest uppercase mb-2 w-fit"
                  >
                    ← Back to Seasons
                  </Link>
                  <h2 className="text-xl md:text-2xl font-bold tracking-wide text-neutral-400 uppercase">
                    {data.title} <span className="text-neutral-600 mx-2">•</span> <span className="text-neutral-100">Season {activeSeason}</span>
                  </h2>
                </div>

                <div className="flex flex-col gap-3">
                  {activeEpisodes.map((ep) => {
                    const episodeMetaUrl = ep.hls_manifest_url
                      .replace('master.m3u8', 'metadata.json')
                      .replace('/xkca/', '/xkca/resolve/')

                    return (
                      <Link
                        key={`${ep.season_number}-${ep.episode_number}`}
                        prefetch={true} 
                        href={`/watch/${id}/play?metaUrl=${encodeURIComponent(episodeMetaUrl)}`}
                        className="flex items-center justify-between p-4 bg-neutral-900/40 rounded-xl transition-all duration-100 group hover:bg-neutral-900 hover:translate-x-2"
                      >
                        <span className="text-base font-medium text-neutral-300 group-hover:text-white flex items-center gap-4">
                          <span className="text-neutral-600 font-mono text-sm bg-black px-2 py-1 rounded-md">
                            E{ep.episode_number.toString().padStart(2, '0')}
                          </span>
                          {ep.episode_name}
                        </span>

                        <span className="text-[10px] font-mono text-neutral-500 uppercase bg-black px-2 py-1 rounded-md group-hover:border-neutral-600">
                          {ep.quality || '1080p'}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}