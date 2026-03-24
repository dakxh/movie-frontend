let offscreenCanvas = null;
let ctx = null;
let canvasWidth = 1920;
let canvasHeight = 1080;
let pgsEvents = [];
let imageCache = new Map();

// Tracks the exact combination of overlapping images currently on screen
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
        
        // FIX: Two-step regex to capture an infinite number of overlapping graphics inside a single Event
        const eventBlockRegex = /<Event\s+InTC="([^"]+)"\s+OutTC="([^"]+)"[^>]*>([\s\S]*?)<\/Event>/g;
        const graphicRegex = /<Graphic\s+Width="(\d+)"\s+Height="(\d+)"\s+X="(\d+)"\s+Y="(\d+)"[^>]*>([^<]+)<\/Graphic>/g;
        
        let eventMatch;
        while ((eventMatch = eventBlockRegex.exec(text)) !== null) {
            const inTC = eventMatch[1];
            const outTC = eventMatch[2];
            const innerXML = eventMatch[3];

            let graphicMatch;
            // Iterate through every graphic packed into this specific timestamp
            while ((graphicMatch = graphicRegex.exec(innerXML)) !== null) {
                const absoluteImgUrl = `${baseUrl}/${graphicMatch[5].trim()}`;
                events.push({
                    start: parseTC(inTC, fps),
                    end: parseTC(outTC, fps),
                    w: parseInt(graphicMatch[1]),
                    h: parseInt(graphicMatch[2]),
                    x: parseInt(graphicMatch[3]),
                    y: parseInt(graphicMatch[4]),
                    url: ensureCorsHeaderProxy(absoluteImgUrl)
                });
            }
        }
        
        pgsEvents = events;
        
        // Preload the first batch to ensure immediate playback readiness
        for(let i = 0; i < Math.min(10, events.length); i++) {
            preloadImage(events[i].url);
        }
    } catch (err) {
        console.error("[PGS Worker] Failed to load BDN XML", err);
    }
}

async function preloadImage(url) {
    if (imageCache.has(url)) return;
    try {
        imageCache.set(url, null); 
        const response = await fetch(url);
        const blob = await response.blob();
        
        // Decodes natively on the GPU thread
        const bitmap = await createImageBitmap(blob);
        imageCache.set(url, bitmap);
    } catch (e) {
        console.error("[PGS Worker] Failed to decode WebP", e);
        imageCache.delete(url);
    }
}

function drawFrame(time) {
    if (!ctx || pgsEvents.length === 0) return;

    // Aggressive Memory GC: Remove images that are 15+ seconds in the past
    if (imageCache.size > 30) {
        for (const [url, bmp] of imageCache.entries()) {
            const ev = pgsEvents.find(e => e.url === url);
            if (ev && ev.end < time - 15) {
                if (bmp) bmp.close(); 
                imageCache.delete(url);
            }
        }
    }

    // Lookahead Cache: Dynamically load images needed in the next 15 seconds
    const upcoming = pgsEvents.filter(e => e.start >= time && e.start <= time + 15);
    for(const ev of upcoming) {
        if (!imageCache.has(ev.url)) preloadImage(ev.url);
    }

    // 1. Grab ALL subtitles that should be on screen right now
    const activeEvents = pgsEvents.filter(e => time >= e.start && time <= e.end);

    if (activeEvents.length > 0) {
        // 2. Only attempt to draw the ones that have successfully finished downloading
        const loadedEvents = activeEvents.filter(e => imageCache.has(e.url) && imageCache.get(e.url) !== null);

        // 3. Create a unique state signature for this combination of images
        const signature = loadedEvents.map(e => e.url).sort().join('|');

        // 4. If the screen doesn't match the signature, wipe and redraw the stack
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