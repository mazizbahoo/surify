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

/* ═══════════════════════════════════════════
   FAVORITES
═══════════════════════════════════════════ */
function updatePlayerFavBtn() {
    const btn = document.getElementById("player-fav-btn");
    const fav = isFavorited(currentSongKey);
    btn.classList.toggle("active", fav);
    btn.setAttribute("aria-pressed", String(fav));
    btn.setAttribute("title", fav ? "Remove from favorites" : "Add to favorites");
}

function updateCardFavBtn(folderKey) {
    const card = document.querySelector(`.card[data-folder-key="${folderKey}"]`);
    if (!card) return;
    const btn = card.querySelector(".card-fav-btn");
    if (!btn) return;
    const fav = isFavorited(folderKey);
    btn.classList.toggle("favorited", fav);
    btn.setAttribute("title", fav ? "Remove from favorites" : "Add to favorites");
    btn.innerHTML = fav
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color:var(--accent)"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
}

document.getElementById("player-fav-btn").addEventListener("click", () => {
    if (!currentSongKey) return;
    toggleFavorite(currentSongKey);
    updatePlayerFavBtn();
    // Re-render library songs to reflect fav state
    renderLibrarySongs();
});

/* ═══════════════════════════════════════════
   SEEKBAR
═══════════════════════════════════════════ */
function seekToPercent(pct) {
    const c = Math.min(1, Math.max(0, pct));
    if (!isNaN(audio.duration) && audio.duration > 0) audio.currentTime = c * audio.duration;
    document.getElementById("runned-seek").style.width = (c * 100) + "%";
    document.getElementById("time-played").textContent = formatTime(c * (audio.duration || 0));
}
function getSeekPct(e) {
    const rect = document.getElementById("back-seek").getBoundingClientRect();
    return (e.clientX - rect.left) / rect.width;
}
document.getElementById("back-seek").addEventListener("mousedown", e => { isDraggingSeek = true; seekToPercent(getSeekPct(e)); });
document.addEventListener("mousemove", e => { if (isDraggingSeek) seekToPercent(getSeekPct(e)); });
document.addEventListener("mouseup", () => { isDraggingSeek = false; });
document.getElementById("back-seek").addEventListener("touchstart", e => { isDraggingSeek = true; seekToPercent(getSeekPct(e.touches[0])); }, { passive: true });
document.addEventListener("touchmove", e => { if (isDraggingSeek) seekToPercent(getSeekPct(e.touches[0])); }, { passive: true });
document.addEventListener("touchend", () => { isDraggingSeek = false; });

/* ═══════════════════════════════════════════
   VOLUME
═══════════════════════════════════════════ */
let lastVolume = 0.75;      // volume to restore when unmuting
function setVol(pct) {
    const c = Math.min(1, Math.max(0, pct));
    if (c > 0) lastVolume = c;
    audio.volume = c;
    document.getElementById("set-volume").style.width = (c * 100) + "%";
    const icon = document.getElementById("vol-icon-svg");
    icon.innerHTML = c === 0
        ? `<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>`
        : `<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>`;
}
function getVolPct(e) {
    const rect = document.getElementById("total-volume").getBoundingClientRect();
    return (e.clientX - rect.left) / rect.width;
}
document.getElementById("total-volume").addEventListener("mousedown", e => { isDraggingVol = true; setVol(getVolPct(e)); });
document.addEventListener("mousemove", e => { if (isDraggingVol) setVol(getVolPct(e)); });
document.addEventListener("mouseup", () => { isDraggingVol = false; });

document.getElementById("vol-btn").addEventListener("click", () => {
    if (audio.volume > 0) setVol(0); else setVol(lastVolume);
});

/* ═══════════════════════════════════════════
   AUDIO EVENTS
═══════════════════════════════════════════ */
audio.addEventListener("timeupdate", () => {
    if (isDraggingSeek) return;
    const pct = audio.duration ? audio.currentTime / audio.duration : 0;
    document.getElementById("runned-seek").style.width = (pct * 100) + "%";
    document.getElementById("time-played").textContent = formatTime(audio.currentTime);
    document.getElementById("total-time").textContent = formatTime(audio.duration);
});
audio.addEventListener("ended", () => {
    if (repeatMode === "one") { audio.currentTime = 0; audio.play(); return; }
    const atEnd = !shuffleOn && currentIndex === songs.length - 1;
    if (atEnd && repeatMode === "off") { setPlayIcon(false); return; }
    setTimeout(goNext, 800);
});
audio.addEventListener("pause", () => setPlayIcon(false));

