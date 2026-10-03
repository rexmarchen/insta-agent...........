import { ffmpeg } from "../src/media.js";
import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  await fs.mkdir("assets/music", { recursive: true });
  await fs.mkdir("assets/sfx", { recursive: true });

  console.log("🎵 Synthesizing high-production electronic background beats and SFX with FFmpeg...");

  // 1. Futuristic Cyber Ambient Track: Deep resonant pad + sub pulse (30 seconds)
  // Layer A: Sub bass 55Hz & 110Hz
  // Layer B: Harmonic synth pad (220Hz, 277Hz, 330Hz) with phaser and reverb
  // Layer C: Gentle rhythmic pulse
  const cyberBeatPath = path.join("assets/music", "cyber_luxury_beat.wav");
  await ffmpeg([
    "-f", "lavfi",
    "-i", "aevalsrc=sin(2*PI*55*t)+0.6*sin(2*PI*110*t)+0.4*sin(2*PI*165*t):d=35:s=44100",
    "-f", "lavfi",
    "-i", "aevalsrc=0.3*sin(2*PI*220*t*(1+0.005*sin(2*PI*0.3*t)))+0.25*sin(2*PI*277*t)+0.2*sin(2*PI*330*t):d=35:s=44100",
    "-f", "lavfi",
    "-i", "anoisesrc=d=35:c=pink:r=44100",
    "-filter_complex",
    "[0:a]lowpass=f=250,volume=1.4[bass];" +
    "[1:a]flanger=delay=15:speed=0.2:depth=4,aecho=0.8:0.7:150:0.5,volume=0.9[pad];" +
    "[2:a]lowpass=f=400,volume=0.08[noise];" +
    "[bass][pad][noise]amix=inputs=3:duration=first:dropout_transition=2,volume=1.2,afade=t=in:st=0:d=1.5,afade=t=out:st=33:d=2[out]",
    "-map", "[out]",
    "-c:a", "pcm_s16le",
    "-y", cyberBeatPath
  ]);
  console.log("✅ Created", cyberBeatPath);

  // 2. High-Tech Synth Wave Beat (rhythmic tech pulse)
  const techPulsePath = path.join("assets/music", "tech_pulse_energy.wav");
  await ffmpeg([
    "-f", "lavfi",
    "-i", "aevalsrc=sin(2*PI*65.4*t)+0.5*sin(2*PI*130.8*t)*(1+0.8*sin(2*PI*2*t)):d=35:s=44100",
    "-f", "lavfi",
    "-i", "aevalsrc=0.3*sin(2*PI*392*t)+0.25*sin(2*PI*523.25*t)+0.2*sin(2*PI*659.25*t):d=35:s=44100",
    "-filter_complex",
    "[0:a]lowpass=f=300,volume=1.3[bass];" +
    "[1:a]chorus=0.7:0.9:55:0.4:0.25:2,aecho=0.8:0.8:200:0.4,volume=0.7[leads];" +
    "[bass][leads]amix=inputs=2:duration=first,volume=1.1,afade=t=in:st=0:d=1,afade=t=out:st=33:d=2[out]",
    "-map", "[out]",
    "-c:a", "pcm_s16le",
    "-y", techPulsePath
  ]);
  console.log("✅ Created", techPulsePath);

  // 3. UI Transition SFX (Whoosh / Tech Swish)
  const whooshPath = path.join("assets/sfx", "tech_whoosh.wav");
  await ffmpeg([
    "-f", "lavfi",
    "-i", "anoisesrc=d=0.6:c=white:r=44100",
    "-filter_complex",
    "[0:a]bandpass=f=1200:w=800,afade=t=in:st=0:d=0.15,afade=t=out:st=0.2:d=0.4,volume=1.8[out]",
    "-map", "[out]",
    "-c:a", "pcm_s16le",
    "-y", whooshPath
  ]);
  console.log("✅ Created", whooshPath);
}

main().catch(console.error);
