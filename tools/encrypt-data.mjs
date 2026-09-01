import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

const [sourceDir, outputFile, password] = process.argv.slice(2);

if (!sourceDir || !outputFile || !password) {
  console.error("Usage: node tools/encrypt-data.mjs <source-dir> <output-file> <password>");
  process.exit(1);
}

const databaseText = await readFile(join(sourceDir, "CourseAssistantDatabase.json"), "utf8");
const database = JSON.parse(databaseText);
let personalCalendarEvents = [];
try {
  const personalCalendarText = await readFile(join(sourceDir, "PersonalCalendarEvents.json"), "utf8");
  personalCalendarEvents = JSON.parse(personalCalendarText);
} catch {}
const payload = { CourseAssistantDatabase: database, PersonalCalendarEvents: personalCalendarEvents };

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
    lessons: database.lessons.length,
    students: database.students.length,
    externalIncome: database.externalIncomes.length,
    personalCalendarEvents: personalCalendarEvents.length
  },
  generatedAt: new Date().toISOString()
};

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(output)}\n`, "utf8");

console.log(`Encrypted ${database.lessons.length} lessons, ${database.students.length} students, and ${database.externalIncomes.length} external incomes.`);