// Servers without HTTP Range support (e.g. python -m http.server) make the audio
// unseekable. Detect that and switch to an in-memory copy so the slider works.
audio.addEventListener("loadedmetadata", async () => {
    const src = audio.src;
    if (src.startsWith("blob:")) return;
    const sk = audio.seekable;
    if (sk.length && Math.abs(sk.end(sk.length - 1) - audio.duration) < 1) return;
    try {
        const blob = await (await fetch(src)).blob();
        if (audio.src !== src) return; // song changed meanwhile
        const t = audio.currentTime, wasPlaying = !audio.paused;
        const url = URL.createObjectURL(blob);
        audio.addEventListener("loadedmetadata", () => {
            audio.currentTime = t;
            if (wasPlaying) audio.play();
        }, { once: true });
        audio.src = url;
        blobUrl = url;
    } catch { /* keep streaming source */ }
});
audio.addEventListener("play", () => setPlayIcon(true));

/* ═══════════════════════════════════════════
   KEYBOARD
═══════════════════════════════════════════ */
document.addEventListener("keydown", e => {
    const tag = document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === " ") { e.preventDefault(); togglePlayPause(); }
    if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
    if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
});

/* ═══════════════════════════════════════════
   PLAYER BUTTONS
═══════════════════════════════════════════ */
document.getElementById("playbutton").addEventListener("click", togglePlayPause);
document.getElementById("back-Button").addEventListener("click", goPrev);
document.getElementById("next-Button").addEventListener("click", goNext);

/* Shuffle + repeat */
const shuffleBtn = document.getElementById("shuffle-btn");
const repeatBtn = document.getElementById("repeat-btn");
const REPEAT_ICONS = {
    off: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z",
    one: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"
};

shuffleBtn.addEventListener("click", () => {
    shuffleOn = !shuffleOn;
    shuffleBtn.classList.toggle("active", shuffleOn);
    shuffleBtn.setAttribute("aria-pressed", String(shuffleOn));
    shuffleBtn.title = shuffleOn ? "Shuffle: on" : "Shuffle";
});
repeatBtn.addEventListener("click", () => {
    repeatMode = { off: "all", all: "one", one: "off" }[repeatMode];
    repeatBtn.classList.toggle("active", repeatMode !== "off");
    repeatBtn.setAttribute("aria-pressed", String(repeatMode !== "off"));
    repeatBtn.title = "Repeat: " + repeatMode;
    document.getElementById("repeat-path").setAttribute("d", REPEAT_ICONS[repeatMode === "one" ? "one" : "off"]);
});

/* ═══════════════════════════════════════════
   SEARCH
═══════════════════════════════════════════ */
const searchInput = document.getElementById("header-search");
const searchClear = document.getElementById("search-clear");

searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    searchClear.classList.toggle("visible", searchQuery.length > 0);
    applyFiltersAndSort();
});

searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchQuery = "";
    searchClear.classList.remove("visible");
    searchInput.focus();
    applyFiltersAndSort();
});

// Home: clear search + category filter and scroll back to the top
document.getElementById("home-btn").addEventListener("click", () => {
    searchInput.value = "";
    searchQuery = "";
    searchClear.classList.remove("visible");
    selectCategory("all", document.querySelector('.cat-filter[data-category="all"]'));
    document.getElementById("card-Container").scrollTo({ top: 0, behavior: "smooth" });
    setSidebar(false);
});

// Sidebar search focus
document.getElementById("open-search-sidebar")?.addEventListener("click", () => {
    searchInput.focus();
});

/* ═══════════════════════════════════════════
   SORT DROPDOWN
═══════════════════════════════════════════ */
const sortBtn = document.getElementById("sort-btn");
const sortDropdown = document.getElementById("sort-dropdown");

sortBtn.addEventListener("click", e => {
    e.stopPropagation();
    const open = sortDropdown.classList.toggle("open");
    sortBtn.classList.toggle("open", open);
});

document.addEventListener("click", () => {
    sortDropdown.classList.remove("open");
    sortBtn.classList.remove("open");
});

