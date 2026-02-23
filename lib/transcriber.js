/**
 * transcriber.js — On-device audio transcription via whisper-cpp on Apple Silicon.
 *
 * Wraps the Homebrew-installed whisper-cpp CLI, handling automatic conversion
 * of arbitrary audio formats to 16 kHz mono WAV (via ffmpeg) before transcription.
 *
 * Exports:
 *   transcribeAudio(audioPath, options) → Promise<TranscriptionResult>
 *   getAvailableModels(modelsDir)       → Promise<string[]>
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, extname, resolve } from 'node:path';

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Paths to external binaries (Homebrew on Apple Silicon)
// ---------------------------------------------------------------------------
const WHISPER_BIN = '/opt/homebrew/bin/whisper-cpp';
const FFMPEG_BIN = '/opt/homebrew/bin/ffmpeg';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check that a file exists and is readable.
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a whisper-cpp timestamp string "HH:MM:SS,mmm" into seconds (float).
 * @param {string} ts  e.g. "00:01:23,456"
 * @returns {number}
 */
function parseTimestamp(ts) {
  const [hms, ms] = ts.split(',');
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s + Number(ms) / 1000;
}

/**
 * Get the duration of an audio file via ffprobe (ships alongside ffmpeg).
 * @param {string} audioPath
 * @returns {Promise<number>} duration in seconds
 */
async function getAudioDuration(audioPath) {
  const ffprobeBin = FFMPEG_BIN.replace(/ffmpeg$/, 'ffprobe');
  try {
    const { stdout } = await execFile(ffprobeBin, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ], { maxBuffer: 1024 * 1024 });
    const dur = parseFloat(stdout.trim());
    return Number.isFinite(dur) ? dur : 0;
  } catch {
    return 0;
  }
}

/**
 * Convert any audio file to 16 kHz mono WAV suitable for whisper-cpp.
 * @param {string} inputPath   Path to source audio.
 * @param {string} outputPath  Destination .wav path.
 * @returns {Promise<void>}
 */
async function convertToWav16k(inputPath, outputPath) {
  console.log(`[transcriber] Converting "${basename(inputPath)}" → 16 kHz mono WAV …`);
  try {
    await execFile(FFMPEG_BIN, [
      '-y',                // overwrite without asking
      '-i', inputPath,
      '-ar', '16000',      // 16 kHz sample rate
      '-ac', '1',          // mono
      '-c:a', 'pcm_s16le', // 16-bit signed little-endian PCM
      '-f', 'wav',
      outputPath,
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 300_000 });
  } catch (err) {
    throw new Error(
      `[transcriber] ffmpeg conversion failed for "${basename(inputPath)}": ${err.stderr || err.message}`
    );
  }
}

/**
 * Run whisper-cpp and return the parsed JSON object.
 *
 * whisper-cpp with --output-json writes a `.json` file next to the input file
 * (e.g. /tmp/xyz/audio.wav → /tmp/xyz/audio.wav.json).  We read that file
 * rather than relying on stdout (which contains the coloured text output).
 *
 * @param {string} wavPath
 * @param {string} modelPath
 * @param {string} language
 * @returns {Promise<object>}
 */
