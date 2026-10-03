import { createContent } from '../src/gen/creator.ts';
import { draftNew } from '../src/pipeline.ts';
import { db } from '../src/db.ts';

async function main() {
  console.log('--- Generating sample 1: PHOTO POST (warm editorial desk aesthetic) ---');
  const res1 = await createContent({
    topic: 'FORMAT: image. Warm cream and peach sunlit workspace with an open laptop displaying the REXION AI Career Platform dashboard, ceramic coffee mug with "Progress looks good on you", spiral notebook with checklist, potted plant, editorial photography.',
    ignoreQueue: true,
    bypassLimit: true,
  });
  console.log('Result 1:', res1);

  console.log('--- Generating sample 2: REEL (warm career platform showcase) ---');
  const res2 = await createContent({
    topic: 'FORMAT: showcase_reel. Feature: REXION AI Career Platform smart job matching and live Microsoft/Google roles.',
    ignoreQueue: true,
    bypassLimit: true,
  });
  console.log('Result 2:', res2);

  console.log('--- Drafting captions and scheduling ---');
  await draftNew();

  const posts = db.prepare("SELECT id, kind, status, scheduled_at, caption, src_path FROM posts WHERE status != 'rejected' ORDER BY id DESC").all();
  console.log('--- ACTIVE POSTS IN QUEUE ---');
  console.log(JSON.stringify(posts, null, 2));
}

main().catch((err) => {
  console.error('Generation error:', err);
  process.exit(1);
});
