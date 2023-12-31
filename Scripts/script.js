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
