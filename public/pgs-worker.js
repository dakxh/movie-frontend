let offscreenCanvas = null;
let ctx = null;
let canvasWidth = 1920;
let canvasHeight = 1080;
let pgsEvents = [];

// Upgraded to a Map-based LRU Cache
let imageCache = new Map();
const MAX_CACHE_SIZE = 150; 

let currentDrawnSignature = null; 
const CORS_PROXY_BASE = "https://xkca.dadalapathy756.workers.dev/?url=";

function ensureCorsHeaderProxy(urlToFetch) {
    if (urlToFetch.includes('huggingface.co/buckets/')) {
        return CORS_PROXY_BASE + encodeURIComponent(urlToFetch);
    }
    return urlToFetch;
}

const parseTC = (tc, fps = 23.976) => {
    const parts = tc.split(':').map(Number);
    if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2] + (parts[3] / fps);
    return 0;
};

async function loadBdnXml(xmlUrl) {
    try {
        const res = await fetch(xmlUrl);
        const text = await res.text();
        
        let originalUrl = xmlUrl;
        if (xmlUrl.startsWith(CORS_PROXY_BASE)) {
            originalUrl = decodeURIComponent(xmlUrl.replace(CORS_PROXY_BASE, ''));
        }
        const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/'));
        
        let fps = 23.976;
        const fpsMatch = text.match(/FrameRate="([^"]+)"/);
        if (fpsMatch) fps = parseFloat(fpsMatch[1]);

        const vfMatch = text.match(/VideoFormat="([^"]+)"/);
        if (vfMatch) {
            const vf = vfMatch[1];
            if (vf === "720p") { canvasWidth = 1280; canvasHeight = 720; }
            else if (vf === "480p" || vf === "480i") { canvasWidth = 720; canvasHeight = 480; }
            else { canvasWidth = 1920; canvasHeight = 1080; }
        }

        if (offscreenCanvas) {
            offscreenCanvas.width = canvasWidth;
            offscreenCanvas.height = canvasHeight;
        }

        const events = [];
        const eventBlockRegex = /<Event\s+InTC="([^"]+)"\s+OutTC="([^"]+)"[^>]*>([\s\S]*?)<\/Event>/g;
        
        let eventMatch;
        while ((eventMatch = eventBlockRegex.exec(text)) !== null) {
            const inTC = eventMatch[1];
            const outTC = eventMatch[2];
            const innerXML = eventMatch[3];

            const graphicRegex = /<Graphic\s+Width="(\d+)"\s+Height="(\d+)"\s+X="(\d+)"\s+Y="(\d+)"[^>]*>([^<]+)<\/Graphic>/g;
            let graphicMatch;
            
            while ((graphicMatch = graphicRegex.exec(innerXML)) !== null) {
                const imgName = graphicMatch[5].trim();
                if (imgName === 'None') continue;

                const absoluteImgUrl = `${baseUrl}/${imgName}`;
                events.push({
                    start: parseTC(inTC, fps),
                    end: parseTC(outTC, fps),
                    w: parseInt(graphicMatch[1], 10),
                    h: parseInt(graphicMatch[2], 10),
                    x: parseInt(graphicMatch[3], 10),
                    y: parseInt(graphicMatch[4], 10),
                    url: ensureCorsHeaderProxy(absoluteImgUrl)
                });
            }
        }
        
        pgsEvents = events;
        
        // Pre-warm the cache with the first few frames
        for(let i = 0; i < Math.min(10, events.length); i++) {
            preloadImage(events[i].url);
        }
    } catch (err) {
        console.error("[PGS Worker] Failed to load BDN XML", err);
    }
}

async function preloadImage(url) {
    if (imageCache.has(url)) {
        // LRU bump: If it already exists, move it to the end (most recently used)
        const bmp = imageCache.get(url);
        imageCache.delete(url);
        imageCache.set(url, bmp);
        return;
    }
    
    try {
        imageCache.set(url, null); // Set a sync lock to prevent duplicate fetch calls
        const response = await fetch(url);
        if (!response.ok) throw new Error("Network response was not ok");
        const blob = await response.blob();
        
        const bitmap = await createImageBitmap(blob);
        imageCache.set(url, bitmap);
        
        // LRU Eviction Protocol: Purge the oldest frame if we exceed the RAM limit
        if (imageCache.size > MAX_CACHE_SIZE) {
            const firstKey = imageCache.keys().next().value;
            const staleBmp = imageCache.get(firstKey);
            if (staleBmp) staleBmp.close(); // Explicitly free GPU memory
            imageCache.delete(firstKey);
        }

    } catch (e) {
        console.error("[PGS Worker] Failed to decode WebP", e);
        imageCache.delete(url); // Remove the lock so it can retry later if needed
    }
}

function drawFrame(time) {
    if (!ctx || pgsEvents.length === 0) return;

    // Lookahead Cache: ensure the next 15 seconds are downloading/cached
    const upcoming = pgsEvents.filter(e => e.end >= time && e.start <= time + 15);
    for(const ev of upcoming) {
        preloadImage(ev.url); // LRU logic inside handles duplicates automatically
    }

    const activeEvents = pgsEvents.filter(e => time >= e.start && time <= e.end);

    if (activeEvents.length > 0) {
        const loadedEvents = activeEvents.filter(e => imageCache.has(e.url) && imageCache.get(e.url) !== null);
        const signature = loadedEvents.map(e => e.url).sort().join('|');

        if (currentDrawnSignature !== signature) {
            ctx.clearRect(0, 0, canvasWidth, canvasHeight);
            for (const ev of loadedEvents) {
                const bmp = imageCache.get(ev.url);
                ctx.drawImage(bmp, ev.x, ev.y, ev.w, ev.h);
            }
            currentDrawnSignature = signature;
        }
    } else {
        if (currentDrawnSignature !== null) {
            ctx.clearRect(0, 0, canvasWidth, canvasHeight);
            currentDrawnSignature = null;
        }
    }
}

self.onmessage = async (e) => {
    if (e.data.type === 'INIT') {
        offscreenCanvas = e.data.canvas;
        offscreenCanvas.width = canvasWidth;
        offscreenCanvas.height = canvasHeight;
        ctx = offscreenCanvas.getContext('2d');
        if (e.data.url) await loadBdnXml(e.data.url);
    } else if (e.data.type === 'LOAD') {
        if (ctx) ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        currentDrawnSignature = null;
        await loadBdnXml(e.data.url);
    } else if (e.data.type === 'TIME') {
        drawFrame(e.data.time);
    } else if (e.data.type === 'CLEAR') {
        if (ctx) ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        pgsEvents = [];
        currentDrawnSignature = null;
        for (const [url, bmp] of imageCache.entries()) {
            if (bmp) bmp.close();
        }
        imageCache.clear();
    }
};