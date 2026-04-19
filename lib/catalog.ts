import { cache } from 'react';

const API_BASE = 'https://xkca.dadalapathy756.workers.dev/api';
const CORS_PROXY_BASE = "https://xkca.dadalapathy756.workers.dev/?url=";

// Server-Side URL Resolvers
export function generateProperResolvedHfPath(u: string): string {
  if (!u || typeof u !== 'string') return u;
  const sanitized = u.split('?download=true')[0].split('&download=true')[0];
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

export function getSplitRoutedUrl(rawAbsoluteUrl: string): string {
  const urlToFetch = generateProperResolvedHfPath(rawAbsoluteUrl);
  if (/\.(ts|mp4|m4s|webp|vtt)$/i.test(urlToFetch)) return urlToFetch; 
  if (urlToFetch.includes('huggingface.co/buckets/')) {
    return CORS_PROXY_BASE + encodeURIComponent(urlToFetch);
  }
  return urlToFetch;
}

export interface MediaItem {
  id: string;
  type: 'movie' | 'series';
  title: string;
  year: number;
  rating: number;
  poster_url: string;
  backdrop_url?: string;
  overview?: string;
}

export interface Episode {
  id: string;
  episode_number: number;
  episode_name: string;
  duration?: string;
  quality?: string;
  timeline_thumbnails_url?: string; // NEW
}

export interface Season {
  season_number: number;
  episodes: Episode[];
}

export interface MovieSource {
  id: string;
  variation_name: string;
  quality: string;
  is_imax: number;
  is_hdr: number;
  duration?: string;
  timeline_thumbnails_url?: string; // NEW
}

export interface DeepMetadata extends MediaItem {
  sources?: MovieSource[];
  seasons?: Season[];
}

// THE NETWORK SHIELD: Protects Next.js from hanging
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

// 1. Fetch Homepage Grid (Supports Pagination)
export const getHomeCatalog = cache(async (limit = 24, offset = 0): Promise<MediaItem[]> => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/catalog?limit=${limit}&offset=${offset}`, {
      next: { revalidate: 3 }
    });
    if (!res.ok) throw new Error(`Failed to fetch catalog: ${res.status}`);
    return res.json();
  } catch (error) {
    console.error("🚨 API Catalog fetch failed:", error);
    return [];
  }
});

// 2. Fetch Deep Metadata for Details Page
// 2. Fetch Deep Metadata for Details Page
export const getMediaDetails = cache(async (id: string): Promise<DeepMetadata | null> => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/details/${id}`, {
      next: { revalidate: 3600 }
    });
    
    if (!res.ok) {
      // Capture the exact database error instead of failing silently
      const errorText = await res.text();
      console.error(`🚨 API Details fetch failed for ID ${id}. Status: ${res.status}. Details: ${errorText}`);
      return null;
    }
    
    return res.json();
  } catch (error) {
    console.error(`🚨 API Details fetch failed for ID: ${id}`, error);
    return null;
  }
});

// 3. Fetch Stream Engine Payload
export const getStreamPayload = cache(async (streamId: string) => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/watch/${streamId}`, {
      next: { revalidate: 3 }
    });
    if (!res.ok) return null;
    
    const rawData = await res.json();
    
    // PRE-FLIGHT TRANSFORMATION: Compute safe URLs on the Edge/Server
    const manifestUrl = rawData.hls_manifest_url;
    if (manifestUrl) {
      rawData._safe_manifest_url = getSplitRoutedUrl(manifestUrl);
    }

    if (rawData.timeline_thumbnails_url) {
      rawData._safe_timeline_thumbnails_url = getSplitRoutedUrl(rawData.timeline_thumbnails_url);
    }

    if (rawData.pgs_overlays && Array.isArray(rawData.pgs_overlays)) {
      rawData.pgs_overlays = rawData.pgs_overlays.map((sub: any) => ({
        ...sub,
        _safe_url: getSplitRoutedUrl(typeof sub === 'string' ? sub : sub.url)
      }));
    }

    return rawData;
  } catch (error) {
    console.error(`🚨 API Stream payload fetch failed for Stream ID: ${streamId}`, error);
    return null;
  }
});

// 4. Expose the High-Speed FTS5 Search Endpoint (For your future search bar)
export const searchCatalog = cache(async (query: string): Promise<MediaItem[]> => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/search?q=${encodeURIComponent(query)}`, {
      next: { revalidate: 3 }
    });
    if (!res.ok) return [];
    return res.json();
  } catch (error) {
    console.error(`🚨 API Search failed`, error);
    return [];
  }
});