import { preload } from 'react-dom'
import Link from 'next/link'
import Image from 'next/image'

const CATALOG_URL = 'https://huggingface.co/buckets/nookaharsha/anime/resolve/global_catalog.json'

interface CatalogItem {
  id: number
  type: 'movie' | 'anime'
  metadata_url?: Record<string, string>
  series_metadata_url?: string
}

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
  type: 'movie' | 'anime'
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
}

async function fetchDeepMetadata(id: string): Promise<DeepMetadata | null> {
  const catRes = await fetch(CATALOG_URL, { next: { revalidate: 3600 } })

  if (!catRes.ok) return null

  const catalog: CatalogItem[] = await catRes.json()
  const entry = catalog.find((i) => i.id.toString() === id)

  if (!entry) return null

  let metaUrl = ''
  let variations: string[] = []

  if (entry.type === 'movie' && entry.metadata_url) {
    variations = Object.keys(entry.metadata_url)
    metaUrl = entry.metadata_url[variations[0]] 
  } else if (entry.type === 'anime' && entry.series_metadata_url) {
    metaUrl = entry.series_metadata_url
  } else {
    return null
  }

  const metaRes = await fetch(metaUrl, { cache: 'no-store' })

  if (!metaRes.ok) return null

  const deepMetadata: DeepMetadata = await metaRes.json()
  
  if (variations.length > 0) {
    deepMetadata.available_variations = variations
  }

  return deepMetadata
}

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await fetchDeepMetadata(id)

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center text-neutral-500 font-mono tracking-widest">
        404 | ASSET NOT FOUND
      </div>
    )
  }

  if (data.type === 'movie' && data.hls_manifest_url) {
    preload(data.hls_manifest_url, { as: 'fetch', crossOrigin: 'anonymous' })
  }

  return (
    <main className="bg-black text-white">

      {/* HERO */}
      <section className="relative h-screen w-full overflow-hidden bg-black">

        {/* BACKDROP - Scaled down and pinned to top-right with its cutoff within the container */}
        {data.backdrop_url && (
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

        {/* --- DYNAMIC & PRECISE MASKS --- */}

        {/* 1. LEFT DARK MASK (HORIZONTAL) - Provides horizontal fading and left-side masking */}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/10 to-transparent pointer-events-none" />

        {/* 2. PRECISION BOTTOM FADE (VERTICAL) - Feathers the transition just before the solid mask */}
        <div className="absolute inset-x-0 top-[70dvh] h-[10dvh] bg-gradient-to-b from-transparent via-black/50 to-black pointer-events-none" />

        {/* 3. SOLID PURE BLACK MASK (THE FLOOR) - Guarantees pure black background from this precise point down */}
        <div className="absolute inset-x-0 bottom-0 top-[80dvh] bg-black pointer-events-none" />

        {/* ------------------------------- */}

        {/* CONTENT LAYOUT */}
        <div className="relative z-10 h-full w-full flex items-center justify-start">
          
          {/* POSTER */}
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

          {/* TEXT CONTENT */}
          <div className="flex-1 mt-50 md:px-12 lg:px-16 select-none">
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

              <div className="flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-wider drop-shadow-md">
                <Badge text={data.quality || '1080P'} />
                <Badge text={data.source} />
                {data.HDR && <Badge text="HDR / DV" highlight />}
                {data.IMAX && <Badge text="IMAX ENHANCED" highlight />}
                {data.available_audio && <Badge text={`${data.available_audio.length} AUDIO`} />}
                {data.available_subs && <Badge text={`${data.available_subs.length} SUBS`} />}
              </div>

              {/* <p className="text-neutral-300 text-sm leading-relaxed border-l border-neutral-700 pl-4 drop-shadow-md">
                {data.overview}
              </p> */}

              {/* QUALITIES SELECTOR BOX */}
              {data.type === 'movie' && data.available_variations && data.available_variations.length > 0 && (
                <div className="mt-4 bg-black p-6 rounded-md shadow-2xl flex flex-col gap-4">
                  <h3 className="text-neutral-500 font-mono text-xs uppercase tracking-widest">Select Quality</h3>
                  <div className="flex flex-wrap gap-4">
                    {data.available_variations.map((variation) => (
                      <button
                        key={variation}
                        className="px-6 py-3 rounded-lg border-2 border-neutral-800 hover:border-neutral-400 hover:text-white text-neutral-300 transition-colors font-mono text-sm tracking-widest bg-neutral-900/50 hover:bg-neutral-800"
                      >
                        {variation}
                      </button>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

      </section>

      {/* CONTENT
      <section className="px-16 py-12">

        {data.type === 'anime' && (
          <EpisodeList episodes={data.episodes || []} />
        )}

      </section> */}

    </main>
  )
}

function Badge({ text, highlight = false }: { text: string, highlight?: boolean }) {
  return (
    <span
      className={`px-2 py-1 rounded border ${highlight
          ? 'bg-neutral-800 border-neutral-500 text-neutral-200'
          : 'bg-neutral-900 border-neutral-800 text-neutral-500'
        }`}
    >
      {text}
    </span>
  )
}

function EpisodeList({ episodes }: { episodes: Episode[] }) {
  if (episodes.length === 0)
    return <div className="text-neutral-600 font-mono text-sm">NO EPISODES FOUND</div>

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-mono text-xs tracking-widest text-neutral-500 mb-2 uppercase">
        Episodes Directory
      </h3>

      {episodes.map((ep) => (
        <Link
          key={`${ep.season_number}-${ep.episode_number}`}
          href={`/watch/series/play?manifest=${encodeURIComponent(ep.hls_manifest_url)}&title=${encodeURIComponent(ep.episode_name)}`}
          className="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-900 hover:border-neutral-700 rounded transition-colors group"
        >
          <span className="text-sm font-medium text-neutral-300 group-hover:text-white">
            <span className="text-neutral-600 font-mono mr-3">
              S{ep.season_number.toString().padStart(2, '0')} E{ep.episode_number.toString().padStart(2, '0')}
            </span>
            {ep.episode_name}
          </span>

          <span className="text-[10px] font-mono text-neutral-600 uppercase border border-neutral-800 px-1.5 py-0.5 rounded">
            {ep.quality || '1080p'}
          </span>
        </Link>
      ))}
    </div>
  )
}