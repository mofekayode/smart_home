#!/usr/bin/env node

import 'dotenv/config';
import record from 'node-record-lpcm16';
import { init, loadProfile, verify } from './speaker-verify.js';

const VOICE_PROFILE = process.env.VOICE_PROFILE || 'mofe';
const VOICE_THRESHOLD = 0.45;  // Lowered for distance tolerance

console.log('🔬 Voice Fingerprint Test\n');

// Initialize
init();

// Load profile
const profile = loadProfile(VOICE_PROFILE);
if (!profile) {
  console.error(`❌ No voice profile found for "${VOICE_PROFILE}"`);
  console.error('Please run: npm run voice:enroll\n');
  process.exit(1);
}
console.log(`✅ Loaded voice profile: "${VOICE_PROFILE}"\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📢 Speak for 3 seconds...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const audioChunks = [];
let recording = true;

const recorder = record.record({
  sampleRate: 16000,
  channels: 1,
  audioType: 'raw',
  device: 'default'
});

recorder.stream().on('data', (chunk) => {
  if (recording) {
    audioChunks.push(chunk);
  }
});

// Record for 3 seconds
setTimeout(() => {
  recording = false;
  recorder.stop();

  console.log('⏸️  Recording stopped\n');

  // Combine audio
  const audioBuffer = Buffer.concat(audioChunks);

  // Calculate energy
  let totalEnergy = 0;
  for (let i = 0; i < audioBuffer.length; i += 2) {
    totalEnergy += Math.abs(audioBuffer.readInt16LE(i));
  }
  const avgEnergy = totalEnergy / (audioBuffer.length / 2);

  // Verify
  const result = verify(VOICE_PROFILE, audioBuffer, VOICE_THRESHOLD);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 RESULTS:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Energy:     ${avgEnergy.toFixed(0)}`);
  console.log(`Score:      ${result.score.toFixed(3)}`);
  console.log(`Threshold:  ${VOICE_THRESHOLD}`);
  console.log(`Match:      ${result.match ? '✅ YES' : '❌ NO'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (result.match) {
    console.log('✅ SUCCESS - Your voice matches the enrolled profile!');
  } else {
    console.log('❌ FAILED - Your voice does NOT match the enrolled profile.');
    console.log('\n💡 This means the enrollment captured the wrong voice or noise.');
    console.log('   Run: npm run voice:enroll');
  }

  process.exit(0);
}, 3000);

process.on('SIGINT', () => {
  console.log('\n\nCancelled');
  process.exit(0);
});
