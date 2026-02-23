/**
 * xml-export.js — FCPXML 1.11 and DaVinci Resolve (FCP7) XML export
 *
 * Generates timeline XML from Plotline project data (script or transcript).
 * No external dependencies — pure template-literal XML construction.
 *
 * @module xml-export
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Escape special XML characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeXML(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert seconds (float) to FCPXML rational time format.
 * E.g. 2.5 → "2500/1000s"
 *
 * Uses millisecond precision (denominator 1000) which FCPXML handles natively.
 * For zero we return "0/1s" (the canonical FCPXML zero).
 *
 * @param {number} seconds
 * @returns {string} Rational time string like "2500/1000s"
 */
export function secondsToRational(seconds) {
  if (seconds == null || seconds <= 0) return '0/1s';
  // Work in milliseconds to avoid floating-point drift
  const ms = Math.round(seconds * 1000);
  return `${ms}/1000s`;
}

/**
 * Convert seconds to an integer frame count.
 * @param {number} seconds
 * @param {number} [fps=30]
 * @returns {number}
 */
export function secondsToFrames(seconds, fps = 30) {
  if (seconds == null || seconds < 0) return 0;
  return Math.round(seconds * fps);
}

/**
 * Convert seconds to SMPTE timecode "HH:MM:SS:FF".
 * @param {number} seconds
 * @param {number} [fps=30]
 * @returns {string}
 */
