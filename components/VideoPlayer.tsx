'use client';

// Vidstack Core CSS
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';

import { MediaPlayer, MediaProvider } from '@vidstack/react';
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default';

interface VideoPlayerProps {
  src: string;
  title: string;
}

export default function VideoPlayer({ src, title }: VideoPlayerProps) {
  return (
    <div className="w-full h-full max-h-screen aspect-video bg-black flex items-center justify-center ring-1 ring-neutral-900 overflow-hidden shadow-2xl">
      <MediaPlayer 
        title={title} 
        src={src}
        crossOrigin="anonymous"
        playsInline
        autoPlay // Optional: Automatically starts playing when they land on the page for that snappy feel
        className="w-full h-full focus:outline-none"
      >
        {/* The MediaProvider acts as the actual video element & HLS engine wrapper */}
        <MediaProvider />
        
        {/* DefaultVideoLayout gives us the native-looking scrub bar, volume, and settings menus */}
        <DefaultVideoLayout 
          icons={defaultLayoutIcons} 
          color="#e5e5e5" // Hardcoded to match our neutral-200 text color from Tailwind
        />
      </MediaPlayer>
    </div>
  );
}