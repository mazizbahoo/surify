"""Writes Audios/playlists.json so Surify works on static hosts like GitHub Pages.

Lists every playlist folder in Audios/ with its songs and cover image.
Run from anywhere: python3 Tools/build_playlists.py
"""
import json
import os
import re

AUDIOS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "Audios")
FILES = re.compile(r"\.(mp3|jpe?g|png|webp|gif|avif|bmp)$", re.I)

folders = {}
for name in sorted(os.listdir(AUDIOS)):
    path = os.path.join(AUDIOS, name)
    if os.path.isdir(path):
        folders[name] = sorted(f for f in os.listdir(path) if FILES.search(f))

with open(os.path.join(AUDIOS, "playlists.json"), "w", encoding="utf-8") as f:
    json.dump(folders, f, ensure_ascii=False, indent=2)
print(f"Wrote {len(folders)} playlists to Audios/playlists.json")
