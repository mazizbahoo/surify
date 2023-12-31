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

/* ═══════════════════════════════════════════
   LIBRARY SONGS
═══════════════════════════════════════════ */
function renderLibrarySongs(songList = viewContent.songs) {
    const container = document.getElementById("library-songs");
    container.innerHTML = "";
    const favs = getFavorites();

    let filtered = songList;
    if (currentLibFilter === "favorites") {
        filtered = songList.filter(url => favs[songKey(url)]);
    }

    if (filtered.length === 0) {
        container.innerHTML = `<div style="padding:16px 8px;color:var(--lightgrey);font-size:13px;">
            ${!viewFolder ? "Select a playlist to see its songs."
                : currentLibFilter === "favorites" ? "No favorites yet. ❤ a song to add it." : "No songs in this playlist."}
        </div>`;
        return;
    }

    filtered.forEach((songUrl, i) => {
        const { songName, artist } = parseSongPath(songUrl);
        const key = songKey(songUrl);
        const fav = !!favs[key];

        const card = document.createElement("div");
        card.className = "library-song-card" + (fav ? " favorited" : "");
        card.dataset.songUrl = songUrl;
        card.innerHTML = `
            <div class="lib-song-dot"></div>
            <div class="lib-song-text">
                <div class="library-song-name">${songName}</div>
                <div class="library-artist-name">${artist}</div>
            </div>
            <svg class="lib-fav-dot" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="color:var(--accent);">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>`;

        // Find original index in full songs array
        const origIdx = songList.indexOf(songUrl);
        card.addEventListener("click", () => playFromView(origIdx));
        container.appendChild(card);
    });

    highlightCurrentLibrarySong();
}

function highlightCurrentLibrarySong() {
    document.querySelectorAll(".library-song-card").forEach(card => {
        const url = card.dataset.songUrl;
        card.classList.toggle("playing", viewFolder === currentFolder && url === songs[currentIndex]);
    });
    const active = document.querySelector(".library-song-card.playing");
    if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/* ═══════════════════════════════════════════
   PLAY
═══════════════════════════════════════════ */
// The sidebar shows `viewContent`; playback runs from `songs` (the queue). They are the
// same playlist once a song is started from the sidebar or a card's play button.
function refreshCardStates() {
    document.querySelectorAll(".card").forEach(c => {
        c.classList.toggle("viewing-card", c.dataset.folderUrl === viewFolder);
        c.classList.toggle("playing-card", c.dataset.folderUrl === currentFolder);
    });
    updateCardPlayIcons(!audio.paused);
}

function setView(folderUrl, content) {
    viewFolder = folderUrl;
    viewContent = content;
    renderLibrarySongs();
    refreshCardStates();
}

function startQueue(folderUrl, content) {
    currentFolder = folderUrl;
    songs = content.songs;
    currentCover = content.cover;
    currentIndex = 0;
    playHistory.length = 0;
}

function playFromView(index) {
    if (currentFolder !== viewFolder) startQueue(viewFolder, viewContent);
    playAt(index);
}

function playAt(index) {
    if (!songs.length) return;
    setPlayerActive(true);
    currentIndex = ((index % songs.length) + songs.length) % songs.length;
    recordPlay();
    currentSongKey = songKey(songs[currentIndex]);

    const { songName, artist } = parseSongPath(songs[currentIndex]);
    document.getElementById("ptt").textContent = songName;
    document.getElementById("pta").textContent = artist;

    const img = document.getElementById("player-img");
    if (currentCover) img.src = currentCover; else img.removeAttribute("src");

    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    audio.src = songs[currentIndex];
    audio.play();
    setPlayIcon(true);
    highlightCurrentLibrarySong();
    refreshCardStates();
    updatePlayerFavBtn();
}

// Player controls stay disabled and the song info hidden until a song is chosen
function setPlayerActive(active) {
    document.getElementById("player").classList.toggle("idle", !active);
    ["back-Button", "playbutton", "next-Button", "player-fav-btn", "shuffle-btn", "repeat-btn"].forEach(id => {
        document.getElementById(id).disabled = !active;
    });
}
setPlayerActive(false);

/* Play history behind the header back/forward buttons (spans playlists) */
const trail = [];            // { folder, song } in the order songs were started
let trailPos = -1;
let trailNavigating = false;
const navBack = document.getElementById("nav-back");
const navForward = document.getElementById("nav-forward");

function updateNavButtons() {
    navBack.disabled = trailPos <= 0;
    navForward.disabled = trailPos >= trail.length - 1;
}

function recordPlay() {
    if (trailNavigating) return;
    const entry = { folder: currentFolder, song: songs[currentIndex] };
    const cur = trail[trailPos];
    if (cur && cur.folder === entry.folder && cur.song === entry.song) return;
    trail.length = trailPos + 1;           // drop any "forward" entries
    trail.push(entry);
    trailPos = trail.length - 1;
    updateNavButtons();
}

async function goTrail(delta) {
    const target = trailPos + delta;
    if (target < 0 || target >= trail.length) return;
    const entry = trail[target];
    trailPos = target;
    trailNavigating = true;
    try {
        if (entry.folder !== currentFolder) {
            startQueue(entry.folder, await getFolderContent(entry.folder));
        }
        if (viewFolder !== entry.folder) setView(entry.folder, { songs, cover: currentCover });
        const idx = songs.indexOf(entry.song);
        if (idx >= 0) playAt(idx);
    } catch (err) {
        console.error("Failed to open previous song:", err);
    } finally {
        trailNavigating = false;
        updateNavButtons();
    }
}
navBack.addEventListener("click", () => goTrail(-1));
navForward.addEventListener("click", () => goTrail(1));

function goNext() {
    if (!songs.length) return;
    playHistory.push(currentIndex);
    if (shuffleOn && songs.length > 1) {
        let r;
        do { r = Math.floor(Math.random() * songs.length); } while (r === currentIndex);
        playAt(r);
    } else {
        playAt(currentIndex + 1);
    }
}

function goPrev() {
    if (!songs.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }   // restart first, like most players
    if (shuffleOn && playHistory.length) playAt(playHistory.pop());
    else playAt(currentIndex - 1);
}

function togglePlayPause() {
    if (!audio.src || audio.src === window.location.href) return;
    if (audio.paused) { audio.play(); setPlayIcon(true); }
    else { audio.pause(); setPlayIcon(false); }
}

const PLAY_PATH = `<path d="M8 5v14l11-7z"/>`;
const PAUSE_PATH = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;

function updateCardPlayIcons(playing) {
    document.querySelectorAll(".card .playlist-img-play svg").forEach(svg => {
        svg.innerHTML = svg.closest(".card").classList.contains("playing-card") && playing ? PAUSE_PATH : PLAY_PATH;
    });
}

function setPlayIcon(playing) {
    // The playing album's card shows pause/play too and keeps its button visible
    updateCardPlayIcons(playing);
    const btn = document.getElementById("play-icon-svg");
    if (playing) {
        btn.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
    } else {
        btn.innerHTML = `<path d="M8 5v14l11-7z"/>`;
    }
}
