import Link from 'next/link'
import Image from 'next/image'
import { getMediaDetails } from '@/lib/catalog'

export default async function WatchPage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await props.params
  const searchParams = await props.searchParams

  const { id } = params
  const activeSeason = searchParams.season as string | undefined

  const data = await getMediaDetails(id)

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center text-neutral-500 font-mono tracking-widest flex-col gap-4">
        <span>404 | ASSET NOT FOUND</span>
      </div>
    )
  }

  const isSeries = data.type === 'series'
  const showEpisodeView = isSeries && activeSeason && data.seasons

  const activeSeasonData = showEpisodeView ? data.seasons?.find(s => s.season_number === Number(activeSeason)) : null
  const activeEpisodes = activeSeasonData ? activeSeasonData.episodes : []

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
              className="object-cover object-right-top brightness-75"
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
              className="h-full w-auto object-contain rounded-xl p-1 shadow-2xl"
              priority
            />
          </div>

          <div className={`flex-1 md:px-12 lg:px-16 select-none h-full flex flex-col ${showEpisodeView ? 'mt-24 pb-24 overflow-y-auto custom-scrollbar' : 'mt-50 justify-center'}`}>

            {!showEpisodeView && (
              <div className="max-w-3xl flex flex-col gap-4">
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight drop-shadow-xl">{data.title}</h1>

                <div className="flex gap-3 text-sm text-neutral-300 drop-shadow-md">
                  <span>{data.year}</span>
                  <span>•</span>
                  <span className="text-yellow-400">★ {data.rating || 'N/A'}</span>
                </div>

                {data.overview && (
                  <p className="text-sm text-neutral-400 mt-2 max-w-xl leading-relaxed">{data.overview}</p>
                )}


                {data.type === 'movie' && data.sources && (
                  <div className="mt-4 bg-black p-6 rounded-md shadow-2xl flex flex-col gap-4 border border-neutral-900">
                    <h3 className="text-neutral-500 font-mono text-xs uppercase tracking-widest">Select Source</h3>
                    <div className="flex flex-wrap gap-4">
                      {data.sources.map((src) => {
                        // Determine resolution based on string matches
                        const is2160p = src.quality?.includes('2160p') || src.variation_name?.includes('2160p');
                        const is1080p = src.quality?.includes('1080') || src.variation_name?.includes('1080');

                        return (
                          <Link
                            key={src.id}
                            prefetch={false} // CRITICAL FIX: Eradicates DDOS network load spikes
                            href={`/watch/${id}/play?streamId=${src.id}`}
                            className="px-3 py-2 rounded-md border-2 border-neutral-900/10 hover:border-neutral-200 transition-colors duration-50 bg-neutral-900/30 flex items-center gap-2"
                          >
                            {/* 1. Resolution Badge */}
                            {is2160p ? (
                              <Image src="/2160p.png" alt="2160p" width={75} height={25} className="object-contain" />
                            ) : is1080p ? (
                              <Image src="/1080.png" alt="1080p" width={75} height={25} className="object-contain" />
                            ) : (
                              <span className="font-mono text-sm tracking-widest text-neutral-300">
                                {src.variation_name || src.quality}
                              </span>
                            )}

                            {/* 2. IMAX Badge */}
                            {!!src.is_imax && (
                              <Image src="/imax.png" alt="IMAX" width={150} height={30} className="object-contain" />
                            )}

                            {/* 3. HDR / SDR Badge */}
                            {!!src.is_hdr ? (
                              <Image src="/hdr.png" alt="HDR" width={75} height={25} className="object-contain" />
                            ) : (
                              <Image src="/sdr.png" alt="SDR" width={75} height={25} className="object-contain" />
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}

                {data.type === 'series' && data.seasons && (
                  <div className="mt-4 bg-black p-6 rounded-md shadow-2xl flex flex-col gap-4 border border-neutral-900">
                    <h3 className="text-neutral-500 font-mono text-xs uppercase tracking-widest">Select Season</h3>
                    <div className="flex flex-wrap gap-4">
                      {data.seasons.map((season) => (
                        <Link
                          key={season.season_number}
                          prefetch={false}
                          href={`/watch/${id}?season=${season.season_number}`}
                          className="px-6 py-3 rounded-lg border-2 border-neutral-800 hover:border-neutral-400 hover:text-white text-neutral-300 transition-colors font-mono text-sm tracking-widest bg-neutral-900/50 hover:bg-neutral-800 text-center"
                        >
                          Season {season.season_number}
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
                  <Link href={`/watch/${id}`} className="text-neutral-200 hover:text-white font-mono text-xs tracking-widest uppercase mb-2 w-fit">
                    ← Back to Seasons
                  </Link>
                  <h2 className="text-xl md:text-2xl font-bold tracking-wide text-neutral-400 uppercase">
                    {data.title} <span className="text-neutral-600 mx-2">•</span> <span className="text-neutral-100">Season {activeSeason}</span>
                  </h2>
                </div>

                <div className="flex flex-col gap-3">
                  {activeEpisodes.map((ep) => (
                    <Link
                      key={ep.id}
                      prefetch={false} // CRITICAL FIX: Stops UI freezing on large episodic renders
                      href={`/watch/${id}/play?streamId=${ep.id}`}
                      className="flex items-center justify-between p-4 bg-neutral-900/40 rounded-xl transition-all duration-100 group hover:bg-neutral-900 hover:translate-x-2 border border-transparent hover:border-neutral-800"
                    >
                      <span className="text-base font-medium text-neutral-300 group-hover:text-white flex items-center gap-4">
                        <span className="text-neutral-600 font-mono text-sm bg-black px-2 py-1 rounded-md min-w-[3rem] text-center">
                          E{ep.episode_number.toString().padStart(2, '0')}
                        </span>
                        {ep.episode_name || `Episode ${ep.episode_number}`}
                      </span>

                      {ep.quality && (
                        <span className="text-[10px] font-mono text-neutral-500 uppercase bg-black px-2 py-1 rounded-md group-hover:border-neutral-600">
                          {ep.quality}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}