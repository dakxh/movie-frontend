let offscreenCanvas = null;
let ctx = null;
let pgsEvents = [];

let lastKnownTime = 0; // CRITICAL FIX: Tracks pause state

// RING BUFFER OBJECT POOLING FOR ZERO GC PAUSES
const POOL_SIZE = 50;
const imagePool = new Array(POOL_SIZE).fill(null).map(() => ({ url: null, bitmap: null }));
let poolHead = 0;

let currentDrawnSignature = null;
const CORS_PROXY_BASE = "https://xkca.dadalapathy756.workers.dev/?url=";

// Split Routing: Binary media bypasses the proxy
function ensureSplitRoutedUrl(urlToFetch) {
    if (urlToFetch.endsWith('.webp') || urlToFetch.endsWith('.ts')) {
        return urlToFetch;
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
                    url: `${baseUrl}/${imgName}`
                });
            }
        }

        pgsEvents = events;

        for (let i = 0; i < Math.min(10, events.length); i++) {
            preloadImage(events[i].url);
        }
    } catch (err) {
        console.error("[PGS Worker] Failed to load BDN XML", err);
    }
}

async function preloadImage(url) {
    if (imagePool.some(slot => slot.url === url)) return;

    const slotIndex = poolHead;
    poolHead = (poolHead + 1) % POOL_SIZE;
    const targetSlot = imagePool[slotIndex];

    if (targetSlot.bitmap) {
        targetSlot.bitmap.close();
    }

    targetSlot.url = url;
    targetSlot.bitmap = null;

    try {
        const directUrl = ensureSplitRoutedUrl(url);
        const response = await fetch(directUrl, { mode: 'cors' });
        if (!response.ok) throw new Error("Network response was not ok");
        const blob = await response.blob();

        const bitmap = await createImageBitmap(blob);

        if (targetSlot.url === url) {
            targetSlot.bitmap = bitmap;
        } else {
            bitmap.close();
        }
    } catch (e) {
        console.error("[PGS Worker] Failed to decode WebP", e);
        if (targetSlot.url === url) targetSlot.url = null;
    }
}

function drawFrame(time) {
    if (!ctx || pgsEvents.length === 0) return;

    const upcoming = pgsEvents.filter(e => e.end >= time && e.start <= time + 15);
    for (const ev of upcoming) {
        preloadImage(ev.url);
    }

    const activeEvents = pgsEvents.filter(e => time >= e.start && time <= e.end);

    if (activeEvents.length > 0) {
        const loadedEvents = [];
        for (const ev of activeEvents) {
            const slot = imagePool.find(s => s.url === ev.url && s.bitmap !== null);
            if (slot) loadedEvents.push({ ev, bitmap: slot.bitmap });
        }

        const signature = loadedEvents.map(le => le.ev.url).sort().join('|');

        if (currentDrawnSignature !== signature) {

            if (loadedEvents.length > 0) {
                const primaryBitmap = loadedEvents[0].bitmap;

                if (offscreenCanvas.width !== primaryBitmap.width || offscreenCanvas.height !== primaryBitmap.height) {
                    offscreenCanvas.width = primaryBitmap.width;
                    offscreenCanvas.height = primaryBitmap.height;
                }

                ctx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

                for (const { bitmap } of loadedEvents) {
                    ctx.drawImage(bitmap, 0, 0);
                }
            } else {
                ctx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
            }

            currentDrawnSignature = signature;
        }
    } else {
        if (currentDrawnSignature !== null) {
            ctx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
            currentDrawnSignature = null;
        }
    }
}

self.onmessage = async (e) => {
    if (e.data.type === 'PRECACHE') {
        if (e.data.url) await loadBdnXml(e.data.url);
    }
    else if (e.data.type === 'INIT') {
        offscreenCanvas = e.data.canvas;
        offscreenCanvas.width = 10;
        offscreenCanvas.height = 10;
        ctx = offscreenCanvas.getContext('2d', { alpha: true, desynchronized: true });
        if (e.data.url && pgsEvents.length === 0) await loadBdnXml(e.data.url);
    }
    else if (e.data.type === 'LOAD') {
        if (ctx) ctx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        currentDrawnSignature = null;
        await loadBdnXml(e.data.url);

        // CRITICAL FIX: Ensure the worker instantly repaints if switched while Paused
        drawFrame(lastKnownTime);
    }
    else if (e.data.type === 'TIME') {
        lastKnownTime = e.data.time;
        drawFrame(lastKnownTime);
    }
    else if (e.data.type === 'CLEAR') {
        if (ctx) ctx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
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