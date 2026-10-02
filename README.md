<p align="center">
  <img src="Icons/surify_logo_transparent.png" alt="Surify logo" width="120">
</p>

<h1 align="center">Surify</h1>

<p align="center">
  A <b>Spotify clone</b> that plays the music on your own computer.<br>
  Built with plain HTML, CSS and JavaScript. No frameworks, no accounts, nothing to install except Python.
</p>

<p align="center">
  <a href="https://mazizbahoo.github.io/surify/"><b>▶ Try the live demo</b></a>
</p>

---

## About

Surify is a Spotify-style music player for your local MP3 collection. Every folder inside `Audios/` becomes a playlist, complete with cover art, artist and genre. The interface is modeled on Spotify's: a library sidebar, playlist cards, a bottom player bar and search.

## Features

- **Spotify-like interface**: library sidebar, playlist cards and a player bar with seek and volume sliders
- **Automatic playlists**: drop a folder of MP3s into `Audios/` and it appears in the app
- **Search** across all playlists and songs
- **Filter by genre** and **sort** playlists (A–Z, Z–A, by artist, favorites first)
- **Favorites**: like songs and playlists, then filter your library to show only favorites
- **Shuffle** and **repeat** (off / all / one)
- **Accent colors**: pick from Coral, Sky, Amber, Pink, Teal or Green
- **Keyboard shortcuts**
- **Desktop launchers** for macOS and Windows that start the app with a double-click
- Your favorites and settings are saved in the browser, so they survive restarts

## Requirements

| Platform | What you need |
|---|---|
| macOS / Linux | [Python 3](https://www.python.org/downloads/) (`python3`) and a modern browser |
| Windows | Nothing extra: the launcher uses the built-in PowerShell |

## Setup

1. **Download the project**

   ```bash
   git clone https://github.com/mazizbahoo/surify.git
   cd surify
   ```

   Or click **Code → Download ZIP** on GitHub and unzip it.

2. **Add your music** (optional; a few sample playlists are included)

   Create a folder inside `Audios/` for each playlist, named like this:

   ```
   Playlist Name-Artist-Category
   ```

   Put your `.mp3` files in it, plus **one image** (`.jpg`, `.png`, `.webp`…) to use as the cover:

   ```
   Audios/
   └── Punjabi Chill-Bilal Saeed-Punjabi/
       ├── cover.jpeg
       ├── Baari.mp3
       └── Twinkle Twinkle.mp3
   ```

   - The **last** part of the name becomes the genre filter (e.g. `Punjabi`).
   - `Playlist Name-Artist` also works; the genre then defaults to *Music*.
   - Song titles come from the file names, so `Baari.mp3` shows as **Baari**.

## Running the app

Surify reads your `Audios` folder through a small local web server, so it can't be opened by double-clicking `index.html`. Pick one of these options:

### macOS

Double-click **`Surify.app`**. It starts the server and opens Surify in your browser.

> **First launch:** macOS may block the app because it isn't from the App Store. Right-click `Surify.app` → **Open** → **Open**. You only need to do this once.

### Windows

Double-click **`Surify.vbs`**. It starts the server in the background and opens your browser.

### Any platform (terminal)

```bash
python3 Launcher/server.py
```

Then go to **http://localhost:8765** if the browser doesn't open on its own.

The server stops by itself about two minutes after you close the Surify tab. Nothing keeps running in the background.

> **Using VS Code Live Server instead?** Open `App/index.html` with Live Server and it works too, as long as `Audios/` is next to the app folder.

## How to use

| Action | How |
|---|---|
| Play a playlist | Click the play button on a playlist card |
| Play a specific song | Open a playlist in the sidebar and click a song |
| Search | Type in the search bar to find playlists and songs |
| Filter by genre | Click a genre chip at the top (All, Pop, Qawwali, Romantic…) |
| Sort playlists | Use the sort menu: A–Z, Z–A, Artist, Favorites |
| Like a song or playlist | Click the heart icon |
| Show only favorites | Switch the library filter to **Favorites** |
| Shuffle / Repeat | Use the buttons in the player bar (repeat cycles off → all → one) |
| Change the theme color | Click the colored dot in the top bar and pick an accent |
| Seek / Volume | Click or drag the progress bar and volume slider |

### Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `→` | Next song |
| `←` | Previous song |
| `Esc` | Close the sidebar (mobile view) |

## Project structure

```
surify/
├── App/index.html        # The app page
├── Styles/style.css      # All styling
├── Scripts/script.js     # Player logic, playlists, search, favorites
├── Fonts/                # Spotify-style fonts
├── Icons/                # Logo, favicon, app icons
├── Audios/               # Your playlists (one folder per playlist)
├── Launcher/
│   ├── server.py         # Local server for macOS / Linux
│   └── server.ps1        # Local server for Windows
├── Tools/build_playlists.py  # Generates Audios/playlists.json for GitHub Pages
├── index.html            # Redirects to App/ (for GitHub Pages)
├── Surify.app            # macOS launcher
└── Surify.vbs            # Windows launcher
```

## Hosting on GitHub Pages

The repo deploys itself to GitHub Pages with the workflow in `.github/workflows/pages.yml`.

GitHub Pages can't list folders, so on every push the workflow runs `Tools/build_playlists.py`, which writes `Audios/playlists.json` listing every playlist, song and cover. When folder listing isn't available, the app reads that file instead.

To host your own copy:
1. Fork or push the repo to GitHub.
2. Go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`. Your site will be at `https://<username>.github.io/surify/`.

## Troubleshooting

- **"Could not load playlists"**: the page was opened directly as a file. Start it with one of the launchers above.
- **macOS says Python 3 is required**: install it from [python.org](https://www.python.org/downloads/).
- **A playlist has no cover**: add any image file to that playlist's folder.
- **Port 8765 is already in use**: Surify is probably already running. The launcher will just open it in your browser.

## Disclaimer

Surify is a personal learning project inspired by Spotify and isn't affiliated with Spotify. The sample songs are included only to demo the player; all music belongs to its respective artists and labels.

## Author

**Muhammad Aziz**: [GitHub](https://github.com/mazizbahoo)