document.querySelectorAll(".sort-option").forEach(btn => {
    btn.addEventListener("click", e => {
        e.stopPropagation();
        currentSort = btn.dataset.sort;
        document.getElementById("sort-label-text").textContent = btn.textContent.replace("✓ ", "");
        document.querySelectorAll(".sort-option").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        sortDropdown.classList.remove("open");
        sortBtn.classList.remove("open");
        applyFiltersAndSort();
    });
});

/* ═══════════════════════════════════════════
   LIBRARY FILTER (Playlists / Favorites)
═══════════════════════════════════════════ */
document.querySelectorAll(".libfilters").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".libfilters").forEach(b => b.classList.remove("active-lib"));
        btn.classList.add("active-lib");
        currentLibFilter = btn.dataset.lib;
        renderLibrarySongs();
    });
});

/* ═══════════════════════════════════════════
   ACCENT COLOR + FULLSCREEN
═══════════════════════════════════════════ */
const ACCENTS = [
    { name: "Red", color: "#e31b3a" },
    { name: "Violet", color: "#8b7cff" },
    { name: "Coral", color: "#ff6b6b" },
    { name: "Sky", color: "#4cc9f0" },
    { name: "Amber", color: "#ffb347" },
    { name: "Pink", color: "#ff5fa2" },
    { name: "Teal", color: "#2ec4b6" },
    { name: "Green", color: "#1fdf64" }
];

function mixWithWhite(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v + (255 - v) * amount));
    return `rgb(${ch.join(",")})`;
}

function applyAccent(hex) {
    const n = parseInt(hex.slice(1), 16);
    const root = document.documentElement.style;
    root.setProperty("--accent", hex);
    root.setProperty("--accent-rgb", `${n >> 16},${(n >> 8) & 255},${n & 255}`);
    root.setProperty("--accent-hover", mixWithWhite(hex, 0.12));
    root.setProperty("--accent-text", mixWithWhite(hex, 0.3));
    document.querySelectorAll(".swatch").forEach(b => b.classList.toggle("active", b.dataset.color === hex));
    try { localStorage.setItem("sp_accent", hex); } catch {}
}

const accentMenu = document.getElementById("accent-menu");
ACCENTS.forEach(({ name, color }) => {
    const b = document.createElement("button");
    b.className = "swatch";
    b.style.background = color;
    b.dataset.color = color;
    b.title = name;
    b.setAttribute("aria-label", name + " accent");
    b.addEventListener("click", e => { e.stopPropagation(); applyAccent(color); });
    accentMenu.appendChild(b);
});
let savedAccent = null;
try { savedAccent = localStorage.getItem("sp_accent"); } catch {}
applyAccent(ACCENTS.some(a => a.color === savedAccent) ? savedAccent : ACCENTS[0].color);

document.getElementById("accent-btn").addEventListener("click", e => {
    e.stopPropagation();
    accentMenu.classList.toggle("open");
});
document.addEventListener("click", e => {
    if (!accentMenu.contains(e.target)) accentMenu.classList.remove("open");
});

document.getElementById("fullscreen-btn").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
});

/* ═══════════════════════════════════════════
   MOBILE SIDEBAR
═══════════════════════════════════════════ */
const sidebarToggle = document.getElementById("sidebar-toggle");
const leftSection = document.getElementById("left-section");
const overlay = document.getElementById("mobile-overlay");

function setSidebar(open) {
    leftSection.classList.toggle("open", open);
    overlay.classList.toggle("active", open);
    sidebarToggle.classList.toggle("hidden", open);
}
sidebarToggle.addEventListener("click", () => setSidebar(true));
overlay.addEventListener("click", () => setSidebar(false));
document.getElementById("sidebar-close").addEventListener("click", () => setSidebar(false));
document.addEventListener("keydown", e => { if (e.key === "Escape") setSidebar(false); });

// Swipe left on the open drawer to close it
let swipeX = null;
leftSection.addEventListener("touchstart", e => { swipeX = e.touches[0].clientX; }, { passive: true });
leftSection.addEventListener("touchend", e => {
    if (swipeX !== null && swipeX - e.changedTouches[0].clientX > 60) setSidebar(false);
    swipeX = null;
});

