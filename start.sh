#!/bin/bash
# Plotline — Launch Script
# On-device audio transcription → script editing → FCPXML export

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Check dependencies
if ! command -v whisper-cli &> /dev/null; then
  echo "❌ whisper-cpp not found. Install: brew install whisper-cpp"
  exit 1
fi

if ! command -v ffmpeg &> /dev/null; then
  echo "❌ ffmpeg not found. Install: brew install ffmpeg"
  exit 1
fi

if [ ! -f "data/models/ggml-small.bin" ]; then
  echo "⚠️  Whisper model not found. Downloading small model (~465MB)..."
  mkdir -p data/models
  curl -L -o data/models/ggml-small.bin \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
fi

if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

echo ""
echo "  🎬 Starting Plotline..."
echo ""

node server.js
