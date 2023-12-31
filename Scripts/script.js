/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
let currentFolder = null;
let currentCover = null;
let viewFolder = null;      // playlist shown in the sidebar (may differ from the one playing)
let viewContent = { songs: [], cover: null };
let shuffleOn = false;
let repeatMode = "off";     // "off" | "all" | "one"
const playHistory = [];     // songs played before the current one (for Previous while shuffling)
let songs = [];
let allFolders = [];        // { url, name, artist, category }
let currentIndex = 0;
let isDraggingSeek = false;
let isDraggingVol = false;
let activeCategory = "all";
let currentSort = "default";
let searchQuery = "";
let currentLibFilter = "all"; // "all" | "favorites"
let currentSongKey = "";
const coverByFolder = new Map();   // folderUrl -> cover image url
const songIndex = [];         // every song across playlists: { url, folderUrl, name, artist, album, category }

// Favorites stored in localStorage
function getFavorites() {
    try { return JSON.parse(localStorage.getItem("sp_favorites") || "{}"); }
    catch { return {}; }
}
function saveFavorites(favs) {
    localStorage.setItem("sp_favorites", JSON.stringify(favs));
}
function isFavorited(key) { return !!getFavorites()[key]; }
function toggleFavorite(key) {
    const favs = getFavorites();
    if (favs[key]) delete favs[key];
    else favs[key] = true;
    saveFavorites(favs);
    return !!favs[key];
}

/* ═══════════════════════════════════════════
   AUDIO
═══════════════════════════════════════════ */
const audio = new Audio();
let blobUrl = null;
audio.volume = 0.75;

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */
function formatTime(s) {
    if (isNaN(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

function parseFolderName(rawSegment) {
    const decoded = decodeURIComponent(rawSegment.replace(/\/$/, ""));
    const parts = decoded.split("-");
    if (parts.length >= 3) {
        return {
            name: parts[0].trim(),
            category: parts[parts.length - 1].trim(),
            artist: parts.slice(1, -1).join("-").trim()
        };
    } else if (parts.length === 2) {
        return { name: parts[0].trim(), artist: parts[1].trim(), category: "Music" };
    }
    return { name: parts[0].trim(), artist: "Unknown", category: "Music" };
}

// Resolved at startup by locating the Audios folder (see findAudiosBase)
let audiosBase = null;      // absolute URL string ending in "/"

function relFromBase(url) {
    return url.startsWith(audiosBase) ? url.slice(audiosBase.length) : url;
}

function parseSongPath(songUrl) {
    const parts = relFromBase(songUrl).split("/");
    const folderDecoded = decodeURIComponent(parts[0]);
    const folderParts = folderDecoded.split("-");
    const artist = folderParts.length >= 2
        ? folderParts.slice(1, folderParts.length >= 3 ? -1 : undefined).join("-").trim()
        : folderParts[0].trim();
    const songName = decodeURIComponent(parts[1] || "").replace(/\.mp3$/i, "").trim();
    return { songName, artist };
}

// Stable key per song ("Audios/<folder>/<file>"), used for favorites
function songKey(songUrl) {
    return "Audios/" + relFromBase(songUrl);
}

/* ═══════════════════════════════════════════
   FETCH
═══════════════════════════════════════════ */
// Lists the links of a directory index page, resolved against that directory's own URL
async function listLinks(dirUrl) {
    const res = await fetch(dirUrl);
    if (!res.ok) throw new Error(`${res.status} ${dirUrl}`);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    return Array.from(doc.querySelectorAll("a[href]"))
        .map(a => new URL(a.getAttribute("href"), res.url || dirUrl).href);
}

// Looks for the Audios folder next to the page, then in the parent directory
async function findAudiosBase() {
    for (const rel of ["Audios/", "../Audios/"]) {
        const url = new URL(rel, window.location.href).href;
        try {
            const links = await listLinks(url);
            if (links.some(l => l.startsWith(url) && l !== url)) return url;
        } catch { /* try next */ }
    }
    throw new Error("Audios folder not found");
}

async function getFolders() {
    const links = await listLinks(audiosBase);
    return [...new Set(links)].filter(l => l.startsWith(audiosBase) && l !== audiosBase && l.endsWith("/"));
}

// Songs + cover image of a folder (any one image file inside is the cover); cached
const folderCache = new Map();
function getFolderContent(folderUrl) {
    if (!folderCache.has(folderUrl)) {
        folderCache.set(folderUrl, listLinks(folderUrl).then(links => {
            const inFolder = links.filter(l => l.startsWith(folderUrl) && l !== folderUrl)
                                  .map(l => ({ url: l, path: l.split(/[?#]/)[0] }));
            return {
                songs: inFolder.filter(f => /\.mp3$/i.test(f.path)).map(f => f.url),
                cover: (inFolder.find(f => /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(f.path)) || {}).url || null
            };
        }).catch(err => { folderCache.delete(folderUrl); throw err; }));
    }
    return folderCache.get(folderUrl);
}
async function getSongs(folderUrl) { return (await getFolderContent(folderUrl)).songs; }
