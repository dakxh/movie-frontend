import Link from 'next/link'
import Image from 'next/image'
import { getHomeCatalog } from '@/lib/catalog'
import SearchOverlay from '@/components/SearchOverlay';

export const revalidate = 3

export default async function CatalogGrid() {
  const catalog = await getHomeCatalog(24, 0)

  return (
    <main className="max-w-screen-2xl mx-auto p-4 md:p-8">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6 md:gap-6 xl:gap-4">
        {catalog.map((item, i) => (
          <Link
            key={item.id}
            href={`/watch/${item.id}`}
            className="group relative flex flex-col gap-2 hover:-translate-y-1 transition-transform"
          >
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded bg-neutral-900">
              <Image
                src={item.poster_url}
                alt={item.title}
                fill
                priority={i < 12}
                sizes="(max-width:640px) 50vw, (max-width:768px) 33vw, (max-width:1024px) 25vw, (max-width:1280px) 16vw, 14vw"
                className="object-cover"
              />
              <div className="absolute top-1 right-1 bg-neutral-950/80 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-mono uppercase text-white shadow-md">
                {item.type}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-medium leading-tight line-clamp-1 group-hover:text-white">
                {item.title}
              </h2>
              <p className="text-xs text-neutral-500 font-mono mt-0.5 flex gap-2">
                <span>{item.year}</span>
                {item.rating > 0 && <span className="text-yellow-500/80">★ {item.rating}</span>}
              </p>
            </div>
          </Link>
        ))}
      </div>
      <SearchOverlay />
    </main>
  )
}