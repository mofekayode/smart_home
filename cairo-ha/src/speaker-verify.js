// speaker-verify.js - Real speaker verification using sherpa-onnx
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sherpa_onnx from 'sherpa-onnx-node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = process.env.SPK_MODEL_DIR || path.join(__dirname, '../models/speaker');
const VOICEPRINT_DIR = path.join(process.env.HOME, '.cairo', 'voiceprints');

// Ensure voiceprint directory exists
fs.mkdirSync(VOICEPRINT_DIR, { recursive: true });

let extractor = null;

// Initialize the speaker embedding extractor
export function init() {
  if (extractor) return extractor;

  const config = {
    model: path.join(MODEL_DIR, 'model.onnx'),
    numThreads: 2,
    debug: 0
  };

  extractor = new sherpa_onnx.SpeakerEmbeddingExtractor(config);

  if (!extractor) {
    throw new Error('Failed to create speaker embedding extractor');
  }

  return extractor;
}

// L2 normalization
function l2norm(arr) {
  const magnitude = Math.sqrt(arr.reduce((sum, val) => sum + val * val, 0));
  return arr.map(val => val / (magnitude || 1e-9));
}

// Cosine similarity between two embeddings
export function cosine(a, b) {
  if (a.length !== b.length) {
    throw new Error('Embedding dimensions must match');
  }
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

// Extract embedding from raw PCM audio buffer (16kHz, mono, 16-bit)
export function rawToEmbed(pcmBuffer, sampleRate = 16000) {
  if (!extractor) init();

  // Create sherpa-onnx stream for processing
  const stream = extractor.createStream();

  // Convert buffer to Float32Array samples
  const samples = new Float32Array(pcmBuffer.length / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = pcmBuffer.readInt16LE(i * 2) / 32768.0;
  }

  // Accept waveform
  stream.acceptWaveform({samples, sampleRate});

  // Compute embedding
  const embedding = extractor.compute(stream);

  return l2norm(Array.from(embedding));
}

// Extract embedding from WAV file
export function wavToEmbed(wavPath) {
  if (!extractor) init();

  const stream = extractor.createStream();
  const wave = sherpa_onnx.readWave(wavPath);

  stream.acceptWaveform({
    samples: wave.samples,
    sampleRate: wave.sampleRate
  });

  const embedding = extractor.compute(stream);

  return l2norm(Array.from(embedding));
}

// Save voice profile
export function saveProfile(name, embedding) {
  const filepath = path.join(VOICEPRINT_DIR, `${name}.json`);
  fs.writeFileSync(filepath, JSON.stringify(embedding));
  console.log(`✅ Profile saved: ${filepath}`);
}

// Load voice profile
export function loadProfile(name) {
  const filepath = path.join(VOICEPRINT_DIR, `${name}.json`);
  if (!fs.existsSync(filepath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

// Enroll user by averaging multiple samples
export function enrollSamples(name, embeddings) {
  if (embeddings.length === 0) {
    throw new Error('Need at least one sample to enroll');
  }

  // Average all embeddings
  const dim = embeddings[0].length;
  const avgEmbed = new Array(dim).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      avgEmbed[i] += emb[i];
    }
  }

  for (let i = 0; i < dim; i++) {
    avgEmbed[i] /= embeddings.length;
  }

  // Normalize and save
  const normalized = l2norm(avgEmbed);
  saveProfile(name, normalized);
  return normalized;
}

// Verify if audio matches a profile
export function verify(name, audioBuffer, threshold = 0.78) {
  const profile = loadProfile(name);
  if (!profile) {
    return { match: false, score: 0, error: 'Profile not found' };
  }

  try {
    const embedding = rawToEmbed(audioBuffer);
    const score = cosine(profile, embedding);
    return {
      match: score >= threshold,
      score: score,
      threshold: threshold
    };
  } catch (error) {
    return { match: false, score: 0, error: error.message };
  }
}

// CLI usage for testing
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, name, ...args] = process.argv.slice(2);

  if (!cmd || !name) {
    console.log('Usage:');
    console.log('  node speaker-verify.js enroll <name> <wav1> [wav2] [wav3]');
    console.log('  node speaker-verify.js verify <name> <wav>');
    process.exit(1);
  }

  init();

  if (cmd === 'enroll') {
    const embeddings = args.map(wav => {
      console.log(`Processing ${wav}...`);
      return wavToEmbed(wav);
    });
    enrollSamples(name, embeddings);
    console.log(`✅ Enrolled ${name} with ${embeddings.length} sample(s)`);
  } else if (cmd === 'verify') {
    const [wav, thresholdStr] = args;
    const threshold = parseFloat(thresholdStr) || 0.78;
    const embedding = wavToEmbed(wav);
    const profile = loadProfile(name);

    if (!profile) {
      console.error(`❌ No profile found for ${name}`);
      process.exit(2);
    }

    const score = cosine(profile, embedding);
    const pass = score >= threshold;

    console.log(JSON.stringify({
      name,
      score: score.toFixed(4),
      threshold,
      pass,
      status: pass ? '✅ VERIFIED' : '❌ REJECTED'
    }, null, 2));
  } else {
    console.error('Unknown command:', cmd);
    process.exit(1);
  }
}
