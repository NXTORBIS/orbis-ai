import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makeError } from '../../shared/errors';

const execAsync = promisify(execFile);

export interface WaveformResult {
  peaks: number[];
  duration: number;
  sampleRate: number;
  channels: number;
}

const TARGET_SAMPLES = 800;

/** Try ffprobe + ffmpeg for any format; fall back to raw WAV parsing. */
export async function extractWaveform(filePath: string): Promise<WaveformResult> {
  const ext = path.extname(filePath).slice(1).toLowerCase();

  // Try ffprobe first for duration/info
  try {
    return await extractWithFfmpeg(filePath);
  } catch {
    // fall through
  }

  // Fallback: parse WAV directly
  if (['wav', 'wave'].includes(ext)) {
    return parseWav(filePath);
  }

  // For non-WAV without ffmpeg, do a basic RMS analysis of raw bytes
  return analyseRaw(filePath);
}

async function extractWithFfmpeg(filePath: string): Promise<WaveformResult> {
  // Get info via ffprobe
  const { stdout: probeOut } = await execAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ], { timeout: 15_000 });
  const probe = JSON.parse(probeOut) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; sample_rate?: string; channels?: number; duration?: string }>;
  };
  const audioStream = probe.streams?.find((s) => s.codec_type === 'audio');
  const duration = Number(probe.format?.duration ?? audioStream?.duration ?? 0);
  const sampleRate = Number(audioStream?.sample_rate ?? 44100);
  const channels = audioStream?.channels ?? 2;

  if (duration <= 0) throw new Error('Cannot determine duration');

  // Extract raw PCM via ffmpeg, mono, f32le, downsampled
  const outRate = Math.min(sampleRate, 8000);
  const { stdout } = await execAsync('ffmpeg', [
    '-i', filePath,
    '-ac', '1',
    '-ar', String(outRate),
    '-f', 'f32le',
    '-acodec', 'pcm_f32le',
    '-v', 'quiet',
    'pipe:1',
  ], { timeout: 30_000, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' as never });

  const raw = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout as unknown as string, 'binary');
  const totalSamples = Math.floor(raw.length / 4);
  const peaks = downsamplePeaks(raw, totalSamples, TARGET_SAMPLES);

  return { peaks, duration, sampleRate, channels };
}

