import { cache } from 'react';

// Replace with your actual deployed worker domain if different
const API_BASE = 'https://xkca.dadalapathy756.workers.dev/api';

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
      next: { revalidate: 3600 }
    });
    if (!res.ok) throw new Error(`Failed to fetch catalog: ${res.status}`);
    return res.json();
  } catch (error) {
    console.error("🚨 API Catalog fetch failed:", error);
    return [];
  }
});

// 2. Fetch Deep Metadata for Details Page
export const getMediaDetails = cache(async (id: string): Promise<DeepMetadata | null> => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/details/${id}`, {
      next: { revalidate: 3600 }
    });
    if (!res.ok) return null;
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
      next: { revalidate: 3600 }
    });
    if (!res.ok) return null;
    return res.json();
  } catch (error) {
    console.error(`🚨 API Stream payload fetch failed for Stream ID: ${streamId}`, error);
    return null;
  }
});

// 4. Expose the High-Speed FTS5 Search Endpoint (For your future search bar)
export const searchCatalog = cache(async (query: string): Promise<MediaItem[]> => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/search?q=${encodeURIComponent(query)}`, {
      next: { revalidate: 3600 }
    });
    if (!res.ok) return [];
    return res.json();
  } catch (error) {
    console.error(`🚨 API Search failed`, error);
    return [];
  }
});