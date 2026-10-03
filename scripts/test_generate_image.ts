import { generateImage } from '../src/gen/image.ts';
import { brand } from '../src/brand.ts';

async function main() {
  console.log('Generating test image with Cloudflare FLUX...');
  const prompt = `Aesthetic warm editorial technology photograph, sunlit cozy wooden workspace with an open laptop displaying the REXION AI Career Platform dashboard with job match cards, ceramic coffee mug with 'Progress looks good on you' note, spiral notebook with handwritten checklist, small potted green plant, soft morning sunlight casting gentle shadows, warm cream and terracotta tones, minimal and premium, 8k commercial photography`;
  
  const res = await generateImage(prompt, "4:5", "work", {
    rawPrompt: true,
    negative: brand.visual.negative
  });
  console.log('Generated image successfully:', res);
}

main().catch((err) => {
  console.error('Failed to generate image:', err);
  process.exit(1);
});
