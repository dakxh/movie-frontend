// lib/catalog.ts
import { cache } from 'react';

const CATALOG_URL = 'https://huggingface.co/buckets/Gravatar44/xkca/resolve/global_catalog.json';

export interface CatalogItem {
  id: number;
  type: 'movie' | 'series';
  title: string;
  year: string;
  date_added: number;
  available_resolutions?: string[];
  available_variations?: string[];
  hls_manifest_url?: Record<string, string>;
  series_metadata_url?: string;
  poster_url: string;
}

// 1. O(1) SINGLETON CACHE: Fetches once per hour, instantly parses into a Map.
export const getCatalogData = cache(async () => {
  const res = await fetch(CATALOG_URL, {
    next: { revalidate: 3600 } // 1 Hour ISR Cache
  });

  if (!res.ok) throw new Error('Failed to fetch catalog');

  const catalog: CatalogItem[] = await res.json();
  const catalogMap = new Map<string, CatalogItem>();

  // Build the O(1) dictionary lookup
  catalog.forEach(item => catalogMap.set(item.id.toString(), item));

  return { catalog, catalogMap };
});