async function runWhisper(wavPath, modelPath, language) {
  const args = [
    '--model', modelPath,
    '--language', language,
    '--output-json',
    '--print-colors',
    '--file', wavPath,
  ];

  console.log(`[transcriber] Running whisper-cpp (model: ${basename(modelPath)}, lang: ${language}) …`);

  try {
    // whisper-cpp may emit progress on stderr; stdout has the coloured text.
    // The JSON output is written to <wavPath>.json.
    await execFile(WHISPER_BIN, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 600_000, // 10 min max per transcription
    });
  } catch (err) {
    throw new Error(
      `[transcriber] whisper-cpp failed: ${err.stderr?.slice(0, 500) || err.message}`
    );
  }

  // Read the JSON sidecar file
  const jsonPath = `${wavPath}.json`;
  if (!(await fileExists(jsonPath))) {
    throw new Error(
      `[transcriber] whisper-cpp did not produce JSON output at "${jsonPath}".`
    );
  }

  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(jsonPath, 'utf-8');

  try {
    return JSON.parse(raw);
  } catch (parseErr) {
    throw new Error(
      `[transcriber] Failed to parse whisper-cpp JSON output: ${parseErr.message}`
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transcribe an audio file using whisper-cpp.
 *
 * @param {string} audioPath  Path to the audio file (any format ffmpeg supports).
 * @param {object} [options]
 * @param {string} [options.modelSize='small']   Whisper model size (tiny, base, small, medium, large).
 * @param {string} [options.language='en']        Language code.
 * @param {string} [options.modelsDir]            Directory containing ggml-*.bin model files.
 * @returns {Promise<{ segments: Array, duration: number, language: string }>}
 */
export async function transcribeAudio(audioPath, options = {}) {
  const {
    modelSize = 'small',
    language = 'en',
    modelsDir,
  } = options;

  // --- Validate inputs ---
  if (!audioPath) {
    throw new Error('[transcriber] audioPath is required.');
  }
  if (!modelsDir) {
    throw new Error('[transcriber] options.modelsDir is required.');
  }

  const resolvedAudio = resolve(audioPath);
  if (!(await fileExists(resolvedAudio))) {
    throw new Error(`[transcriber] Audio file not found: "${resolvedAudio}"`);
  }

  // Check the whisper-cpp binary
  if (!(await fileExists(WHISPER_BIN))) {
    throw new Error(
      `[transcriber] whisper-cpp binary not found at "${WHISPER_BIN}". Install via: brew install whisper-cpp`
    );
  }

  // Check the ffmpeg binary
  if (!(await fileExists(FFMPEG_BIN))) {
    throw new Error(
      `[transcriber] ffmpeg binary not found at "${FFMPEG_BIN}". Install via: brew install ffmpeg`
    );
  }

  // Check the model file
  const modelPath = join(resolve(modelsDir), `ggml-${modelSize}.bin`);
  if (!(await fileExists(modelPath))) {
    const available = await getAvailableModels(modelsDir);
    throw new Error(
      `[transcriber] Model file not found: "${modelPath}". ` +
      `Available models in "${modelsDir}": ${available.length ? available.join(', ') : '(none)'}`
    );
  }

  // --- Create temp directory for intermediate WAV ---
  let tmpDir;
  try {
    tmpDir = await mkdtemp(join(tmpdir(), 'transcriber-'));
  } catch (err) {
    throw new Error(`[transcriber] Could not create temp directory: ${err.message}`);
  }

  const wavPath = join(tmpDir, 'audio.wav');

  try {
    // --- Step 1: Convert to 16 kHz WAV ---
    await convertToWav16k(resolvedAudio, wavPath);

    // --- Step 2: Get duration from the converted WAV ---
    const duration = await getAudioDuration(wavPath);

    // --- Step 3: Run whisper-cpp ---
    const whisperOutput = await runWhisper(wavPath, modelPath, language);

    // --- Step 4: Transform output into internal format ---
    const rawSegments = whisperOutput?.transcription ?? [];

    const segments = rawSegments.map((seg, index) => {
      // Offsets are in milliseconds; fall back to parsing timestamps.
      const startMs = seg.offsets?.from;
      const endMs = seg.offsets?.to;

      const start = startMs != null
        ? startMs / 1000
        : parseTimestamp(seg.timestamps?.from ?? '00:00:00,000');
      const end = endMs != null
        ? endMs / 1000
        : parseTimestamp(seg.timestamps?.to ?? '00:00:00,000');

      // whisper-cpp often prepends a space to text; trim it.
      const text = (seg.text ?? '').trim();

      // Build word-level entries from tokens if present.
      const words = [];
      if (Array.isArray(seg.tokens)) {
        for (const tok of seg.tokens) {
          // Each token may have: { text, timestamps: {from, to}, offsets: {from, to}, ... }
          const tokText = (tok.text ?? '').trim();
          if (!tokText) continue;

          const wStart = tok.offsets?.from != null
            ? tok.offsets.from / 1000
            : (tok.timestamps?.from ? parseTimestamp(tok.timestamps.from) : start);
          const wEnd = tok.offsets?.to != null
            ? tok.offsets.to / 1000
            : (tok.timestamps?.to ? parseTimestamp(tok.timestamps.to) : end);

          words.push({
            text: tokText,
            start: wStart,
            end: wEnd,
          });
        }
      }

      return {
        id: index,
        start,
        end,
        text,
        words,
      };
    });

    // Compute final duration: prefer the audio-file duration, fall back to
    // the end timestamp of the last segment.
    const finalDuration = duration > 0
      ? Math.round(duration * 1000) / 1000
      : (segments.length > 0 ? segments[segments.length - 1].end : 0);

    const result = {
      segments,
      duration: finalDuration,
      language,
    };

    console.log(
      `[transcriber] Done — ${segments.length} segment(s), ` +
      `${finalDuration.toFixed(1)}s, lang=${language}`
    );

    return result;
  } finally {
    // --- Cleanup temp directory ---
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Non-fatal; temp files will be cleaned by the OS eventually.
      console.warn(`[transcriber] Warning: could not remove temp dir "${tmpDir}".`);
    }
  }
}

/**
 * List available whisper-cpp model files in a directory.
 *
 * Looks for files matching the pattern `ggml-*.bin` and returns the model
 * size names (e.g. ["tiny", "small", "medium"]).
 *
 * @param {string} modelsDir  Path to the directory containing model .bin files.
 * @returns {Promise<string[]>}  Array of model size names.
 */
export async function getAvailableModels(modelsDir) {
  const resolvedDir = resolve(modelsDir);

  try {
    await access(resolvedDir, fsConstants.R_OK);
  } catch {
    return [];
  }

  let entries;
  try {
    entries = await readdir(resolvedDir);
  } catch {
    return [];
  }

  const models = [];

  for (const entry of entries) {
    if (entry.startsWith('ggml-') && entry.endsWith('.bin')) {
      // e.g. "ggml-small.bin" → "small"
      //      "ggml-large-v3.bin" → "large-v3"
      const name = entry.slice('ggml-'.length, -'.bin'.length);
      if (name) {
        // Verify it's actually a file (not a directory)
        try {
          const info = await stat(join(resolvedDir, entry));
          if (info.isFile()) {
            models.push(name);
          }
        } catch {
          // skip entries we can't stat
        }
      }
    }
  }

  return models.sort();
}
