import Link from 'next/link'
import Image from 'next/image'

const CATALOG_URL = 'https://huggingface.co/buckets/Gravatar44/xkca/resolve/global_catalog.json'

interface CatalogItem {
  id: number
  type: 'movie' | 'series'
  title: string
  year: string
  date_added: number
  available_resolutions?: string[]
  available_variations?: string[]
  hls_manifest_url?: Record<string, string>
  series_metadata_url?: string
  poster_url: string
}

export const revalidate = 3

export default async function CatalogGrid() {
  const res = await fetch(CATALOG_URL, {
    next: { revalidate: 3 }
  })

  const catalog: CatalogItem[] = await res.json()

  return (
    <main className="max-w-screen-2xl mx-auto p-4 md:p-8">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6 md:gap-6 xl:gap-4">
        {catalog.map((item, i) => (
          <Link
            key={item.id}
            href={`/watch/${item.id}`}
            prefetch={false}
            className="group relative flex flex-col gap-2 hover:-translate-y-1 transition-transform"
          >
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded bg-neutral-900">
              <Image
                src={item.poster_url}
                alt={item.title}
                fill
                priority={i < 6}
                sizes="(max-width:640px) 50vw, (max-width:768px) 33vw, (max-width:1024px) 25vw, (max-width:1280px) 16vw, 14vw"
                className="object-cover"
              />
              <div className="absolute top-1 right-1 bg-neutral-950/80 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-mono uppercase">
                {item.type}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-medium leading-tight line-clamp-1 group-hover:text-white">
                {item.title}
              </h2>
              <p className="text-xs text-neutral-500 font-mono mt-0.5">
                {item.year}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </main>
  )
}