/* ═══════════════════════════════════════════
   MAIN
═══════════════════════════════════════════ */
async function main() {
    document.getElementById("card-Container").innerHTML =
        `<div style="padding:24px;color:var(--lightgrey);font-size:14px;grid-column:1/-1;">Loading playlists…</div>`;
    let folderUrls;
    try {
        audiosBase = await findAudiosBase();
        folderUrls = await getFolders();
    } catch (err) {
        console.error("Failed to load folders:", err);
        document.getElementById("card-Container").innerHTML = `
            <div style="padding:24px;color:var(--lightgrey);font-size:14px;grid-column:1/-1;">
                ⚠️ Could not load playlists. Serve this project with a local web server (e.g. Live Server or <code>python3 -m http.server</code>) that has an <code>Audios</code> folder beside <code>index.html</code> or in its parent folder.
            </div>`;
        return;
    }

    const container = document.getElementById("card-Container");
    container.innerHTML = "";
    renderLibrarySongs();

    for (let i = 0; i < folderUrls.length; i++) {
        const folderUrl = folderUrls[i];
        const rawSegment = relFromBase(folderUrl);
        const { name, artist, category } = parseFolderName(rawSegment);
        const fKey = rawSegment.replace(/\/$/, "");

        allFolders.push({ url: folderUrl, name, artist, category, key: fKey });
        addCategoryFilter(category);

        const fav = isFavorited(fKey);

        const card = document.createElement("div");
        card.className = "card";
        card.dataset.category = category.toLowerCase();
        card.dataset.name = name.toLowerCase();
        card.dataset.artist = artist.toLowerCase();
        card.style.setProperty("--i", Math.min(i, 12));
        card.dataset.origIndex = i;
        card.dataset.folderIndex = i;
        card.dataset.folderKey = fKey;
        card.dataset.folderUrl = folderUrl;

        card.innerHTML = `
            <div class="playlist-img">
                <button class="card-fav-btn ${fav ? "favorited" : ""}" data-folder-key="${fKey}" title="${fav ? "Remove from favorites" : "Add to favorites"}">
                    ${fav
                        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color:var(--accent)"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
                        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`
                    }
                </button>
                <div class="playlist-play">
                    <div class="playlist-img-play">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="black"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                </div>
            </div>
            <h3 class="playlist-title">${name}</h3>
            <div class="artist-names"><span class="artist-name">${artist}</span></div>
            <span class="card-category-badge">${category}</span>`;

        container.appendChild(card);

        // Album cover: first image found inside the folder
        getFolderContent(folderUrl).then(({ cover, songs: folderSongs }) => {
            folderSongs.forEach(url => songIndex.push({
                url, folderUrl, album: name, artist, category,
                name: parseSongPath(url).songName
            }));
            if (cover) {
                card.dataset.cover = cover;
                coverByFolder.set(folderUrl, cover);
                card.querySelector(".playlist-img").style.backgroundImage = `url("${cover}")`;
            }
            if (searchQuery.trim()) applyFiltersAndSort();
        }).catch(() => {});

        // Favorite button on card
        card.querySelector(".card-fav-btn").addEventListener("click", async e => {
            e.stopPropagation();
            toggleFavorite(fKey);
            updateCardFavBtn(fKey);
            // If we sort by favorites, re-apply
            if (currentSort === "favorites") applyFiltersAndSort();
        });

        // Card click: preview its songs in the sidebar (no playback)
        card.addEventListener("click", async () => {
            if (viewFolder !== folderUrl) {
                try {
                    setView(folderUrl, await getFolderContent(folderUrl));
                } catch (err) {
                    console.error("Failed to load songs:", err);
                    return;
                }
            }
            if (window.innerWidth <= 768) setSidebar(true);
        });

        // Play button on the card: play this playlist (or pause/resume if it's the one playing)
        card.querySelector(".playlist-img-play").addEventListener("click", async e => {
            e.stopPropagation();
            if (currentFolder === folderUrl && songs.length) { togglePlayPause(); return; }
            let content;
            try { content = await getFolderContent(folderUrl); }
            catch (err) { console.error("Failed to load songs:", err); return; }
            setView(folderUrl, content);
            startQueue(folderUrl, content);
            if (songs.length) playAt(0);
        });
    }

    // Initial filter apply
    applyFiltersAndSort();
}

main();

// Lets the launcher's local server know the page is still open (it quits when it isn't)
setInterval(() => fetch("__ping", { cache: "no-store" }).catch(() => {}), 5000);
