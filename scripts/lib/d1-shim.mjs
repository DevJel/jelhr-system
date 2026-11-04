// A small Cloudflare D1-compatible adapter over node:sqlite, for local tests and the
// offline dev server. Implements prepare().bind().first()/all()/run()/raw() and batch().
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const norm = v => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);

class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params.map(norm)); }
  #stmt() { return this.db.prepare(this.sql); }
  async first(column) {
    const row = this.#stmt().get(...this.params);
    if (!row) return null;
    const plain = { ...row };
    return column ? plain[column] ?? null : plain;
  }
  async all() { return { results: this.#stmt().all(...this.params).map(r => ({ ...r })), success: true, meta: {} }; }
  async raw() { return this.#stmt().all(...this.params).map(r => Object.values(r)); }
  async run() {
    const info = this.#stmt().run(...this.params);
    return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
  _runSync() {
    const s = this.#stmt();
    if (/^\s*(select|with)/i.test(this.sql)) return { results: s.all(...this.params).map(r => ({ ...r })), success: true, meta: {} };
    const info = s.run(...this.params);
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

export class D1Shim {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON;");
  }
  prepare(sql) { return new Statement(this.db, sql); }
  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const out = statements.map(s => s._runSync());
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  async exec(sql) { this.db.exec(sql); return { count: 1 }; }
  migrate(dir) {
    for (const file of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
      this.db.exec(readFileSync(join(dir, file), "utf8"));
    }
    return this;
  }
}
