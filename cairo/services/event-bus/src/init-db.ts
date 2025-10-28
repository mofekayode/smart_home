import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function initializeDatabases() {
  console.log('\n=== Initializing Cairo Databases ===\n');

  // Path to schema file
  const schemaPath = join(__dirname, '../../../data/sqlite/schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  // Initialize cairo.db
  console.log('📦 Creating cairo.db...');
  const cairoDb = new Database(join(__dirname, '../../../data/sqlite/cairo.db'));
  cairoDb.exec(schema);
  console.log('✅ cairo.db initialized with schema');

  // Verify tables
  const tables = cairoDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all();
  console.log('   Tables created:', tables.map((t: any) => t.name).join(', '));
  cairoDb.close();

  // Initialize rag.db
  console.log('\n📦 Creating rag.db...');
  const ragDb = new Database(join(__dirname, '../../../data/sqlite/rag.db'));
  ragDb.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents USING fts5(
      id,
      content,
      metadata,
      timestamp
    );
  `);
  console.log('✅ rag.db initialized with FTS5 table');

  const ragTables = ragDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all();
  console.log('   Tables created:', ragTables.map((t: any) => t.name).join(', '));
  ragDb.close();

  console.log('\n=== Database initialization complete ===\n');
}

initializeDatabases().catch((error) => {
  console.error('❌ Database initialization failed:', error);
  process.exit(1);
});