function downsamplePeaks(buf: Buffer, totalSamples: number, targetBins: number): number[] {
  const bins = Math.min(targetBins, totalSamples);
  const samplesPerBin = totalSamples / bins;
  const peaks: number[] = [];
  for (let i = 0; i < bins; i++) {
    const start = Math.floor(i * samplesPerBin);
    const end = Math.min(Math.floor((i + 1) * samplesPerBin), totalSamples);
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(buf.readFloatLE(j * 4));
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  // Normalize
  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map((p) => p / maxPeak);
}

async function parseWav(filePath: string): Promise<WaveformResult> {
  const fh = await fsp.open(filePath, 'r');
  try {
    const headerBuf = Buffer.alloc(44);
    await fh.read(headerBuf, 0, 44, 0);

    const riff = headerBuf.toString('ascii', 0, 4);
    const wave = headerBuf.toString('ascii', 8, 12);
    if (riff !== 'RIFF' || wave !== 'WAVE') throw makeError('unsupported', 'Not a valid WAV file');

    const audioFormat = headerBuf.readUInt16LE(20);
    const channels = headerBuf.readUInt16LE(22);
    const sampleRate = headerBuf.readUInt32LE(24);
    const bitsPerSample = headerBuf.readUInt16LE(34);

    // Find data chunk
    let offset = 12;
    let dataSize = 0;
    let dataOffset = 0;
    const scanBuf = Buffer.alloc(8);
    while (offset < headerBuf.length + 4096) {
      const { bytesRead } = await fh.read(scanBuf, 0, 8, offset);
      if (bytesRead < 8) break;
      const chunkId = scanBuf.toString('ascii', 0, 4);
      const chunkSize = scanBuf.readUInt32LE(4);
      if (chunkId === 'data') {
        dataSize = chunkSize;
        dataOffset = offset + 8;
        break;
      }
      offset += 8 + chunkSize;
    }
    if (!dataSize) throw makeError('unsupported', 'No data chunk found');

    const bytesPerSample = bitsPerSample / 8;
    const totalFrames = Math.floor(dataSize / (bytesPerSample * channels));
    const duration = totalFrames / sampleRate;

    // Read a subset of the data for waveform
    const maxRead = Math.min(dataSize, 8 * 1024 * 1024);
    const rawBuf = Buffer.alloc(maxRead);
    await fh.read(rawBuf, 0, maxRead, dataOffset);

    const framesToRead = Math.floor(maxRead / (bytesPerSample * channels));
    const bins = Math.min(TARGET_SAMPLES, framesToRead);
    const framesPerBin = framesToRead / bins;
    const peaks: number[] = [];
    const maxVal = audioFormat === 3 ? 1.0 : (1 << (bitsPerSample - 1));

    for (let i = 0; i < bins; i++) {
      const start = Math.floor(i * framesPerBin);
      const end = Math.min(Math.floor((i + 1) * framesPerBin), framesToRead);
      let max = 0;
      for (let f = start; f < end; f++) {
        const byteOff = f * bytesPerSample * channels;
        let val: number;
        if (audioFormat === 3) {
          // float
          val = Math.abs(rawBuf.readFloatLE(byteOff));
        } else if (bitsPerSample === 16) {
          val = Math.abs(rawBuf.readInt16LE(byteOff));
        } else if (bitsPerSample === 24) {
          val = Math.abs((rawBuf[byteOff]! | (rawBuf[byteOff + 1]! << 8) | (rawBuf[byteOff + 2]! << 16)) - ((rawBuf[byteOff + 2]! & 0x80) ? 0x1000000 : 0));
        } else {
          val = Math.abs((rawBuf[byteOff]! - 128));
        }
        if (val > max) max = val;
      }
      peaks.push(max / maxVal);
    }

    const maxPeak = Math.max(...peaks, 0.001);
    return {
      peaks: peaks.map((p) => p / maxPeak),
      duration,
      sampleRate,
      channels,
    };
  } finally {
    await fh.close();
  }
}

/** Fallback for non-WAV without ffmpeg: read raw bytes and compute RMS-like peaks. */
async function analyseRaw(filePath: string): Promise<WaveformResult> {
  const stat = await fsp.stat(filePath);
  const fileSize = stat.size;
  const fh = await fsp.open(filePath, 'r');
  try {
    // Skip first 4KB (likely headers), read up to 4MB
    const skip = Math.min(4096, fileSize);
    const readLen = Math.min(fileSize - skip, 4 * 1024 * 1024);
    if (readLen <= 0) throw makeError('unsupported', 'File is too small to analyse');

    const buf = Buffer.alloc(readLen);
    await fh.read(buf, 0, readLen, skip);

    const bins = Math.min(TARGET_SAMPLES, Math.floor(readLen / 64));
    const bytesPerBin = Math.floor(readLen / bins);
    const peaks: number[] = [];

    for (let i = 0; i < bins; i++) {
      const start = i * bytesPerBin;
      const end = start + bytesPerBin;
      let rms = 0;
      for (let j = start; j < end; j++) {
        const v = (buf[j]! - 128) / 128;
        rms += v * v;
      }
      peaks.push(Math.sqrt(rms / bytesPerBin));
    }

    const maxPeak = Math.max(...peaks, 0.001);
    // Estimate duration from typical bitrate (128kbps)
    const estimatedDuration = (fileSize * 8) / (128 * 1000);

    return {
      peaks: peaks.map((p) => p / maxPeak),
      duration: estimatedDuration,
      sampleRate: 44100,
      channels: 2,
    };
  } finally {
    await fh.close();
  }
}
