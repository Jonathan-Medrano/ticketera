/**
 * Upload carousel slides to Supabase Storage and print public URLs.
 * Reads credentials from backend/.env
 * Usage: node scripts/_upload_ig_slides.mjs <carousel-slug>
 * Example: node scripts/_upload_ig_slides.mjs 08-quien-paga
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- load backend/.env ---
function loadEnv(filePath) {
  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const eq = line.indexOf("=");
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch { /* ignore */ }
}

loadEnv(path.join(ROOT, "backend", ".env"));

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET       = process.env.SUPABASE_STORAGE_BUCKET || "tenant-images";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("ERROR: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found in backend/.env");
  process.exit(1);
}

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: node scripts/_upload_ig_slides.mjs <slug>");
  process.exit(1);
}

const imgDir = path.join(ROOT, "instagram", "carruseles", slug, "img");
if (!fs.existsSync(imgDir)) {
  console.error(`ERROR: img dir not found: ${imgDir}`);
  process.exit(1);
}

const pngs = fs.readdirSync(imgDir).filter(f => f.endsWith(".png")).sort();
if (pngs.length === 0) {
  console.error(`ERROR: no PNGs in ${imgDir}`);
  process.exit(1);
}

// Use @supabase/storage-js directly (already installed in backend/node_modules)
const storageJsPath = path.join(ROOT, "backend", "node_modules", "@supabase", "storage-js", "dist", "index.mjs");

// On Windows, dynamic import needs a file:// URL
const { StorageClient } = await import(pathToFileURL(storageJsPath).href);
const storageClient = new StorageClient(`${SUPABASE_URL}/storage/v1`, {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
});

const publicUrls = [];

for (const localName of pngs) {
  const remoteName = `${slug}-${localName}`;
  const objectPath = `ig/${remoteName}`;
  const fileData = fs.readFileSync(path.join(imgDir, localName));

  const { data, error } = await storageClient
    .from(BUCKET)
    .upload(objectPath, fileData, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) {
    console.error(`FAIL ${remoteName}: ${error.message}`);
    process.exit(1);
  }

  const pub = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
  publicUrls.push(pub);
  console.log(`OK  ${remoteName}`);
}

console.log();
console.log("URLS_CSV=" + publicUrls.join(","));
