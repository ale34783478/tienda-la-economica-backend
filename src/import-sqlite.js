import assert from 'node:assert/strict';

export const inventoryTables = ['users', 'products', 'movements', 'settings', 'revoked_tokens'];

// Read one consistent SQLite snapshot, including committed WAL contents.
export function snapshotSqlite(source) {
  source.exec('BEGIN');
  try {
    return Object.fromEntries(inventoryTables.map(table => [table,
      source.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  } finally { source.exec('ROLLBACK'); }
}

export async function verifySnapshot(target, snapshot) {
  for (const table of inventoryTables) {
    const rows = await target.prepare(`SELECT * FROM ${table}`).all();
    const normalize = list => list.map(({ rowid, ...row }) => row)
      .sort((a, b) => String(a.id ?? a.key ?? a.jti).localeCompare(String(b.id ?? b.key ?? b.jti)));
    assert.deepEqual(normalize(rows), normalize(snapshot[table]), `Diferencias en ${table}`);
  }
}

export async function importSnapshot(target, snapshot) {
  await target.transaction(async () => {
    await target.query('LOCK TABLE users, products, movements, settings, revoked_tokens IN ACCESS EXCLUSIVE MODE');
    for (const table of inventoryTables) {
      const { n } = await target.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
      if (n) throw Error(`Destino no vacío (${table}). Importación cancelada sin reemplazar datos.`);
      for (const row of snapshot[table]) {
        const columns = Object.keys(row);
        const placeholders = columns.map(() => '?').join(',');
        await target.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`).run(...Object.values(row));
      }
    }
    await verifySnapshot(target, snapshot);
  });
  return Object.fromEntries(inventoryTables.map(t => [t, snapshot[t].length]));
}
