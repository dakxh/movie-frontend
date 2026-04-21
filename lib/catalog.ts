import { cache } from 'react';

const API_BASE = 'https://xkca.dadalapathy756.workers.dev/api';
const CORS_PROXY_BASE = "https://xkca.dadalapathy756.workers.dev/?url=";

export function generateProperResolvedHfPath(u: string): string {
  if (!u || typeof u !== 'string') return u;
  const sanitized = u.split('?download=true')[0].split('&download=true')[0];
  if (!sanitized.startsWith('https://huggingface.co/buckets/') || sanitized.includes('/resolve/')) return sanitized;
  const parts = sanitized.split('/');
  if (parts.length > 6) parts.splice(6, 0, 'resolve');
  return parts.join('/');
}

export function getSplitRoutedUrl(rawAbsoluteUrl: string): string {
  const urlToFetch = generateProperResolvedHfPath(rawAbsoluteUrl);
  if (/\.(ts|mp4|m4s|webp|vtt)$/i.test(urlToFetch)) return urlToFetch; 
  if (urlToFetch.includes('huggingface.co/buckets/')) return CORS_PROXY_BASE + encodeURIComponent(urlToFetch);
  return urlToFetch;
}

export interface MediaItem { id: string; type: 'movie' | 'series'; title: string; year: number; rating: number; poster_url: string; backdrop_url?: string; overview?: string; }
export interface Episode { id: string; episode_number: number; episode_name: string; duration?: string; quality?: string; timeline_thumbnails_url?: string; }
export interface Season { season_number: number; episodes: Episode[]; }
export interface MovieSource { id: string; variation_name: string; quality: string; is_imax: number; is_hdr: number; duration?: string; timeline_thumbnails_url?: string; }
export interface DeepMetadata extends MediaItem { sources?: MovieSource[]; seasons?: Season[]; }

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

export const getHomeCatalog = cache(async (limit = 24, cursor = 0): Promise<MediaItem[]> => {
  try {
    // Note: I also updated 'offset' to 'cursor' in the URL to match your worker's logic
    const res = await fetchWithTimeout(`${API_BASE}/catalog?limit=${limit}&cursor=${cursor}`, { next: { revalidate: 3 } });
    if (!res.ok) throw new Error(`Failed to fetch catalog: ${res.status}`);
    
    const payload = await res.json();
    
    // Extract the 'data' array from the worker's pagination payload
    if (payload && Array.isArray(payload.data)) {
      return payload.data;
    }
    
    return [];
  } catch (error) {
    console.error("🚨 API Catalog fetch failed:", error);
    return [];
  }
});

export const getMediaDetails = cache(async (id: string): Promise<DeepMetadata | null> => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/details/${id}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return res.json();
  } catch (error) {
    console.error(`🚨 API Details fetch failed for ID: ${id}`, error);
    return null;
  }
});

export const getStreamPayload = cache(async (streamId: string) => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/watch/${streamId}`, { next: { revalidate: 3 } });
    if (!res.ok) return null;
    
    const rawData = await res.json();
    
    if (rawData.hls_manifest_url) rawData._safe_manifest_url = getSplitRoutedUrl(rawData.hls_manifest_url);
    if (rawData.timeline_thumbnails_url) rawData._safe_timeline_thumbnails_url = getSplitRoutedUrl(rawData.timeline_thumbnails_url);
    
    if (rawData.pgs_overlays && Array.isArray(rawData.pgs_overlays)) {
      rawData.pgs_overlays = rawData.pgs_overlays.map((sub: any) => ({
        ...sub, _safe_url: getSplitRoutedUrl(typeof sub === 'string' ? sub : sub.url)
      }));
    }
    return rawData;
  } catch (error) {
    console.error(`🚨 API Stream payload fetch failed for Stream ID: ${streamId}`, error);
    return null;
  }
});

export const searchCatalog = cache(async (query: string): Promise<MediaItem[]> => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/search?q=${encodeURIComponent(query)}`, { next: { revalidate: 3 } });
    if (!res.ok) return [];
    return res.json();
  } catch (error) { return[]; }
});