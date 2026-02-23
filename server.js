import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { transcribeAudio } from './lib/transcriber.js';
import { organizeScript } from './lib/organizer.js';
import { exportFCPXML, exportResolveXML, exportAssemblyFCPXML, exportAssemblyResolveXML } from './lib/xml-export.js';
import { alignScriptToTranscript } from './lib/aligner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const EXPORTS_DIR = path.join(DATA_DIR, 'exports');

// Ensure directories exist
await fs.mkdir(UPLOADS_DIR, { recursive: true });
await fs.mkdir(PROJECTS_DIR, { recursive: true });
await fs.mkdir(EXPORTS_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer config for audio uploads
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.wav', '.mp3', '.m4a', '.mp4', '.mov', '.aac', '.ogg', '.flac', '.webm'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported format: ${ext}`));
  }
});

// --- API Routes ---

// Upload audio + create project
app.post('/api/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

    const project = {
      id: uuidv4(),
      name: req.body.name || path.parse(req.file.originalname).name,
      audioFile: req.file.filename,
      audioOriginalName: req.file.originalname,
      audioPath: req.file.path,
      createdAt: new Date().toISOString(),
      transcript: null,
      script: null,
      status: 'uploaded'
    };

    await fs.writeFile(
      path.join(PROJECTS_DIR, `${project.id}.json`),
      JSON.stringify(project, null, 2)
    );

    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Transcribe audio for a project
app.post('/api/projects/:id/transcribe', async (req, res) => {
  try {
    const project = await loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    project.status = 'transcribing';
    await saveProject(project);

    const modelSize = req.body.model || 'small';
    const language = req.body.language || 'en';

    const transcript = await transcribeAudio(project.audioPath, {
      modelSize,
      language,
      modelsDir: path.join(DATA_DIR, 'models')
    });

    project.transcript = transcript;
    project.status = 'transcribed';
    await saveProject(project);

    res.json(project);
  } catch (err) {
    console.error('Transcription error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get project
app.get('/api/projects/:id', async (req, res) => {
  const project = await loadProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// List all projects
app.get('/api/projects', async (req, res) => {
  try {
    const files = await fs.readdir(PROJECTS_DIR);
    const projects = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        const data = JSON.parse(await fs.readFile(path.join(PROJECTS_DIR, file), 'utf-8'));
        projects.push({
          id: data.id,
          name: data.name,
          status: data.status,
          createdAt: data.createdAt,
          audioOriginalName: data.audioOriginalName
        });
      }
    }
    projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update project (save edits to transcript/script)
app.put('/api/projects/:id', async (req, res) => {
  try {
    const project = await loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (req.body.transcript !== undefined) project.transcript = req.body.transcript;
    if (req.body.script !== undefined) project.script = req.body.script;
    if (req.body.name !== undefined) project.name = req.body.name;

    await saveProject(project);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI organize transcript into script
app.post('/api/projects/:id/organize', async (req, res) => {
  try {
    const project = await loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.transcript) return res.status(400).json({ error: 'No transcript to organize' });

    const script = await organizeScript(project.transcript, {
      style: req.body.style || 'screenplay',
      instructions: req.body.instructions || ''
    });

    project.script = script;
    project.status = 'organized';
    await saveProject(project);

    res.json(project);
  } catch (err) {
    console.error('Organization error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Export as FCPXML
app.post('/api/projects/:id/export/fcpxml', async (req, res) => {
  try {
    const project = await loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const source = project.script || project.transcript;
    if (!source) return res.status(400).json({ error: 'Nothing to export' });

    const xml = exportFCPXML(project);
    const filename = `${project.name.replace(/[^a-zA-Z0-9-_]/g, '_')}_${Date.now()}.fcpxml`;
    const filepath = path.join(EXPORTS_DIR, filename);
    await fs.writeFile(filepath, xml);

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export as DaVinci Resolve XML
app.post('/api/projects/:id/export/resolve', async (req, res) => {
  try {
    const project = await loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const source = project.script || project.transcript;
    if (!source) return res.status(400).json({ error: 'Nothing to export' });

    const xml = exportResolveXML(project);
    const filename = `${project.name.replace(/[^a-zA-Z0-9-_]/g, '_')}_${Date.now()}.xml`;
    const filepath = path.join(EXPORTS_DIR, filename);
    await fs.writeFile(filepath, xml);

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save edit script (for Paper Edit)
app.post('/api/projects/:id/script', async (req, res) => {
  try {
    const project = await loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { text } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Script text is required' });

    project.editScript = text;
    project.alignment = null; // reset alignment when script changes
    await saveProject(project);

    res.json({ success: true, editScript: project.editScript });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run script-to-cut alignment
app.post('/api/projects/:id/align', async (req, res) => {
  try {
    const project = await loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.editScript) return res.status(400).json({ error: 'No edit script saved. Save a script first via POST /api/projects/:id/script' });
    if (!project.transcript) return res.status(400).json({ error: 'No transcript to align against' });

    const alignment = alignScriptToTranscript(project.editScript, project.transcript);
    project.alignment = alignment;
    await saveProject(project);

    res.json(alignment);
  } catch (err) {
    console.error('Alignment error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Export assembly cut from alignment
app.post('/api/projects/:id/export/assembly', async (req, res) => {
  try {
    const project = await loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.alignment) return res.status(400).json({ error: 'No alignment data. Run alignment first.' });

    const format = req.body.format || 'fcpxml';
    let xml;
    let ext;
    if (format === 'resolve') {
      xml = exportAssemblyResolveXML(project);
      ext = '.xml';
    } else {
      xml = exportAssemblyFCPXML(project);
      ext = '.fcpxml';
    }

    const filename = `${project.name.replace(/[^a-zA-Z0-9-_]/g, '_')}_assembly_${Date.now()}${ext}`;
    const filepath = path.join(EXPORTS_DIR, filename);
    await fs.writeFile(filepath, xml);

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);
  } catch (err) {
    console.error('Assembly export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve audio files for playback
app.get('/api/audio/:filename', async (req, res) => {
  const filepath = path.join(UPLOADS_DIR, req.params.filename);
  try {
    await fs.access(filepath);
    res.sendFile(filepath);
  } catch {
    res.status(404).json({ error: 'Audio file not found' });
  }
});

// Delete project
app.delete('/api/projects/:id', async (req, res) => {
  try {
    const project = await loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Remove audio file
    try { await fs.unlink(project.audioPath); } catch {}
    // Remove project file
    await fs.unlink(path.join(PROJECTS_DIR, `${project.id}.json`));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Helpers ---
async function loadProject(id) {
  try {
    const data = await fs.readFile(path.join(PROJECTS_DIR, `${id}.json`), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveProject(project) {
  await fs.writeFile(
    path.join(PROJECTS_DIR, `${project.id}.json`),
    JSON.stringify(project, null, 2)
  );
}

// --- Start ---
const PORT = process.env.PLOTLINE_PORT || 3847;
app.listen(PORT, () => {
  console.log(`\n  🎬 Plotline running at http://localhost:${PORT}\n`);
});
