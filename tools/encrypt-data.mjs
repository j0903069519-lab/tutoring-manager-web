import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

const [sourceDir, outputFile, password] = process.argv.slice(2);

if (!sourceDir || !outputFile || !password) {
  console.error("Usage: node tools/encrypt-data.mjs <source-dir> <output-file> <password>");
  process.exit(1);
}

const files = {
  Lessons: "Lessons.json",
  StudentDefaults: "StudentDefaults.json",
  ExternalIncome: "ExternalIncome.json"
};

const payload = {};
for (const [key, fileName] of Object.entries(files)) {
  const text = await readFile(join(sourceDir, fileName), "utf8");
  payload[key] = JSON.parse(text);
}

const salt = randomBytes(16);
const iv = randomBytes(12);
const iterations = 310000;
const key = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const cipher = createCipheriv("aes-256-gcm", key, iv);
const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();

const output = {
  version: 1,
  algorithm: "AES-GCM",
  kdf: "PBKDF2-SHA256",
  iterations,
  salt: salt.toString("base64"),
  iv: iv.toString("base64"),
  tag: tag.toString("base64"),
  data: encrypted.toString("base64"),
  counts: {
    lessons: payload.Lessons.length,
    studentDefaults: payload.StudentDefaults.length,
    externalIncome: payload.ExternalIncome.length
  },
  generatedAt: new Date().toISOString()
};

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(output)}\n`, "utf8");

console.log(`Encrypted ${payload.Lessons.length} lessons, ${payload.ExternalIncome.length} external income rows.`);
