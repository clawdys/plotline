# Plotline

**On-device transcription → script editing → timeline export. Built for filmmakers.**

Plotline transcribes audio locally using [whisper.cpp](https://github.com/ggerganov/whisper.cpp) on Apple Silicon — no cloud uploads, no subscriptions. Edit the transcript, optionally reorganize it into screenplay format with AI, align it against your written script for paper edits, and export directly to Final Cut Pro (FCPXML) or DaVinci Resolve (XML).

---

## Features

- **Local Transcription** — Runs whisper.cpp on-device. Your audio never leaves your machine.
- **Word-Level Timestamps** — Every word is timestamped for precise editing and alignment.
- **Script-to-Cut Alignment (Paper Edit)** — Paste or import your written script, align it against the transcript, and generate an assembly cut in script order — all without an API key.
- **AI Script Organization** *(optional)* — Uses Claude to organize raw transcripts into screenplay format with scene headings, speaker identification, and action lines. Works without an API key via rule-based fallback.
- **FCPXML Export** — Import directly into Final Cut Pro with clips, markers, and timecodes.
- **DaVinci Resolve XML Export** — FCP7-compatible XML that Resolve reads natively.
- **Assembly Cut Export** — Generate a rough cut timeline from your paper edit alignment with handles and slug clips for unmatched lines.
- **Dark UI** — Designed for late-night editing sessions.

## Screenshots

*Coming soon.*

## Prerequisites

- **macOS** (Apple Silicon recommended — Intel works but transcription is slower)
- **Homebrew** — [brew.sh](https://brew.sh)
- **whisper-cpp** — `brew install whisper-cpp`
- **ffmpeg** — `brew install ffmpeg`
- **Node.js 22+** — `brew install node`

```bash
# Install all prerequisites at once
brew install whisper-cpp ffmpeg node
```

The Whisper model (~465 MB) downloads automatically on first transcription.

## Quick Start

### Option A: Run the Electron App

```bash
git clone https://github.com/clawdys/plotline.git
cd plotline
npm install
npm start
```

### Option B: Run as a Web Server (no Electron)

```bash
git clone https://github.com/clawdys/plotline.git
cd plotline
npm install
npm run server
# Open http://localhost:3847
```

## Building from Source

```bash
npm run dist:mac
```

This produces a `.dmg` and `.zip` in the `release/` directory.

## Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | *(empty)* | Optional. Enables AI-powered script organization via Claude. Without it, Plotline uses rule-based formatting. |
| `PLOTLINE_PORT` | `3847` | Server port. |

## How It Works

1. **Upload** an audio or video file (WAV, MP3, M4A, MP4, MOV, etc.)
2. **Transcribe** — Plotline converts it to 16 kHz WAV via ffmpeg, then runs whisper-cpp locally. You get a full transcript with word-level timestamps.
3. **Edit** — Clean up the transcript in the built-in editor. Fix names, remove filler words, restructure.
4. **Organize** *(optional)* — Click "Organize" to format the transcript as a screenplay. Uses AI if you have an API key, otherwise uses smart rule-based formatting.
5. **Paper Edit** *(optional)* — Paste your written script, hit "Align," and Plotline maps each script line to the matching transcript segment using word overlap, longest common subsequence, and word-order scoring with dynamic programming.
6. **Export** — Generate FCPXML (Final Cut Pro) or Resolve XML. Or export an assembly cut from your paper edit alignment — clips arranged in script order with handles.

## Paper Edit (Script-to-Cut Alignment)

The Paper Edit feature lets you work the way professional editors do:

1. Write or import your script (`.txt`, `.md`, or `.fountain`)
2. Click **Align Script** — Plotline matches each script line to transcript segments using:
   - Jaccard word overlap scoring
   - Longest Common Subsequence ratio
   - Word order correlation
   - Dynamic programming for globally optimal alignment
3. Review the alignment — lines are color-coded by confidence (green/yellow/red)
4. Click **Generate Assembly Cut** — exports an FCPXML/Resolve timeline with clips in script order, 0.5-second handles, and slug clips for unmatched lines

No API key required. Everything runs locally.

## Tech Stack

- **Backend:** Node.js + Express (ESM)
- **Transcription:** whisper.cpp via Homebrew
- **Audio conversion:** ffmpeg
- **AI (optional):** Anthropic Claude SDK
- **Desktop:** Electron
- **Frontend:** Vanilla HTML/CSS/JS (no build step)

## License

UNLICENSED — All rights reserved.
