'use client';

import { useState, useEffect, useRef, useCallback, startTransition } from 'react';
import Link from 'next/link';

export default function SearchOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  
  // Performance Mechanisms
  const abortControllerRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, any[]>>(new Map());

  // Global Keypress Listener (Active only when mounted)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent triggering if typing in another input box
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.key === 'q' || e.key === 'Q') && !isOpen) {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Lock scrolling & auto-focus input
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      // Slight timeout ensures DOM is fully painted before focusing
      setTimeout(() => inputRef.current?.focus(), 10);
    } else {
      document.body.style.overflow = 'auto';
      setQuery('');
      setResults([]);
    }
    return () => { document.body.style.overflow = 'auto'; };
  }, [isOpen]);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    // ⚡ Optimization 1: Instant Cache Retrieval
    if (cacheRef.current.has(searchQuery)) {
      setResults(cacheRef.current.get(searchQuery) || []);
      return;
    }

    // ⚡ Optimization 2: Abort Stale Requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    try {
      // Hits your Cloudflare Worker Edge Cache
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`, {
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        let errorMessage = `HTTP Error ${res.status}: ${res.statusText}`;
        try {
          const errorBody = await res.text();
          errorMessage += `\nResponse Body: ${errorBody}`;
        } catch (parseError) {
          errorMessage += `\n(Could not read response body)`;
        }
        throw new Error(errorMessage);
      }
      const data = await res.json();
      
      cacheRef.current.set(searchQuery, data);

      // ⚡ Optimization 3: Concurrent State Updates
      startTransition(() => {
        setResults(data);
      });
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        // [NEW] Log the detailed error we built above
        console.error("🔍 Search Pipeline Error:", err.message || err);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ⚡ Optimization 4: Debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(query);
    }, 200);

    return () => clearTimeout(timer);
  }, [query, performSearch]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-md p-4 sm:p-8 animate-in fade-in duration-200">
      
      {/* Input Area */}
      <div className="relative w-full max-w-5xl mx-auto mt-10">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movies, years, imax..."
          className="w-full text-3xl sm:text-5xl bg-transparent border-b-2 border-white/20 text-white placeholder-white/30 focus:outline-none focus:border-white pb-4 transition-colors"
        />
        <button
          onClick={() => setIsOpen(false)}
          className="absolute right-0 top-0 text-white/50 hover:text-white text-2xl font-mono"
        >
          [ESC]
        </button>
      </div>

      {/* Grid Layout matches the homepage */}
      <div className="w-full max-w-7xl mx-auto mt-12 overflow-y-auto pb-20 no-scrollbar">
        {isLoading && !results.length && (
          <p className="text-white/50 text-center font-mono animate-pulse">Searching...</p>
        )}
        
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {results.map((media) => (
            <Link href={`/watch/${media.id}`} key={media.id} className="group flex flex-col gap-2" onClick={() => setIsOpen(false)}>
              <div className="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-zinc-900 border border-white/5">
                <img
                  src={media.poster_url || '/placeholder.png'}
                  alt={media.title}
                  loading="lazy"
                  className="object-cover w-full h-full transition-transform duration-300 group-hover:scale-105"
                />
              </div>
              <h3 className="text-white text-sm font-medium truncate">{media.title}</h3>
              <p className="text-white/50 text-xs font-mono">{media.year}</p>
            </Link>
          ))}
        </div>

        {!isLoading && query && results.length === 0 && (
          <p className="text-white/50 text-center mt-10 font-mono">No results found for "{query}"</p>
        )}
      </div>
    </div>
  );
}