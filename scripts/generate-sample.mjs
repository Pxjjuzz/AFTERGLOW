/**
 * Generates the bundled AFTERGLOW demo assets. The audio is a soft, original
 * synthesized ambient sketch (not a commercial song), intentionally simple so
 * the demo can be committed and played offline.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sampleDir = path.join(root, 'samples');
const sampleRate = 22050;
const durationSeconds = 48;

function writeWav(samples, rate) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  return buffer;
}

const totalSamples = sampleRate * durationSeconds;
const samples = new Float32Array(totalSamples);

const progression = [
  [146.83, 220.0, 293.66, 369.99],
  [130.81, 196.0, 261.63, 329.63],
  [110.0, 164.81, 220.0, 277.18],
  [123.47, 185.0, 246.94, 311.13],
];

// Slow evolving chord pad plus sparse bell-like notes. Deliberately quiet.
for (let index = 0; index < totalSamples; index += 1) {
  const t = index / sampleRate;
  const chordLength = 12;
  const chordIndex = Math.floor(t / chordLength) % progression.length;
  const chord = progression[chordIndex];
  const local = t % chordLength;
  const fade = Math.min(1, local / 1.8) * Math.min(1, (chordLength - local) / 2.2);
  let value = 0;

  for (let voice = 0; voice < chord.length; voice += 1) {
    const frequency = chord[voice];
    const wobble = 1 + 0.0018 * Math.sin(t * 0.37 + voice);
    const amplitude = 0.028 / (1 + voice * 0.35);
    value += Math.sin(2 * Math.PI * frequency * wobble * t + voice) * amplitude;
    value += Math.sin(2 * Math.PI * frequency * 2 * wobble * t) * amplitude * 0.18;
  }

  value *= fade;

  const bellPeriod = 6;
  const bellTime = t % bellPeriod;
  if (bellTime < 2.4) {
    const bellFrequency = chord[0] * 2;
    const envelope = Math.exp(-bellTime * 1.8) * 0.035;
    value += Math.sin(2 * Math.PI * bellFrequency * bellTime) * envelope;
  }

  const breath = 0.0035 * Math.sin(t * 0.21) * Math.sin(t * 0.07);
  samples[index] = (value + breath) * 0.9;
}

// Gentle final fade so the demo never clicks off.
const fadeSamples = sampleRate * 2;
for (let index = 0; index < fadeSamples; index += 1) {
  const gain = index / fadeSamples;
  const target = samples.length - fadeSamples + index;
  samples[target] *= gain;
}

const lrc = `[ti:First Light]
[ar:AFTERGLOW Sample]
[al:Generated for the AFTERGLOW demo]
[length:00:48]
[by:AFTERGLOW]
[offset:0]
[00:00.00]<00:00.00>Every <00:00.60>song <00:01.10>creates <00:01.60>its <00:02.05>own <00:02.45>universe
[00:05.00]<00:05.00>Nothing <00:05.65>here <00:06.10>is <00:06.40>in <00:06.70>a <00:06.95>hurry
[00:10.00]<00:10.00>Light <00:10.55>learns <00:11.10>the <00:11.35>shape <00:11.90>of <00:12.15>the <00:12.45>dark
[00:15.50]<00:15.50>Words <00:16.05>become <00:16.80>constellations
[00:21.00]<00:21.00>Drifting <00:21.75>slowly <00:22.55>into <00:23.20>view
[00:26.50]<00:26.50>Space <00:27.10>between <00:27.80>the <00:28.05>notes <00:28.70>is <00:28.95>music
[00:32.00]<00:32.00>Let <00:32.40>the <00:32.75>quiet <00:33.35>hold <00:33.80>you
[00:37.00]<00:37.00>Everything <00:37.85>ends <00:38.45>in <00:38.75>a <00:39.05>glow
[00:42.00]<00:42.00>Then <00:42.50>begins <00:43.20>again
`;

await mkdir(sampleDir, { recursive: true });
await writeFile(path.join(sampleDir, 'afterglow-sample.wav'), writeWav(samples, sampleRate));
await writeFile(path.join(sampleDir, 'afterglow-sample.lrc'), lrc, 'utf8');
console.log('Wrote samples/afterglow-sample.wav and samples/afterglow-sample.lrc');
