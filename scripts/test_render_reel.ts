import path from 'node:path';
import { renderReel } from '../src/gen/reel.ts';
import { extractFrames } from '../src/media.ts';

async function main() {
  console.log('Rendering sample reel with warm career platform aesthetic...');
  const bgImage = 'work/gen-1790859685960-cloudflare.png';
  const out = path.join('work', 'sample_career_reel_v2.mp4');
  
  const res = await renderReel(
    {
      template: 'showcase',
      softwareName: 'REXION',
      problemHook: 'Sending 100 applications with 0 callbacks?',
      features: [
        'AI Resume Match Score for top tech roles',
        'Live Microsoft & Google opportunities (<48h)',
        '1-Click Direct Apply without redirects'
      ],
      cta: 'Explore jobs on rexion.ai'
    },
    out,
    {
      bgImage,
      workDir: 'work'
    }
  );
  
  console.log('Reel rendered successfully:', res);
  const frames = await extractFrames(out, 'work', res.duration, 4);
  console.log('Extracted frames for review:', frames);
}

main().catch(err => {
  console.error('Error rendering reel:', err);
  process.exit(1);
});