export function secondsToTimecode(seconds, fps = 30) {
  if (seconds == null || seconds < 0) seconds = 0;
  const totalFrames = Math.round(seconds * fps);
  const ff = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const ss = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mm = totalMinutes % 60;
  const hh = Math.floor(totalMinutes / 60);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

// ─── Internal: normalise source items ───────────────────────────────────────

/**
 * @typedef {Object} TimelineItem
 * @property {string}  type       - 'scene_heading' | 'dialogue' | 'action' | 'scene_break' | 'segment'
 * @property {string}  text
 * @property {string|null} character
 * @property {number|null} start
 * @property {number|null} end
 */

/**
 * Extract a flat list of timeline items from whichever source is available.
 * Prefers project.script; falls back to project.transcript.
 * @param {Object} project
 * @returns {TimelineItem[]}
 */
function getTimelineItems(project) {
  if (project.script && Array.isArray(project.script.elements)) {
    return project.script.elements.map((el) => ({
      type: el.type || 'action',
      text: el.text || '',
      character: el.character || null,
      start: el.start ?? null,
      end: el.end ?? null,
    }));
  }

  if (project.transcript && Array.isArray(project.transcript.segments)) {
    return project.transcript.segments.map((seg) => ({
      type: 'segment',
      text: seg.text || '',
      character: null,
      start: seg.start ?? null,
      end: seg.end ?? null,
    }));
  }

  return [];
}

/**
 * Compute the total duration from items or from project metadata.
 * @param {Object} project
 * @param {TimelineItem[]} items
 * @returns {number} duration in seconds
 */
function getDuration(project, items) {
  if (project.transcript?.duration) return project.transcript.duration;
  let max = 0;
  for (const it of items) {
    if (it.end != null && it.end > max) max = it.end;
  }
  return max || 0;
}

// ─── FCPXML 1.11 ───────────────────────────────────────────────────────────

/**
 * Generate an FCPXML 1.11 document string from a Plotline project.
 *
 * Structure:
 *   fcpxml > resources
 *          > library > event > project > sequence > spine
 *
 * @param {Object} project
 * @returns {string} Complete FCPXML document
 */
export function exportFCPXML(project) {
  const items = getTimelineItems(project);
  const duration = getDuration(project, items);
  const projName = escapeXML(project.name || 'Untitled');
  const audioFile = escapeXML(project.audioFile || 'audio.wav');
  const audioPath = escapeXML(project.audioPath || project.audioFile || 'audio.wav');
  const durationRat = secondsToRational(duration);

  // Resource IDs
  const formatId = 'r1';
  const assetId = 'r2';

  // Build spine children
  const spineChildren = [];
  let offsetAccumulator = 0; // track implicit offset for untimed items

  for (const item of items) {
    const hasTime = item.start != null && item.end != null;
    const start = hasTime ? item.start : null;
    const end = hasTime ? item.end : null;
    const itemDuration = hasTime ? end - start : 0;
    const text = escapeXML(item.text);

    if (item.type === 'scene_heading') {
      // Title element — text overlay for scene headings
      // If untimed, use a short 1-second placeholder duration
      const titleDur = hasTime ? itemDuration : 1;
      const titleOffset = hasTime ? start : offsetAccumulator;
      spineChildren.push(
        `            <title name="${text}" lane="1" offset="${secondsToRational(titleOffset)}" duration="${secondsToRational(titleDur)}" ref="${formatId}">` +
        `\n              <text>` +
        `\n                <text-style ref="ts1">${text}</text-style>` +
        `\n              </text>` +
        `\n              <text-style-def id="ts1">` +
        `\n                <text-style font="Helvetica" fontSize="36" fontColor="1 1 1 1" bold="1"/>` +
        `\n              </text-style-def>` +
        `\n              <note>${text}</note>` +
        `\n            </title>`
      );
      if (!hasTime) offsetAccumulator += titleDur;
    } else if (item.type === 'scene_break') {
      // Marker on a gap clip for scene breaks
      const breakDur = hasTime ? itemDuration : 1;
      const breakOffset = hasTime ? start : offsetAccumulator;
      spineChildren.push(
        `            <gap name="Scene Break" offset="${secondsToRational(breakOffset)}" duration="${secondsToRational(breakDur)}">` +
        `\n              <marker start="${secondsToRational(breakOffset)}" duration="${secondsToRational(breakDur)}" value="${text}"/>` +
        `\n              <note>${text}</note>` +
        `\n            </gap>`
      );
      if (!hasTime) offsetAccumulator += breakDur;
    } else {
      // dialogue, action, segment — audio clip referencing the asset
      if (!hasTime) continue; // skip items with no timing

      const clipName = item.character
        ? `${escapeXML(item.character)}: ${text}`
        : text;

      spineChildren.push(
        `            <clip name="${clipName}" offset="${secondsToRational(start)}" duration="${secondsToRational(itemDuration)}" start="${secondsToRational(start)}">` +
        `\n              <audio ref="${assetId}" offset="${secondsToRational(start)}" duration="${secondsToRational(itemDuration)}" srcCh="1, 2" role="dialogue"/>` +
        `\n              <note>${text}</note>` +
        `\n            </clip>`
      );
      offsetAccumulator = end;
    }
  }

  const spineXML = spineChildren.join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.11">

  <resources>
    <format id="${formatId}" name="FFVideoFormat1080p30" frameDuration="100/3000s" width="1920" height="1080"/>
    <asset id="${assetId}" name="${audioFile}" src="file://${audioPath}" start="0/1s" duration="${durationRat}" hasAudio="1" hasVideo="0" audioSources="1" audioChannels="2" audioRate="48000"/>
  </resources>

  <library>
    <event name="${projName}">
      <project name="${projName}">
        <sequence format="${formatId}" duration="${durationRat}" tcStart="0/1s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spineXML}
          </spine>
        </sequence>
      </project>
    </event>
  </library>

</fcpxml>
`;
}

// ─── FCPXML Assembly Cut (from alignment) ───────────────────────────────────

/**
 * Generate an FCPXML assembly cut from a Paper Edit alignment.
 * Clips are arranged in script order with 0.5s handles.
 * Unmatched script lines get a 2-second slug (gap) clip.
 *
 * @param {Object} project  Must have .alignment and optionally .transcript
 * @returns {string} FCPXML document
 */
export function exportAssemblyFCPXML(project) {
  const alignment = project.alignment;
  if (!alignment || !Array.isArray(alignment.entries)) {
    throw new Error('No alignment data in project');
  }

  const projName = escapeXML((project.name || 'Untitled') + ' — Assembly');
  const audioFile = escapeXML(project.audioFile || 'audio.wav');
  const audioPath = escapeXML(project.audioPath || project.audioFile || 'audio.wav');
  const transcript = project.transcript;
  const totalDuration = transcript?.duration || 0;
  const durationRat = secondsToRational(totalDuration);
  const HANDLE = 0.5; // seconds
  const SLUG_DURATION = 2; // seconds for unmatched lines

  const formatId = 'r1';
  const assetId = 'r2';

  const spineChildren = [];
  let timelineOffset = 0;

  for (const entry of alignment.entries) {
    if (entry.status === 'unmatched' || entry.trimmedStart == null || entry.trimmedEnd == null) {
      // Slug clip for unmatched lines
      const note = escapeXML(`[UNMATCHED] ${entry.scriptLine}`);
      spineChildren.push(
        `            <gap name="${note}" offset="${secondsToRational(timelineOffset)}" duration="${secondsToRational(SLUG_DURATION)}">` +
        `\n              <note>${note}</note>` +
        `\n            </gap>`
      );
      timelineOffset += SLUG_DURATION;
    } else {
      // Audio clip with handles
      const clipStart = Math.max(0, entry.trimmedStart - HANDLE);
      const clipEnd = Math.min(totalDuration || Infinity, entry.trimmedEnd + HANDLE);
      const clipDuration = clipEnd - clipStart;
      const clipName = escapeXML(entry.scriptLine.slice(0, 80));

      spineChildren.push(
        `            <clip name="${clipName}" offset="${secondsToRational(timelineOffset)}" duration="${secondsToRational(clipDuration)}" start="${secondsToRational(clipStart)}">` +
        `\n              <audio ref="${assetId}" offset="${secondsToRational(clipStart)}" duration="${secondsToRational(clipDuration)}" srcCh="1, 2" role="dialogue"/>` +
        `\n              <note>${escapeXML(entry.scriptLine)}\n[Confidence: ${entry.confidence}]</note>` +
        `\n            </clip>`
      );
      timelineOffset += clipDuration;
    }
  }

  const assemblyDurationRat = secondsToRational(timelineOffset);
  const spineXML = spineChildren.join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.11">

  <resources>
    <format id="${formatId}" name="FFVideoFormat1080p30" frameDuration="100/3000s" width="1920" height="1080"/>
    <asset id="${assetId}" name="${audioFile}" src="file://${audioPath}" start="0/1s" duration="${durationRat}" hasAudio="1" hasVideo="0" audioSources="1" audioChannels="2" audioRate="48000"/>
  </resources>

  <library>
    <event name="${projName}">
      <project name="${projName}">
        <sequence format="${formatId}" duration="${assemblyDurationRat}" tcStart="0/1s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spineXML}
          </spine>
        </sequence>
      </project>
    </event>
  </library>

</fcpxml>
`;
}

// ─── DaVinci Resolve Assembly Cut ───────────────────────────────────────────

/**
 * Generate a DaVinci Resolve–compatible FCP7 XML assembly cut from alignment.
 * @param {Object} project
 * @returns {string} XMEML document
 */
export function exportAssemblyResolveXML(project) {
  const alignment = project.alignment;
  if (!alignment || !Array.isArray(alignment.entries)) {
    throw new Error('No alignment data in project');
  }

  const projName = escapeXML((project.name || 'Untitled') + ' — Assembly');
  const audioFile = escapeXML(project.audioFile || 'audio.wav');
  const audioPath = escapeXML(project.audioPath || project.audioFile || 'audio.wav');
  const transcript = project.transcript;
  const totalDuration = transcript?.duration || 0;
  const fps = 30;
  const HANDLE = 0.5;
  const SLUG_DURATION = 2;

  const fileId = 'file-1';
  const clipItems = [];
  let clipIndex = 1;
  let timelineFrame = 0;

  for (const entry of alignment.entries) {
    if (entry.status === 'unmatched' || entry.trimmedStart == null || entry.trimmedEnd == null) {
      const slugFrames = secondsToFrames(SLUG_DURATION, fps);
      clipItems.push(
        `          <clipitem id="clipitem-${clipIndex}">` +
        `\n            <name>${escapeXML('[SLUG] ' + entry.scriptLine.slice(0, 60))}</name>` +
        `\n            <duration>${slugFrames}</duration>` +
        `\n            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>` +
        `\n            <start>${timelineFrame}</start>` +
        `\n            <end>${timelineFrame + slugFrames}</end>` +
        `\n            <in>0</in>` +
        `\n            <out>${slugFrames}</out>` +
        `\n          </clipitem>`
      );
      timelineFrame += slugFrames;
      clipIndex++;
    } else {
      const clipStart = Math.max(0, entry.trimmedStart - HANDLE);
      const clipEnd = Math.min(totalDuration || Infinity, entry.trimmedEnd + HANDLE);
      const inFrame = secondsToFrames(clipStart, fps);
      const outFrame = secondsToFrames(clipEnd, fps);
      const dur = outFrame - inFrame;

      clipItems.push(
        `          <clipitem id="clipitem-${clipIndex}">` +
        `\n            <name>${escapeXML(entry.scriptLine.slice(0, 80))}</name>` +
        `\n            <duration>${dur}</duration>` +
        `\n            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>` +
        `\n            <in>${inFrame}</in>` +
        `\n            <out>${outFrame}</out>` +
        `\n            <start>${timelineFrame}</start>` +
        `\n            <end>${timelineFrame + dur}</end>` +
        `\n            <file id="${fileId}"/>` +
        `\n            <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>` +
        `\n          </clipitem>`
      );
      timelineFrame += dur;
      clipIndex++;
    }
  }

  const totalFrames = secondsToFrames(totalDuration, fps);
  const clipItemsXML = clipItems.join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">

  <sequence>
    <name>${projName}</name>
    <duration>${timelineFrame}</duration>
    <rate>
      <timebase>${fps}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <timecode>
      <string>${secondsToTimecode(0, fps)}</string>
      <frame>0</frame>
      <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
      <displayformat>NDF</displayformat>
    </timecode>
    <media>
      <audio>
        <numOutputChannels>2</numOutputChannels>
        <format>
          <samplecharacteristics>
            <depth>16</depth>
            <samplerate>48000</samplerate>
          </samplecharacteristics>
        </format>
        <track>
${clipItemsXML}
          <outputchannelindex>1</outputchannelindex>
        </track>
      </audio>
    </media>
  </sequence>

  <file id="${fileId}">
    <name>${audioFile}</name>
    <pathurl>file://${audioPath}</pathurl>
    <duration>${totalFrames}</duration>
    <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
    <media>
      <audio>
        <samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics>
        <channelcount>2</channelcount>
      </audio>
    </media>
  </file>

</xmeml>
`;
}

// ─── DaVinci Resolve XML (FCP7 / XMEML v5) ─────────────────────────────────

/**
 * Generate a DaVinci Resolve–compatible FCP7 XML document from a Plotline project.
 *
 * Structure:
 *   xmeml > sequence > media > audio > track > clipitem[]
 *
 * @param {Object} project
 * @returns {string} Complete XMEML document
 */
export function exportResolveXML(project) {
  const items = getTimelineItems(project);
  const duration = getDuration(project, items);
  const projName = escapeXML(project.name || 'Untitled');
  const audioFile = escapeXML(project.audioFile || 'audio.wav');
  const audioPath = escapeXML(project.audioPath || project.audioFile || 'audio.wav');
  const fps = 30;
  const totalFrames = secondsToFrames(duration, fps);
  const durationTC = secondsToTimecode(duration, fps);

  const fileId = 'file-1';

  // Collect scene headings for markers on the sequence
  const markers = [];
  for (const item of items) {
    if (item.type === 'scene_heading') {
      const frame = item.start != null ? secondsToFrames(item.start, fps) : 0;
      markers.push(
        `        <marker>` +
        `\n          <name>${escapeXML(item.text)}</name>` +
        `\n          <comment>Scene Heading</comment>` +
        `\n          <in>${frame}</in>` +
        `\n          <out>-1</out>` +
        `\n        </marker>`
      );
    }
  }

  // Build clip items for the audio track
  const clipItems = [];
  let clipIndex = 1;

  for (const item of items) {
    const hasTime = item.start != null && item.end != null;
    if (!hasTime) continue;
    // Only include timed items as clipitems
    if (item.type === 'scene_heading') continue; // headings are markers, not clips

    const inFrame = secondsToFrames(item.start, fps);
    const outFrame = secondsToFrames(item.end, fps);
    const clipName = item.character
      ? `${escapeXML(item.character)}: ${escapeXML(item.text)}`
      : escapeXML(item.text);

    clipItems.push(
      `          <clipitem id="clipitem-${clipIndex}">` +
      `\n            <name>${clipName}</name>` +
      `\n            <duration>${outFrame - inFrame}</duration>` +
      `\n            <rate>` +
      `\n              <timebase>${fps}</timebase>` +
      `\n              <ntsc>FALSE</ntsc>` +
      `\n            </rate>` +
      `\n            <in>${inFrame}</in>` +
      `\n            <out>${outFrame}</out>` +
      `\n            <start>${inFrame}</start>` +
      `\n            <end>${outFrame}</end>` +
      `\n            <file id="${fileId}"/>` +
      `\n            <sourcetrack>` +
      `\n              <mediatype>audio</mediatype>` +
      `\n              <trackindex>1</trackindex>` +
      `\n            </sourcetrack>` +
      `\n          </clipitem>`
    );
    clipIndex++;
  }

  const markersXML = markers.length > 0 ? '\n' + markers.join('\n') : '';
  const clipItemsXML = clipItems.join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">

  <sequence>
    <name>${projName}</name>
    <duration>${totalFrames}</duration>
    <rate>
      <timebase>${fps}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <timecode>
      <string>${secondsToTimecode(0, fps)}</string>
      <frame>0</frame>
      <rate>
        <timebase>${fps}</timebase>
        <ntsc>FALSE</ntsc>
      </rate>
      <displayformat>NDF</displayformat>
    </timecode>${markersXML}
    <media>
      <audio>
        <numOutputChannels>2</numOutputChannels>
        <format>
          <samplecharacteristics>
            <depth>16</depth>
            <samplerate>48000</samplerate>
          </samplecharacteristics>
        </format>
        <track>
${clipItemsXML}
          <outputchannelindex>1</outputchannelindex>
        </track>
      </audio>
    </media>
  </sequence>

  <file id="${fileId}">
    <name>${audioFile}</name>
    <pathurl>file://${audioPath}</pathurl>
    <duration>${totalFrames}</duration>
    <rate>
      <timebase>${fps}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <media>
      <audio>
        <samplecharacteristics>
          <depth>16</depth>
          <samplerate>48000</samplerate>
        </samplecharacteristics>
        <channelcount>2</channelcount>
      </audio>
    </media>
  </file>

</xmeml>
`;
}
