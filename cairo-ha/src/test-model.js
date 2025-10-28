#!/usr/bin/env node

import 'dotenv/config';
import record from 'node-record-lpcm16';
import { init, rawToEmbed, cosine } from './speaker-verify.js';

console.log('🔬 Testing Sherpa-ONNX Model Reliability\n');

init();

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST 1: Record sample 1');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📢 Speak for 3 seconds...\n');

let audioChunks1 = [];
let recording1 = true;

const recorder1 = record.record({
  sampleRate: 16000,
  channels: 1,
  audioType: 'raw',
  device: 'default'
});

recorder1.stream().on('data', (chunk) => {
  if (recording1) {
    audioChunks1.push(chunk);
  }
});

setTimeout(() => {
  recording1 = false;
  recorder1.stop();
  console.log('⏸️  Sample 1 recorded\n');

  const audio1 = Buffer.concat(audioChunks1);
  const embed1 = rawToEmbed(audio1);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 2: Record sample 2 (same person, same words)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📢 Speak the SAME thing again for 3 seconds...\n');

  let audioChunks2 = [];
  let recording2 = true;

  const recorder2 = record.record({
    sampleRate: 16000,
    channels: 1,
    audioType: 'raw',
    device: 'default'
  });

  recorder2.stream().on('data', (chunk) => {
    if (recording2) {
      audioChunks2.push(chunk);
    }
  });

  setTimeout(() => {
    recording2 = false;
    recorder2.stop();
    console.log('⏸️  Sample 2 recorded\n');

    const audio2 = Buffer.concat(audioChunks2);
    const embed2 = rawToEmbed(audio2);

    // Compare the two embeddings
    const score = cosine(embed1, embed2);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 RESULTS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Similarity Score: ${score.toFixed(3)}`);
    console.log(`Expected:         > 0.85 (same person)`);
    console.log(`Result:           ${score >= 0.85 ? '✅ PASS' : '❌ FAIL'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (score < 0.85) {
      console.log('❌ MODEL PROBLEM DETECTED!');
      console.log('   Your own voice recorded twice scores below 0.85.');
      console.log('   This means the sherpa-onnx model is unreliable.');
      console.log('   Voice fingerprinting won\'t work with this model.\n');
    } else {
      console.log('✅ Model is working correctly!');
      console.log('   The enrollment profile may be corrupted.');
      console.log('   Try deleting ~/.cairo/voiceprints/mofe.json\n');
    }

    process.exit(0);
  }, 3000);
}, 3000);

process.on('SIGINT', () => {
  console.log('\n\nCancelled');
  process.exit(0);
});
