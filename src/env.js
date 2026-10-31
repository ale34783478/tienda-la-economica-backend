// Runtime variables win. Backend files take precedence over root files from Neon.
for (const path of ['../.env', '../.env.local', '../../.env', '../../.env.local']) {
  try { process.loadEnvFile(new URL(path, import.meta.url)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
