let offscreenCanvas = null;
let ctx = null;
let canvasWidth = 1920;
let canvasHeight = 1080;
let pgsEvents = [];

// RING BUFFER OBJECT POOLING FOR ZERO GC PAUSES
const POOL_SIZE = 50; 
const imagePool = new Array(POOL_SIZE).fill(null).map(() => ({ url: null, bitmap: null }));
let poolHead = 0; 

let currentDrawnSignature = null; 
const CORS_PROXY_BASE = "https://xkca.dadalapathy756.workers.dev/?url=";

// Split Routing: Binary media bypasses the proxy
function ensureSplitRoutedUrl(urlToFetch) {
    if (urlToFetch.endsWith('.webp') || urlToFetch.endsWith('.ts')) {
        return urlToFetch; // DIRECT FETCH
    }
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
        const res = await fetch(ensureSplitRoutedUrl(xmlUrl));
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

                events.push({
                    start: parseTC(inTC, fps),
                    end: parseTC(outTC, fps),
                    w: parseInt(graphicMatch[1], 10),
                    h: parseInt(graphicMatch[2], 10),
                    x: parseInt(graphicMatch[3], 10),
                    y: parseInt(graphicMatch[4], 10),
                    url: `${baseUrl}/${imgName}` // Split-routed at fetch time
                });
            }
        }
        
        pgsEvents = events;
        
        // Pre-warm the buffer
        for(let i = 0; i < Math.min(10, events.length); i++) {
            preloadImage(events[i].url);
        }
    } catch (err) {
        console.error("[PGS Worker] Failed to load BDN XML", err);
    }
}

async function preloadImage(url) {
    if (imagePool.some(slot => slot.url === url)) return; // Already fetching or fully cached
    
    // Allocate the next slot in the ring buffer
    const slotIndex = poolHead;
    poolHead = (poolHead + 1) % POOL_SIZE;
    const targetSlot = imagePool[slotIndex];
    
    // Explicitly free GPU memory of the old bitmap BEFORE overwriting (Zero GC Pause strategy)
    if (targetSlot.bitmap) {
        targetSlot.bitmap.close(); 
    }
    
    targetSlot.url = url; // Lock the slot
    targetSlot.bitmap = null; 

    try {
        const directUrl = ensureSplitRoutedUrl(url);
        const response = await fetch(directUrl, { mode: 'cors' });
        if (!response.ok) throw new Error("Network response was not ok");
        const blob = await response.blob();
        
        const bitmap = await createImageBitmap(blob);
        
        // Verify the slot wasn't overwritten by a very fast seek while fetching
        if (targetSlot.url === url) {
            targetSlot.bitmap = bitmap;
        } else {
            bitmap.close(); // Discard if abandoned
        }

    } catch (e) {
        console.error("[PGS Worker] Failed to decode WebP", e);
        if (targetSlot.url === url) targetSlot.url = null; 
    }
}

function drawFrame(time) {
    if (!ctx || pgsEvents.length === 0) return;

    // Lookahead Cache: ensure the next 15 seconds are queued
    const upcoming = pgsEvents.filter(e => e.end >= time && e.start <= time + 15);
    for(const ev of upcoming) {
        preloadImage(ev.url);
    }

    const activeEvents = pgsEvents.filter(e => time >= e.start && time <= e.end);

    if (activeEvents.length > 0) {
        // Find active events that are fully loaded in the pool
        const loadedEvents = [];
        for (const ev of activeEvents) {
            const slot = imagePool.find(s => s.url === ev.url && s.bitmap !== null);
            if (slot) loadedEvents.push({ ev, bitmap: slot.bitmap });
        }

        const signature = loadedEvents.map(le => le.ev.url).sort().join('|');

        if (currentDrawnSignature !== signature) {
            ctx.clearRect(0, 0, canvasWidth, canvasHeight);
            for (const { ev, bitmap } of loadedEvents) {
                ctx.drawImage(bitmap, ev.x, ev.y, ev.w, ev.h);
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
        ctx = offscreenCanvas.getContext('2d', { alpha: true, desynchronized: true }); // GPU optimized context
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
        for (const slot of imagePool) {
            if (slot.bitmap) slot.bitmap.close();
            slot.url = null;
            slot.bitmap = null;
        }
        poolHead = 0;
    }
};