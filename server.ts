import express from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = 3000;
const TMP_ROOT = path.join(os.tmpdir(), 'miximage-studio');
fs.mkdirSync(TMP_ROOT, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_ROOT),
    filename: (_req, file, cb) => {
      const safeExt = path.extname(file.originalname || '').replace(/[^a-zA-Z0-9.]/g, '');
      cb(null, `${crypto.randomUUID()}${safeExt}`);
    },
  }),
  limits: {
    fileSize: 150 * 1024 * 1024, // 150MB max
  },
});

const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 60 * 1024 * 1024,
  },
});

interface RenderJob {
  id: string;
  dir: string;
  framesDir: string;
  audioPath: string;
  outputPath: string;
  fps: number;
  width: number;
  height: number;
  frameCount: number;
  createdAt: number;
}

const activeJobs = new Map<string, RenderJob>();

function cleanupJob(jobId: string) {
  const job = activeJobs.get(jobId);
  if (!job) return;
  activeJobs.delete(jobId);
  fs.rm(job.dir, { recursive: true, force: true }, () => {});
}

// Periodic stale job sweep (15 min)
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of activeJobs.entries()) {
    if (now - job.createdAt > 15 * 60 * 1000) {
      cleanupJob(id);
    }
  }
}, 60 * 1000);

async function startServer() {
  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  /**
   * Universal Audio Pipeline endpoint:
   * Converts any uploaded audio (.mp3, .wav, .flac, .m4a, .aac, .ogg, .opus, .wma, .aiff)
   * into standard 44.1kHz Mono WAV using FFmpeg so browser DSP stays 100% codec-agnostic.
   */
  app.post('/api/decode-audio', upload.single('audio'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'ไม่พบไฟล์เสียงที่อัปโหลด' });
      return;
    }

    const inputPath = req.file.path;
    const outWavPath = `${inputPath}.decoded.wav`;

    const ff = spawn('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-ac',
      '1',
      '-ar',
      '44100',
      '-vn',
      outWavPath,
    ]);

    let stderr = '';
    ff.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    ff.on('close', (code) => {
      fs.unlink(inputPath, () => {});
      if (code !== 0 || !fs.existsSync(outWavPath)) {
        fs.unlink(outWavPath, () => {});
        res.status(422).json({
          error: 'FFmpeg ไม่สามารถถอดรหัสไฟล์เสียงนี้ได้',
          detail: stderr.slice(-400),
        });
        return;
      }

      res.setHeader('Content-Type', 'audio/wav');
      const stream = fs.createReadStream(outWavPath);
      stream.pipe(res);
      stream.on('close', () => {
        fs.unlink(outWavPath, () => {});
      });
    });
  });

  /**
   * Start an MP4 render session (receives audio track + target video geometry).
   */
  app.post('/api/render/start', upload.single('audio'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'กรุณาแนบไฟล์เสียงสำหรับการเรนเดอร์วิดีโอ' });
      return;
    }

    const fps = Math.min(60, Math.max(15, Number(req.body.fps) || 30));
    const width = Math.min(3840, Math.max(256, Number(req.body.width) || 1920));
    const height = Math.min(3840, Math.max(256, Number(req.body.height) || 1080));

    const jobId = crypto.randomUUID();
    const jobDir = path.join(TMP_ROOT, `job-${jobId}`);
    const framesDir = path.join(jobDir, 'frames');
    fs.mkdirSync(framesDir, { recursive: true });

    const audioPath = path.join(jobDir, `audio${path.extname(req.file.originalname || '.wav')}`);
    fs.renameSync(req.file.path, audioPath);

    const outputPath = path.join(jobDir, 'miximage_render.mp4');

    activeJobs.set(jobId, {
      id: jobId,
      dir: jobDir,
      framesDir,
      audioPath,
      outputPath,
      fps,
      width,
      height,
      frameCount: 0,
      createdAt: Date.now(),
    });

    res.json({ jobId });
  });

  /**
   * Append a batch of rendered JPEG frames to the render session.
   */
  app.post('/api/render/:jobId/frames', memUpload.array('frames', 60), async (req, res) => {
    const job = activeJobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'ไม่พบงานเรนเดอร์ที่ระบุ' });
      return;
    }

    const files = (req.files as Express.Multer.File[]) || [];
    for (const file of files) {
      const padded = String(job.frameCount).padStart(6, '0');
      const framePath = path.join(job.framesDir, `frame_${padded}.jpg`);
      await fs.promises.writeFile(framePath, file.buffer);
      job.frameCount++;
    }

    res.json({ received: files.length, totalFrames: job.frameCount });
  });

  /**
   * Encode sequence of JPEG frames + master audio into H.264 + AAC 320k .mp4
   */
  app.post('/api/render/:jobId/finish', (req, res) => {
    const job = activeJobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'ไม่พบงานเรนเดอร์ที่ระบุ' });
      return;
    }

    if (job.frameCount === 0) {
      cleanupJob(job.id);
      res.status(400).json({ error: 'ไม่มีเฟรมภาพสำหรับเข้ารหัสวิดีโอ' });
      return;
    }

    const framePattern = path.join(job.framesDir, 'frame_%06d.jpg');
    const ffArgs = [
      '-y',
      '-framerate',
      String(job.fps),
      '-i',
      framePattern,
      '-i',
      job.audioPath,
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '320k',
      '-shortest',
      '-movflags',
      '+faststart',
      job.outputPath,
    ];

    const ff = spawn('ffmpeg', ffArgs);
    let stderr = '';
    ff.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    ff.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(job.outputPath)) {
        cleanupJob(job.id);
        res.status(500).json({
          error: 'FFmpeg เข้ารหัสวิดีโอไม่สำเร็จ',
          detail: stderr.slice(-500),
        });
        return;
      }

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="miximage_render.mp4"');
      const stream = fs.createReadStream(job.outputPath);
      stream.pipe(res);
      stream.on('close', () => {
        cleanupJob(job.id);
      });
    });
  });

  // Vite integration in development, static files in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MixImage Studio server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
