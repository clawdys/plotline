/**
 * Plotline — AI Script Organizer
 * 
 * Takes a raw transcript and organizes it into screenplay format.
 * Uses rule-based formatting first, with optional AI enhancement via Anthropic API.
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try to load API key from .env in project root
let apiKey = process.env.ANTHROPIC_API_KEY;
try {
  const envPath = path.join(__dirname, '..', '.env');
  const envContent = await fs.readFile(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^ANTHROPIC_API_KEY=(.+)$/);
    if (match) apiKey = match[1].trim();
  }
} catch {}

/**
 * Organize transcript into script format
 */
export async function organizeScript(transcript, options = {}) {
  const { style = 'screenplay', instructions = '' } = options;

  // Always do rule-based first
  const ruleBasedScript = ruleBasedOrganize(transcript);

  // If API key available, enhance with AI
  if (apiKey) {
    try {
      return await aiOrganize(transcript, ruleBasedScript, style, instructions);
    } catch (err) {
      console.error('AI organization failed, using rule-based:', err.message);
      return ruleBasedScript;
    }
  }

  return ruleBasedScript;
}

/**
 * Rule-based transcript organization
 * Detects speakers, formats dialogue, identifies natural breaks
 */
function ruleBasedOrganize(transcript) {
  if (!transcript || !transcript.segments) return null;

  const elements = [];
  let currentSpeaker = null;
  let dialogueBuffer = [];
  let dialogueStart = null;
  let dialogueEnd = null;
  let segmentIds = [];

  for (const segment of transcript.segments) {
    // Detect speaker labels (e.g., "JOHN: Hello" or "[Speaker 1]: Hello")
    const speakerMatch = segment.text.match(/^(?:\[?)(SPEAKER[\s_]?\d+|[A-Z][A-Z\s]+)(?:\]?\s*[:]\s*)/);
    
    let speaker = speakerMatch ? speakerMatch[1].trim() : null;
    let text = speakerMatch ? segment.text.slice(speakerMatch[0].length).trim() : segment.text.trim();

    // Detect long pauses (>2s gap) as potential scene breaks
    if (elements.length > 0 || dialogueBuffer.length > 0) {
      const lastEnd = dialogueEnd || (elements.length > 0 ? elements[elements.length - 1].end : 0);
      if (segment.start - lastEnd > 3.0) {
        // Flush current dialogue
        if (dialogueBuffer.length > 0) {
          elements.push({
            type: 'dialogue',
            character: currentSpeaker || 'SPEAKER',
            text: dialogueBuffer.join(' '),
            segmentIds: [...segmentIds],
            start: dialogueStart,
            end: dialogueEnd
          });
          dialogueBuffer = [];
          segmentIds = [];
        }

        elements.push({
          type: 'scene_break',
          text: '---',
          start: lastEnd,
          end: segment.start
        });
      }
    }

    // Speaker change
    if (speaker && speaker !== currentSpeaker) {
      // Flush previous speaker's dialogue
      if (dialogueBuffer.length > 0) {
        elements.push({
          type: 'dialogue',
          character: currentSpeaker || 'SPEAKER',
          text: dialogueBuffer.join(' '),
          segmentIds: [...segmentIds],
          start: dialogueStart,
          end: dialogueEnd
        });
        dialogueBuffer = [];
        segmentIds = [];
      }
      currentSpeaker = speaker;
      dialogueStart = segment.start;
    }

    if (!dialogueStart) dialogueStart = segment.start;
    dialogueEnd = segment.end;
    dialogueBuffer.push(text);
    segmentIds.push(segment.id);
  }

  // Flush remaining
  if (dialogueBuffer.length > 0) {
    elements.push({
      type: 'dialogue',
      character: currentSpeaker || 'SPEAKER',
      text: dialogueBuffer.join(' '),
      segmentIds: [...segmentIds],
      start: dialogueStart,
      end: dialogueEnd
    });
  }

  return {
    format: style || 'screenplay',
    elements,
    organized: true,
    method: 'rule-based'
  };
}

/**
 * AI-enhanced script organization using Claude
 */
async function aiOrganize(transcript, ruleBasedScript, style, instructions) {
  const client = new Anthropic({ apiKey });

  const fullText = transcript.segments.map((s, i) => 
    `[${formatTime(s.start)} → ${formatTime(s.end)}] (seg ${s.id}) ${s.text}`
  ).join('\n');

  const systemPrompt = `You are a script formatting assistant. Your job is to take a raw audio transcript with timecodes and organize it into a proper ${style} format.

Rules:
- Identify distinct speakers and assign character names (SPEAKER A, SPEAKER B, etc. or more descriptive names if context allows)
- Add scene headings (INT./EXT.) where appropriate based on context clues
- Format dialogue with character names in caps
- Add parentheticals for tone/delivery when obvious from context
- Identify action/description lines vs dialogue
- Preserve ALL timecodes — every piece of text must map back to its original segment IDs and timestamps
- Do NOT add content that wasn't in the original transcript
- Clean up filler words (um, uh, like) unless they're character-defining

${instructions ? `Additional instructions: ${instructions}` : ''}

Return a JSON object with this exact structure:
{
  "format": "${style}",
  "elements": [
    {
      "type": "scene_heading",
      "text": "INT. LOCATION - TIME",
      "start": null,
      "end": null,
      "segmentIds": []
    },
    {
      "type": "dialogue",
      "character": "CHARACTER NAME",
      "text": "The dialogue text...",
      "parenthetical": "(optional tone note)",
      "start": 0.0,
      "end": 2.5,
      "segmentIds": [0, 1]
    },
    {
      "type": "action",
      "text": "Description of action...",
      "start": 3.0,
      "end": 4.0,
      "segmentIds": [2]
    }
  ],
  "organized": true,
  "method": "ai"
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Here is the transcript to organize:\n\n${fullText}`
    }]
  });

  const text = response.content[0].text;
  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No valid JSON in AI response');

  const result = JSON.parse(jsonMatch[0]);
  return result;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}
