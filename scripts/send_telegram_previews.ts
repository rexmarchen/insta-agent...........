import { db, type Post } from '../src/db.ts';
import { sendDraft, notify } from '../src/bot.ts';
import { formatLocal } from '../src/scheduler.ts';

async function main() {
  await notify("✨ Hello Anshu! Here are your newly generated posts aligned with the REXION AI Career Platform aesthetic (warm cream, cozy sunlit desk, laptop UI, ceramic coffee cup).");

  const post11 = db.prepare("SELECT * FROM posts WHERE id = 11").get() as Post;
  if (post11) {
    console.log('Sending post 11 draft...');
    await sendDraft(post11);
    await notify(`📅 Photo Post #11 is scheduled for ${formatLocal(post11.scheduled_at!)} (5:00 PM IST slot).`);
  }

  const post12 = db.prepare("SELECT * FROM posts WHERE id = 12").get() as Post;
  if (post12) {
    console.log('Sending post 12 draft...');
    await sendDraft(post12);
    await notify(`📅 Reel Post #12 is scheduled for ${formatLocal(post12.scheduled_at!)} (7:00 PM IST slot).`);
  }

  console.log('All previews sent to Telegram.');
}

main().catch(err => {
  console.error('Failed to send previews:', err);
  process.exit(1);
});
