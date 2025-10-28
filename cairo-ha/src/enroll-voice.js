#!/usr/bin/env node

import 'dotenv/config';
import record from 'node-record-lpcm16';
import { init, rawToEmbed, enrollSamples, loadProfile } from './speaker-verify.js';

const name = process.argv[2] || 'mofe';
const numSamples = parseInt(process.argv[3]) || 3;

console.log('🎙️  Voice Enrollment Tool');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log(`Enrolling profile: "${name}"`);
console.log(`Number of samples: ${numSamples}\n`);

// Check if profile already exists
const existing = loadProfile(name);
if (existing) {
  console.log(`⚠️  Profile "${name}" already exists!`);
  console.log('This will overwrite the existing profile.\n');
}

// Initialize speaker verification
init();

const samples = [];
let currentSample = 0;

function recordNextSample() {
  currentSample++;
  console.log(`\n📍 Sample ${currentSample}/${numSamples}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Say something natural (3-5 seconds):');
  console.log('  • "Hello Cairo, this is Mofe"');
  console.log('  • "Hey Cairo, turn on the lights"');
  console.log('  • "Cairo, what\'s the temperature?"\n');
  console.log('Starting in 2 seconds...\n');

  setTimeout(() => {
    const audioChunks = [];
    console.log('🔴 RECORDING... speak now!');

    const enrollRecorder = record.record({
      sampleRate: 16000,
      channels: 1,
      audioType: 'raw',
      device: 'default'
    });

    enrollRecorder.stream().on('data', (chunk) => {
      audioChunks.push(chunk);
    });

    setTimeout(() => {
      enrollRecorder.stop();
      const fullAudio = Buffer.concat(audioChunks);
      console.log('⏹️  Recording stopped');

      try {
        const embedding = rawToEmbed(fullAudio);
        samples.push(embedding);
        console.log(`✅ Sample ${currentSample} processed`);

        if (currentSample < numSamples) {
          recordNextSample();
        } else {
          // All samples recorded, create profile
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('🔄 Creating voice profile...\n');
          enrollSamples(name, samples);
          console.log(`\n✅ Voice profile "${name}" enrolled successfully!`);
          console.log(`   Samples recorded: ${samples.length}`);
          console.log(`   Location: ~/.cairo/voiceprints/${name}.json\n`);
          console.log('Now run: npm run voice\n');
          process.exit(0);
        }
      } catch (error) {
        console.error(`❌ Error processing sample: ${error.message}`);
        console.log('Retrying this sample...');
        currentSample--;
        recordNextSample();
      }
    }, 4000);  // 4 seconds of recording
  }, 2000);
}

console.log('Press Ctrl+C to cancel\n');
recordNextSample();
