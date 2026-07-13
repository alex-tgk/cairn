import type { Database, SQLQueryBindings } from "bun:sqlite";
import {
  CompiledQuery,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type Kysely,
  type QueryCompiler,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type TransactionSettings,
} from "kysely";

type BunSqliteDialectOptions = Readonly<{
  database: Database;
}>;

function sqliteBindings(
  parameters: ReadonlyArray<unknown>,
): SQLQueryBindings[] {
  return parameters.map((parameter) => {
    if (
      parameter === null ||
      typeof parameter === "string" ||
      typeof parameter === "bigint" ||
      typeof parameter === "number" ||
      typeof parameter === "boolean" ||
      parameter instanceof Uint8Array
    ) {
      return parameter;
    }
    throw new TypeError("Unsupported SQLite query binding");
  });
}

class ConnectionMutex {
  private pending: Promise<void> | undefined;
  private releasePending: (() => void) | undefined;

  async acquire(): Promise<void> {
    while (this.pending) {
      await this.pending;
    }
    this.pending = new Promise((resolve) => {
      this.releasePending = resolve;
    });
  }

  release(): void {
    const releasePending = this.releasePending;
    this.pending = undefined;
    this.releasePending = undefined;
    releasePending?.();
  }
}

class BunSqliteConnection implements DatabaseConnection {
  constructor(private readonly database: Database) {}

  async executeQuery<Result>(
    compiledQuery: CompiledQuery,
  ): Promise<QueryResult<Result>> {
    const statement = this.database.prepare(compiledQuery.sql);
    try {
      const parameters = sqliteBindings(compiledQuery.parameters);
      if (statement.columnNames.length > 0) {
        return { rows: statement.all(...parameters) as Result[] };
      }
      const result = statement.run(...parameters);
      return {
        insertId: BigInt(result.lastInsertRowid),
        numAffectedRows: BigInt(result.changes),
        rows: [],
      };
    } finally {
      statement.finalize();
    }
  }

  async *streamQuery<Result>(
    compiledQuery: CompiledQuery,
  ): AsyncIterableIterator<QueryResult<Result>> {
    const statement = this.database.prepare(compiledQuery.sql);
    try {
      const parameters = sqliteBindings(compiledQuery.parameters);
      for (const row of statement.iterate(...parameters)) {
        yield { rows: [row as Result] };
      }
    } finally {
      statement.finalize();
    }
  }
}

class BunSqliteDriver implements Driver {
  private readonly connection: BunSqliteConnection;
  private readonly mutex = new ConnectionMutex();

  constructor(private readonly database: Database) {
    this.connection = new BunSqliteConnection(database);
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    await this.mutex.acquire();
    return this.connection;
  }

  async beginTransaction(
    connection: DatabaseConnection,
    _settings: TransactionSettings,
  ): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("BEGIN"));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("COMMIT"));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("ROLLBACK"));
  }

  async releaseConnection(_connection: DatabaseConnection): Promise<void> {
    this.mutex.release();
  }

  async destroy(): Promise<void> {
    this.database.close(true);
  }
}

export class BunSqliteDialect implements Dialect {
  constructor(private readonly options: BunSqliteDialectOptions) {}

  createDriver(): Driver {
    return new BunSqliteDriver(this.options.database);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createIntrospector(database: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(database);
  }
}
