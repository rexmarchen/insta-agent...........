import fs from "node:fs";

export type Brand = {
  name: string;
  avoid: string[];
  banned_phrases: string[];
  visual: { palette: { background: string; crimson: string; gold: string; text: string }; style: string; negative: string };
  [k: string]: unknown;
};

export const brand: Brand = JSON.parse(fs.readFileSync("brand.json", "utf8"));
