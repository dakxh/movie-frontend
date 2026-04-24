"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchMoreCatalog } from "@/app/actions";
import { CatalogPayload } from "@/lib/catalog";

interface InfiniteCatalogGridProps {
  initialData: CatalogPayload;
}

export default function InfiniteCatalogGrid({ initialData }: InfiniteCatalogGridProps) {
  const observerRef = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["catalog", "home"],
    queryFn: async ({ pageParam }) => {
      // Fetch 6 items at a time for subsequent pages, using the pageParam as the cursor
      return await fetchMoreCatalog(6, pageParam as number);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    // Safely hydrate the cache with the server-side payload
    initialData: {
      pages: [initialData],
      pageParams: [0],
    },
  });

  // Flatten the array of pages into a single continuous list of media items
  const items = data?.pages.flatMap((page) => page.data) || [];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Only trigger fetch if we are intersecting, have more pages, and aren't already fetching
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1, rootMargin: "600px" } // Trigger earlier to hide network latency
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6 md:gap-6 xl:gap-4">
        {items.map((item, i) => (
          <Link
            key={`${item.id}-${i}`}
            href={`/watch/${item.id}`}
            className="group relative flex flex-col gap-2 hover:-translate-y-1 transition-transform duration-300 ease-out animate-in fade-in slide-in-from-bottom-4"
          >
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded bg-neutral-900 shadow-sm transition-shadow group-hover:shadow-md group-hover:shadow-black/50">
              <Image
                src={item.poster_url}
                alt={item.title}
                fill
                priority={i < 12}
                sizes="(max-width:640px) 50vw, (max-width:768px) 33vw, (max-width:1024px) 25vw, (max-width:1280px) 16vw, 14vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute top-1 right-1 bg-neutral-950/80 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-mono uppercase text-white shadow-md">
                {item.type}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-medium leading-tight line-clamp-1 group-hover:text-neutral-200 transition-colors">
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
      
      {/* Intersection Target */}
      <div ref={observerRef} className="w-full flex justify-center py-12 h-24">
        {isFetchingNextPage && (
          <div className="w-6 h-6 rounded-full border-2 border-neutral-800 border-t-neutral-400 animate-spin transition-opacity duration-300"></div>
        )}
      </div>
    </>
  );
}