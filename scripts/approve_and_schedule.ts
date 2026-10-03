import { approve } from '../src/posts.ts';
import { setSetting, db } from '../src/db.ts';
import { formatLocal } from '../src/scheduler.ts';

setSetting('autopilot', 'on');
const at11 = approve(11);
console.log('Post #11 (IMAGE) scheduled at:', at11, '->', formatLocal(at11));
const at12 = approve(12);
console.log('Post #12 (REEL) scheduled at:', at12, '->', formatLocal(at12));

const scheduled = db.prepare("SELECT id, kind, status, scheduled_at FROM posts WHERE status = 'approved' ORDER BY scheduled_at").all();
console.log('Scheduled posts:', JSON.stringify(scheduled, null, 2));
