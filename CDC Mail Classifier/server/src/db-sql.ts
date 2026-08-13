import sql from 'mssql';
import { config } from './config.js';

let poolPromise: Promise<sql.ConnectionPool> | null = null;

function isSqlConfigured(): boolean {
  return Boolean(config.sql.server && config.sql.user && config.sql.password && config.sql.database);
}

async function getPool(): Promise<sql.ConnectionPool> {
  if (!isSqlConfigured()) {
    throw new Error('SQL Server is not configured');
  }

  if (!poolPromise) {
    const promise = new sql.ConnectionPool({
      user: config.sql.user,
      password: config.sql.password,
      server: config.sql.server,
      port: config.sql.port,
      database: config.sql.database,
      pool: { max: 5, min: 0, idleTimeoutMillis: 60_000 },
      options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true,
      },
      connectionTimeout: 30_000,
      requestTimeout: 30_000,
    }).connect();

    poolPromise = promise;
    promise.catch(() => {
      poolPromise = null;
    });
  }

  return poolPromise;
}

export async function lookupSalesPersonByClientDomain(
  domainToken: string,
): Promise<string | null> {
  if (!isSqlConfigured()) {
    return null;
  }

  const pool = await getPool();
  const request = pool.request();
  request.input('ClientName', sql.NVarChar(200), `%${domainToken}%`);

  const result = await request.query<{ SalesPersonName: string }>(`
    SELECT TOP 1
      jc.ClientName,
      lm.LedgerName AS SalesPersonName
    FROM (
      SELECT
        ClientName,
        SalesEmployeeID,
        ROW_NUMBER() OVER (
          PARTITION BY ClientName
          ORDER BY jobbookingdate DESC
        ) AS rn
      FROM JobBookingJobCard
      WHERE ClientName LIKE @ClientName
    ) jc
    JOIN LedgerMaster lm
      ON lm.LedgerID = jc.SalesEmployeeID
    WHERE jc.rn = 1
  `);

  const name = result.recordset[0]?.SalesPersonName;
  return name?.trim() || null;
}

/**
 * Match a non-CDC participant email in ConcernPersonMaster, then resolve sales person
 * from the latest JobBookingJobCard for that client's LedgerID.
 */
export async function lookupSalesPersonByConcernPersonEmail(
  email: string,
): Promise<string | null> {
  if (!isSqlConfigured()) {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) {
    return null;
  }

  const pool = await getPool();
  const request = pool.request();
  request.input('Email', sql.NVarChar(320), normalized);

  const result = await request.query<{ SalesPersonName: string }>(`
    SELECT TOP 1
      lm.LedgerName AS SalesPersonName
    FROM ConcernPersonMaster cpm
    CROSS APPLY (
      SELECT TOP 1 jc.SalesEmployeeID
      FROM JobBookingJobCard jc
      WHERE jc.LedgerID = cpm.LedgerID
      ORDER BY jc.JobBookingDate DESC
    ) latest_job
    JOIN LedgerMaster lm
      ON lm.LedgerID = latest_job.SalesEmployeeID
    WHERE LOWER(LTRIM(RTRIM(cpm.Email))) = @Email
  `);

  const name = result.recordset[0]?.SalesPersonName;
  return name?.trim() || null;
}

let salesExecutivesCache: { names: string[]; fetchedAt: number } | null = null;
const SALES_EXECUTIVES_CACHE_MS = 10 * 60 * 1000;

export async function fetchSalesExecutiveNames(): Promise<string[]> {
  if (!isSqlConfigured()) {
    return [];
  }

  const now = Date.now();
  if (salesExecutivesCache && now - salesExecutivesCache.fetchedAt < SALES_EXECUTIVES_CACHE_MS) {
    return salesExecutivesCache.names;
  }

  const pool = await getPool();
  const result = await pool.request().query<{ LedgerName: string }>(`
    SELECT LedgerName
    FROM LedgerMaster
    WHERE Designation = 'Sales Executive'
    ORDER BY LedgerName
  `);

  const names = result.recordset
    .map((row) => row.LedgerName?.trim())
    .filter((name): name is string => Boolean(name));

  salesExecutivesCache = { names, fetchedAt: now };
  return names;
}

export { isSqlConfigured };
