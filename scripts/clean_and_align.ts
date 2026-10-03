import { db } from '../src/db.ts';

// 1. Update memories
db.prepare(`UPDATE memories SET fact = ? WHERE id = 1`).run(
  "Owner: Anshu. Instagram: @anshu._io. Business/Brand: REXION (AI Career Platform & Job Intelligence at rexion.ai)."
);
db.prepare(`UPDATE memories SET fact = ? WHERE id = 3`).run(
  "Target Audience: Tech job seekers, university students, software engineers, designers, and ambitious professionals looking for internships and dream careers."
);
db.prepare(`UPDATE memories SET fact = ? WHERE id = 5`).run(
  "Visual Aesthetic: Pure warm cream (#FAF7F2) and ivory, sunlit cozy wooden workspace desk, open laptop displaying clean REXION career dashboard, ceramic coffee mug with cute handwritten quotes, notebook checklist, warm terracotta accents (#DE6B48), dark charcoal typography (#1C1917), and elegant Georgia Bold serif typography. NEVER dark, NEVER cyberpunk, NEVER neon."
);

// 2. Update projects
const careerDesc = {
  headline: "AI Career Platform: Smart Job & Internship Matching",
  target_audience: "College students, tech interns, developers, and job seekers",
  problem_solved: "Stops blind job applications; predicts match scores and connects directly to live tech roles at Google, Microsoft, Meta, and top startups",
  key_features: "Smart Job Matching, Live Opportunities (<48h), Application Chance Prediction, Direct Apply Links, AI Resume Scorer",
  whats_new: "Live internship radar, AI resume match prediction, 1-click direct apply links",
  cta_link: "Explore jobs on rexion.ai",
};

db.prepare(`
  UPDATE projects
  SET headline = ?, target_audience = ?, problem_solved = ?, key_features = ?, whats_new = ?, cta_link = ?
  WHERE name IN ('rexionAI', 'rexion', 'REXION')
`).run(
  careerDesc.headline,
  careerDesc.target_audience,
  careerDesc.problem_solved,
  careerDesc.key_features,
  careerDesc.whats_new,
  careerDesc.cta_link
);

// 3. Mark any remaining non-career posts as rejected
db.prepare(`
  UPDATE posts
  SET status = 'rejected'
  WHERE caption LIKE '%website%' OR caption LIKE '%real estate%' OR caption LIKE '%walkthrough%' OR status = 'new' OR status = 'draft'
`).run();

console.log('Successfully cleaned memories, projects, and posts.');
