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

// 1. THE NETWORK SHIELD: Forces a strict 5-second timeout on server fetches
// This prevents Next.js from hanging infinitely if Hugging Face is slow
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

// O(1) SINGLETON CACHE: Fetches once per hour, instantly parses into a Map.
export const getCatalogData = cache(async () => {
  try {
    // 5-second timeout applied to the catalog fetch
    const res = await fetchWithTimeout(CATALOG_URL, {
      next: { revalidate: 3600 } // 1 Hour ISR Cache
    }, 5000); 

    if (!res.ok) throw new Error(`Failed to fetch catalog: ${res.status}`);

    const catalog: CatalogItem[] = await res.json();
    const catalogMap = new Map<string, CatalogItem>();

    // Build the O(1) dictionary lookup
    catalog.forEach(item => catalogMap.set(item.id.toString(), item));

    return { catalog, catalogMap };
  } catch (error) {
    console.error("🚨 Catalog fetch failed or timed out:", error);
    // Graceful fallback prevents the entire app from 500ing
    return { catalog: [], catalogMap: new Map<string, CatalogItem>() };
  }
});