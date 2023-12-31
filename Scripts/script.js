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

/* ═══════════════════════════════════════════
   CATEGORY FILTERS
═══════════════════════════════════════════ */
const categorySet = new Set(["all"]);

function selectCategory(key, btn) {
    activeCategory = key;
    document.querySelectorAll(".cat-filter").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    applyFiltersAndSort();
}

// The static "All" button
document.querySelector('.cat-filter[data-category="all"]')
    .addEventListener("click", e => selectCategory("all", e.currentTarget));

function addCategoryFilter(category) {
    const key = category.toLowerCase();
    if (categorySet.has(key)) return;
    categorySet.add(key);

    const btn = document.createElement("button");
    btn.className = "cat-filter";
    btn.dataset.category = key;
    btn.textContent = category;
    btn.addEventListener("click", () => selectCategory(key, btn));
    document.getElementById("category-filter-bar").appendChild(btn);
}

/* ═══════════════════════════════════════════
   FILTER + SORT + SEARCH (cards)
═══════════════════════════════════════════ */
function applyFiltersAndSort() {
    const container = document.getElementById("card-Container");
    const q = searchQuery.toLowerCase().trim();

    // Get all card data from the DOM
    let cards = Array.from(container.querySelectorAll(".card"));

    // Hide/show based on category + search
    let visibleCards = cards.filter(card => {
        const cardCat = (card.dataset.category || "").toLowerCase();
        const cardName = (card.dataset.name || "").toLowerCase();
        const cardArtist = (card.dataset.artist || "").toLowerCase();

        const matchesCat = activeCategory === "all" || cardCat === activeCategory;
        const matchesSearch = !q || cardName.includes(q) || cardArtist.includes(q) || cardCat.includes(q);

        return matchesCat && matchesSearch;
    });

    // Sort
    const sorted = sortCards(visibleCards, currentSort);

    // Re-append sorted visible cards, hide others
    const hiddenCards = cards.filter(c => !visibleCards.includes(c));
    hiddenCards.forEach(c => c.classList.add("hidden"));
    visibleCards.forEach(c => c.classList.remove("hidden"));

    // Reorder in DOM
    sorted.forEach(card => container.appendChild(card));

    // Songs matching the search (also respects the active category)
    const songMatches = q
        ? songIndex.filter(sg =>
            (activeCategory === "all" || sg.category.toLowerCase() === activeCategory) &&
            (sg.name.toLowerCase().includes(q) || sg.artist.toLowerCase().includes(q) || sg.album.toLowerCase().includes(q)))
        : [];
    renderSearchResults(q ? sorted : [], songMatches);

    // No results
    document.getElementById("no-results").style.display = sorted.length === 0 && songMatches.length === 0 ? "flex" : "none";
    container.style.display = q || sorted.length === 0 ? "none" : "grid";
}

// Unified search results: matching playlists first, then matching songs, each tagged
function renderSearchResults(playlistCards, songMatches) {
    const box = document.getElementById("song-results");
    const list = document.getElementById("song-results-list");
    list.innerHTML = "";
    box.hidden = playlistCards.length + songMatches.length === 0;

    const addRow = ({ cover, name, tag, isSong, sub, active, onClick }) => {
        const row = document.createElement("div");
        row.className = "song-row" + (active ? (isSong ? " playing" : " viewing") : "");
        const thumb = document.createElement("div");
        thumb.className = "song-row-thumb";
        if (cover) thumb.style.backgroundImage = `url("${cover}")`;
        const text = document.createElement("div");
        text.className = "song-row-text";
        const nm = document.createElement("div");
        nm.className = "song-row-name";
        nm.textContent = name;
        const subLine = document.createElement("div");
        subLine.className = "song-row-sub";
        const tagEl = document.createElement("span");
        tagEl.className = "result-tag" + (isSong ? " is-song" : "");
        tagEl.textContent = tag;
        const subText = document.createElement("span");
        subText.textContent = sub;
        subLine.append(tagEl, subText);
        text.append(nm, subLine);
        row.append(thumb, text);
        row.addEventListener("click", onClick);
        list.appendChild(row);
    };

    playlistCards.forEach(card => {
        const folderUrl = card.dataset.folderUrl;
        addRow({
            cover: card.dataset.cover,
            name: card.querySelector(".playlist-title").textContent,
            tag: "Playlist",
            isSong: false,
            sub: card.querySelector(".artist-name").textContent,
            active: folderUrl === viewFolder,
            onClick: async () => {
                try { setView(folderUrl, await getFolderContent(folderUrl)); }
                catch (err) { console.error("Failed to load songs:", err); return; }
                if (window.innerWidth <= 768) setSidebar(true);
            }
        });
    });

    songMatches.slice(0, 50).forEach(sg => {
        addRow({
            cover: coverByFolder.get(sg.folderUrl),
            name: sg.name,
            tag: "Song",
            isSong: true,
            sub: `${sg.artist} · ${sg.album}`,
            active: sg.url === songs[currentIndex],
            onClick: async () => {
                try {
                    const content = await getFolderContent(sg.folderUrl);
                    setView(sg.folderUrl, content);
                    startQueue(sg.folderUrl, content);
                    playAt(content.songs.indexOf(sg.url));
                } catch (err) { console.error("Failed to play song:", err); }
            }
        });
    });
}

function sortCards(cards, method) {
    const favs = getFavorites();
    return [...cards].sort((a, b) => {
        const nameA = (a.dataset.name || "").toLowerCase();
        const nameB = (b.dataset.name || "").toLowerCase();
        const artistA = (a.dataset.artist || "").toLowerCase();
        const artistB = (b.dataset.artist || "").toLowerCase();
        const idxA = parseInt(a.dataset.origIndex || "0");
        const idxB = parseInt(b.dataset.origIndex || "0");

        switch (method) {
            case "az": return nameA.localeCompare(nameB);
            case "za": return nameB.localeCompare(nameA);
            case "artist": return artistA.localeCompare(artistB);
            case "favorites": {
                const fa = favs[a.dataset.folderKey] ? 1 : 0;
                const fb = favs[b.dataset.folderKey] ? 1 : 0;
                return fb - fa || idxA - idxB;
            }
            default: return idxA - idxB;
        }
    });
}
