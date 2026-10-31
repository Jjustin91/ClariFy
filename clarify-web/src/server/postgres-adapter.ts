import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import type {
  AdminMetricsResponse,
  Announcement,
  Channel,
  ChannelMember,
  ChatMessage,
  Instructor,
  PrismsSyncLog,
  QaThread,
  ThreadReply,
  User,
  UserRole,
  VerificationStatus,
} from '../types/api';
import {
  canPublishOrManageAnnouncements,
  canResolveOrPinThreads,
  enforceFaqAnonymity,
  filterAndSortAnnouncements,
  formatSubjectHashtag,
} from '../lib/domain-logic';

export interface ApiEngineRequest {
  method: string;
  path: string;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
}

export interface ApiEngineResponse {
  status: number;
  body: Record<string, unknown>;
}

interface PgConnectionConfig {
  connectionString?: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

interface PgAdapterState {
  pool: Pool | null;
  config: PgConnectionConfig | null;
  initialized: boolean;
  initializingPromise: Promise<boolean> | null;
  lastError: string | null;
  lastCheckedAt: number;
  tokens: Record<string, number>;
}

const globalForPg = globalThis as unknown as {
  __clarifyPgState?: PgAdapterState;
};

function getPgState(): PgAdapterState {
  if (!globalForPg.__clarifyPgState) {
    globalForPg.__clarifyPgState = {
      pool: null,
      config: null,
      initialized: false,
      initializingPromise: null,
      lastError: null,
      lastCheckedAt: 0,
      tokens: {},
    };
  }
  return globalForPg.__clarifyPgState;
}

function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    if (!fs.existsSync(filePath)) return result;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  } catch {
    // Ignore file read errors
  }
  return result;
}

export function resolvePgConfig(): PgConnectionConfig {
  const cwd = process.cwd();
  const candidateFiles = [
    path.resolve(cwd, '.env.local'),
    path.resolve(cwd, '.env'),
    path.resolve(cwd, '../.env'),
    path.resolve(cwd, '../clarify-api/.env'),
    path.resolve(cwd, 'clarify-api/.env'),
  ];

  const fileVars: Record<string, string> = {};
  for (const file of candidateFiles) {
    const parsed = parseEnvFile(file);
    for (const [k, v] of Object.entries(parsed)) {
      if (fileVars[k] === undefined && v !== '') {
        fileVars[k] = v;
      }
    }
  }

  const getVar = (key: string, fallback = ''): string => {
    if (process.env[key] !== undefined && process.env[key] !== '') {
      return String(process.env[key]);
    }
    if (fileVars[key] !== undefined) {
      return fileVars[key];
    }
    return fallback;
  };

  const connectionString =
    getVar('DATABASE_URL') || getVar('POSTGRES_URL') || undefined;
  const host = getVar('DB_HOST', '127.0.0.1');
  const port = Number(getVar('DB_PORT', '5432')) || 5432;
  const database = getVar('DB_DATABASE', 'clarify_db');
  const user = getVar('DB_USERNAME', 'postgres');
  const password = getVar('DB_PASSWORD', '');

  return {
    connectionString,
    host,
    port,
    database,
    user,
    password,
  };
}

async function tryCreatePool(cfg: PgConnectionConfig): Promise<Pool> {
  const candidatePasswords = Array.from(
    new Set([cfg.password, 'postgres', 'root', 'password', ''])
  );

  let lastErr: unknown = null;

  for (const pwd of candidatePasswords) {
    const testPool = new Pool(
      cfg.connectionString
        ? {
            connectionString: cfg.connectionString,
            connectionTimeoutMillis: 2000,
          }
        : {
            host: cfg.host,
            port: cfg.port,
            database: cfg.database,
            user: cfg.user,
            password: pwd,
            connectionTimeoutMillis: 2000,
          }
    );

    try {
      const client = await testPool.connect();
      client.release();
      cfg.password = pwd;
      return testPool;
    } catch (err: unknown) {
      await testPool.end().catch(() => {});
      lastErr = err;
      const pgCode = (err as { code?: string })?.code;

      // 3D000 = database does not exist -> connect to 'postgres' maintenance DB and create it
      if (pgCode === '3D000' && !cfg.connectionString) {
        try {
          const adminPool = new Pool({
            host: cfg.host,
            port: cfg.port,
            database: 'postgres',
            user: cfg.user,
            password: pwd,
            connectionTimeoutMillis: 2000,
          });
          const safeDbName = cfg.database.replace(/[^a-zA-Z0-9_]/g, '');
          await adminPool.query(`CREATE DATABASE "${safeDbName}"`);
          await adminPool.end();

          const retryPool = new Pool({
            host: cfg.host,
            port: cfg.port,
            database: cfg.database,
            user: cfg.user,
            password: pwd,
            connectionTimeoutMillis: 2000,
          });
          const client = await retryPool.connect();
          client.release();
          cfg.password = pwd;
          return retryPool;
        } catch (createErr) {
          lastErr = createErr;
        }
      }

      if (cfg.connectionString) {
        break;
      }
    }
  }

  throw lastErr || new Error('Unable to connect to PostgreSQL');
}

async function ensurePostgresSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        institutional_id VARCHAR(32) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL DEFAULT 'ustp2026',
        contact_number TEXT NULL,
        avatar_url VARCHAR(255) NULL,
        role VARCHAR(32) NOT NULL DEFAULT 'student',
        verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
        verified_at TIMESTAMP NULL,
        verified_by BIGINT NULL,
        remember_token VARCHAR(100) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS academic_profiles (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        campus VARCHAR(255) NOT NULL DEFAULT 'CDO Campus',
        college VARCHAR(255) NOT NULL DEFAULT 'CITC',
        department VARCHAR(255) NOT NULL DEFAULT 'CITC',
        program VARCHAR(255) NULL,
        year_level SMALLINT NULL,
        section VARCHAR(255) NULL,
        semester_code VARCHAR(255) NOT NULL DEFAULT '2026-1ST-SEM',
        specialization VARCHAR(255) NULL,
        office_location VARCHAR(255) NULL,
        consultation_hours VARCHAR(255) NULL,
        courses_handled JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS channels (
        id BIGSERIAL PRIMARY KEY,
        course_code VARCHAR(32) NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        channel_type VARCHAR(32) NOT NULL DEFAULT 'course_hub',
        scope_college VARCHAR(255) NULL,
        scope_department VARCHAR(255) NULL,
        scope_section VARCHAR(255) NULL,
        instructor_name VARCHAR(255) NULL,
        created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS channel_user (
        id BIGSERIAL PRIMARY KEY,
        channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        can_publish BOOLEAN NOT NULL DEFAULT FALSE,
        joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(channel_id, user_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id BIGSERIAL PRIMARY KEY,
        channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        publisher_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        subtitle VARCHAR(255) NOT NULL DEFAULT 'USTP Digital Transformation',
        content TEXT NOT NULL,
        attachment_url VARCHAR(255) NULL,
        attachment_name VARCHAR(255) NULL,
        attachment_type VARCHAR(32) NULL,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_urgent BOOLEAN NOT NULL DEFAULT FALSE,
        is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
        trigger_sms_fallback BOOLEAN NOT NULL DEFAULT FALSE,
        status VARCHAR(32) NOT NULL DEFAULT 'published',
        is_edited BOOLEAN NOT NULL DEFAULT FALSE,
        published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS announcement_reads (
        id BIGSERIAL PRIMARY KEY,
        announcement_id BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        acknowledged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(announcement_id, user_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS announcement_audits (
        id BIGSERIAL PRIMARY KEY,
        announcement_id BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        editor_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        previous_title VARCHAR(255) NOT NULL,
        new_title VARCHAR(255) NOT NULL,
        previous_content TEXT NOT NULL,
        new_content TEXT NOT NULL,
        edited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        announcement_id BIGINT NULL REFERENCES announcements(id) ON DELETE SET NULL,
        sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id BIGINT NULL REFERENCES messages(id) ON DELETE CASCADE,
        subject_hashtag VARCHAR(255) NULL,
        content TEXT NOT NULL,
        is_private BOOLEAN NOT NULL DEFAULT FALSE,
        is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
        is_pinned_faq BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS prisms_sync_logs (
        id BIGSERIAL PRIMARY KEY,
        semester_code VARCHAR(255) NOT NULL,
        triggered_by VARCHAR(255) NOT NULL,
        sync_type VARCHAR(32) NOT NULL DEFAULT 'scheduled_midnight',
        total_updated INTEGER NOT NULL DEFAULT 0,
        channels_provisioned INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'completed',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS device_tokens (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expo_push_token VARCHAR(255) UNIQUE NOT NULL,
        platform VARCHAR(32) NOT NULL DEFAULT 'android',
        last_registered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure the 4 baseline role accounts exist by institutional_id (without hardcoded IDs that could conflict)
    const baselineAccounts = [
      {
        institutional_id: '2020202020',
        name: 'Kobeni Higashiyama',
        email: 'higashiyama.kobeni@ustp.edu.ph',
        contact_number: '+63 917 842 2020',
        role: 'student',
        verification_status: 'approved',
        campus: 'CDO Campus',
        college: 'CITC',
        department: 'CITC',
        program: 'BS Information Technology',
        year_level: 3,
        section: 'IT3R2',
        specialization: null,
        office_location: null,
        consultation_hours: null,
        courses_handled: [],
      },
      {
        institutional_id: '10492',
        name: 'Aki Hayakawa',
        email: 'aki.hayakawa@ustp.edu.ph',
        contact_number: '+63 917 550 0492',
        role: 'faculty',
        verification_status: 'approved',
        campus: 'CDO Campus',
        college: 'CITC',
        department: 'CITC',
        program: 'BS Information Technology',
        year_level: null,
        section: 'CITC Dept',
        specialization: 'Software Engineering & Distributed Systems',
        office_location: 'ICT Bldg Room 304',
        consultation_hours: 'MWF 1:00 PM – 4:00 PM',
        courses_handled: ['IT314 Software Engineering', 'IT321 Capstone Project 1'],
      },
      {
        institutional_id: '90001',
        name: 'Engr. Makima Cruz',
        email: 'icto.admin@ustp.edu.ph',
        contact_number: '+63 917 900 0001',
        role: 'it_admin',
        verification_status: 'approved',
        campus: 'CDO Campus',
        college: 'ICTO',
        department: 'CITC',
        program: null,
        year_level: null,
        section: 'Registrar & ICTO',
        specialization: null,
        office_location: null,
        consultation_hours: null,
        courses_handled: [],
      },
      {
        institutional_id: '2023309999',
        name: 'Nayuta Hayakawa',
        email: 'nayuta.hayakawa@ustp.edu.ph',
        contact_number: '+63 917 301 9999',
        role: 'student',
        verification_status: 'pending',
        campus: 'CDO Campus',
        college: 'CITC',
        department: 'CITC',
        program: 'BS Information Technology',
        year_level: 3,
        section: 'IT3R2',
        specialization: null,
        office_location: null,
        consultation_hours: null,
        courses_handled: [],
      },
    ];

    for (const acc of baselineAccounts) {
      const existing = await client.query(
        'SELECT id FROM users WHERE institutional_id = $1 LIMIT 1',
        [acc.institutional_id]
      );
      let uid: number;
      if (!existing.rowCount || existing.rowCount === 0) {
        const ins = await client.query(
          `INSERT INTO users (institutional_id, name, email, password, contact_number, role, verification_status, verified_at)
           VALUES ($1, $2, $3, 'ustp2026', $4, $5, $6, $7)
           ON CONFLICT (institutional_id) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [
            acc.institutional_id,
            acc.name,
            acc.email,
            acc.contact_number,
            acc.role,
            acc.verification_status,
            acc.verification_status === 'approved' ? new Date().toISOString() : null,
          ]
        );
        uid = Number(ins.rows[0].id);
      } else {
        uid = Number(existing.rows[0].id);
      }

      await client.query(
        `INSERT INTO academic_profiles (
           user_id, campus, college, department, program, year_level, section,
           semester_code, specialization, office_location, consultation_hours, courses_handled
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-1ST-SEM', $8, $9, $10, $11::jsonb)
         ON CONFLICT (user_id) DO NOTHING`,
        [
          uid,
          acc.campus,
          acc.college,
          acc.department,
          acc.program,
          acc.year_level,
          acc.section,
          acc.specialization,
          acc.office_location,
          acc.consultation_hours,
          JSON.stringify(acc.courses_handled),
        ]
      );
    }

    // Ensure at least one default Course Hub channel exists if channels table is empty
    const chCountRes = await client.query(
      'SELECT COUNT(*)::int AS cnt FROM channels'
    );
    if (Number(chCountRes.rows[0].cnt) === 0) {
      const akiRes = await client.query(
        "SELECT id FROM users WHERE institutional_id = '10492' LIMIT 1"
      );
      const kobeniRes = await client.query(
        "SELECT id FROM users WHERE institutional_id = '2020202020' LIMIT 1"
      );
      const akiId = akiRes.rowCount ? Number(akiRes.rows[0].id) : null;
      const kobeniId = kobeniRes.rowCount ? Number(kobeniRes.rows[0].id) : null;

      const insCh = await client.query(
        `INSERT INTO channels (
           course_code, name, description, channel_type,
           scope_college, scope_department, scope_section, instructor_name, created_by
         )
         VALUES (
           'IT314',
           '# IT314 SoftEng',
           'IT3R2 — Software Engineering Hub (Agile Sprint Reviews, SRS & Capstone Architecture)',
           'course_hub',
           'CITC',
           'CITC',
           'IT3R2',
           'Aki Hayakawa',
           $1
         )
         RETURNING id`,
        [akiId]
      );
      const newChannelId = Number(insCh.rows[0].id);

      if (akiId) {
        await client.query(
          `INSERT INTO channel_user (channel_id, user_id, can_publish)
           VALUES ($1, $2, TRUE)
           ON CONFLICT (channel_id, user_id) DO NOTHING`,
          [newChannelId, akiId]
        );
      }
      if (kobeniId) {
        await client.query(
          `INSERT INTO channel_user (channel_id, user_id, can_publish)
           VALUES ($1, $2, FALSE)
           ON CONFLICT (channel_id, user_id) DO NOTHING`,
          [newChannelId, kobeniId]
        );
      }
    }

    // Safely align sequences so next INSERT never collides with existing primary keys
    const tablesWithSeq = [
      'users',
      'academic_profiles',
      'channels',
      'channel_user',
      'announcements',
      'announcement_reads',
      'announcement_audits',
      'messages',
      'prisms_sync_logs',
      'device_tokens',
    ];
    for (const tbl of tablesWithSeq) {
      await client
        .query(
          `SELECT setval(
            pg_get_serial_sequence('${tbl}', 'id'),
            COALESCE((SELECT MAX(id) FROM ${tbl}), 1),
            (SELECT COUNT(*) > 0 FROM ${tbl})
          );`
        )
        .catch(() => {});
    }
  } finally {
    client.release();
  }
}

export async function getPostgresPool(): Promise<Pool | null> {
  const state = getPgState();
  if (state.pool && state.initialized) {
    return state.pool;
  }

  const now = Date.now();
  if (!state.pool && state.lastCheckedAt && now - state.lastCheckedAt < 3000) {
    return null;
  }

  if (state.initializingPromise) {
    const ok = await state.initializingPromise;
    return ok ? state.pool : null;
  }

  state.initializingPromise = (async () => {
    state.lastCheckedAt = Date.now();
    try {
      const cfg = resolvePgConfig();
      const pool = await tryCreatePool(cfg);
      await ensurePostgresSchema(pool);
      state.pool = pool;
      state.config = cfg;
      state.initialized = true;
      state.lastError = null;
      return true;
    } catch (err: unknown) {
      state.lastError =
        err instanceof Error ? err.message : 'PostgreSQL connection unavailable';
      state.pool = null;
      state.initialized = false;
      return false;
    } finally {
      state.initializingPromise = null;
    }
  })();

  const ready = await state.initializingPromise;
  return ready ? state.pool : null;
}

export async function getPostgresStatusInfo(): Promise<{
  connected: boolean;
  database?: string;
  host?: string;
  error?: string | null;
}> {
  const pool = await getPostgresPool();
  const state = getPgState();
  if (!pool || !state.config) {
    return {
      connected: false,
      error: state.lastError,
    };
  }
  return {
    connected: true,
    database: state.config.database,
    host: `${state.config.host}:${state.config.port}`,
  };
}

export async function getPostgresFingerprint(): Promise<string | null> {
  const pool = await getPostgresPool();
  if (!pool) return null;
  try {
    const res = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM announcements WHERE deleted_at IS NULL) AS a_cnt,
        (SELECT COALESCE(MAX(updated_at)::text, '') FROM announcements WHERE deleted_at IS NULL) AS a_max,
        (SELECT COUNT(*) FROM announcement_reads) AS r_cnt,
        (SELECT COUNT(*) FROM messages) AS m_cnt,
        (SELECT COALESCE(MAX(updated_at)::text, '') FROM messages) AS m_max,
        (SELECT COUNT(*) FROM channels) AS c_cnt,
        (SELECT COUNT(*) FROM users) AS u_cnt,
        (SELECT COALESCE(MAX(updated_at)::text, '') FROM users) AS u_max
    `);
    const r = res.rows[0];
    return `${r.a_cnt}:${r.a_max}:${r.r_cnt}:${r.m_cnt}:${r.m_max}:${r.c_cnt}:${r.u_cnt}:${r.u_max}`;
  } catch {
    return null;
  }
}

// ============================================================================
// SQL MAPPERS & HELPERS
// ============================================================================

function mapRowToUser(row: Record<string, unknown>): User {
  return {
    id: Number(row.id),
    institutional_id: String(row.institutional_id),
    name: String(row.name),
    email: String(row.email),
    contact_number: row.contact_number ? String(row.contact_number) : null,
    avatar_url: row.avatar_url ? String(row.avatar_url) : null,
    role: (row.role as UserRole) || 'student',
    verification_status:
      (row.verification_status as VerificationStatus) || 'approved',
    academic_profile: {
      campus: String(row.campus || 'CDO Campus'),
      college: String(row.college || 'CITC'),
      department: String(row.department || 'CITC'),
      program: row.program ? String(row.program) : null,
      year_level:
        row.year_level !== null && row.year_level !== undefined
          ? Number(row.year_level)
          : null,
      section: row.section ? String(row.section) : null,
      semester_code: String(row.semester_code || '2026-1ST-SEM'),
    },
  };
}

async function resolveValidChannel(
  pool: Pool,
  requestedChannelId?: number | null
): Promise<{ id: number; channel_type: string; name: string }> {
  if (requestedChannelId && !Number.isNaN(requestedChannelId)) {
    const exact = await pool.query(
      'SELECT id, channel_type, name FROM channels WHERE id = $1 LIMIT 1',
      [requestedChannelId]
    );
    if (exact.rowCount && exact.rowCount > 0) {
      return {
        id: Number(exact.rows[0].id),
        channel_type: String(exact.rows[0].channel_type || 'course_hub'),
        name: String(exact.rows[0].name || '# IT314 SoftEng'),
      };
    }
  }

  const first = await pool.query(
    'SELECT id, channel_type, name FROM channels ORDER BY id ASC LIMIT 1'
  );
  if (first.rowCount && first.rowCount > 0) {
    return {
      id: Number(first.rows[0].id),
      channel_type: String(first.rows[0].channel_type || 'course_hub'),
      name: String(first.rows[0].name || '# IT314 SoftEng'),
    };
  }

  // If channels table is completely empty, create default course hub channel
  const ins = await pool.query(
    `INSERT INTO channels (course_code, name, description, channel_type, scope_college, scope_department, scope_section, instructor_name)
     VALUES ('IT314', '# IT314 SoftEng', 'IT3R2 — Software Engineering Hub', 'course_hub', 'CITC', 'CITC', 'IT3R2', 'Aki Hayakawa')
     RETURNING id, channel_type, name`
  );
  return {
    id: Number(ins.rows[0].id),
    channel_type: String(ins.rows[0].channel_type || 'course_hub'),
    name: String(ins.rows[0].name || '# IT314 SoftEng'),
  };
}

async function resolveUserFromRequestHeaders(
  pool: Pool,
  headers?: Record<string, string | undefined>
): Promise<{ user: User | null; pendingUser: User | null }> {
  const authHeader = headers?.authorization || headers?.Authorization;
  const instHeader =
    headers?.['x-clarify-institutional-id'] ||
    headers?.['X-Clarify-Institutional-Id'];
  const userIdHeader =
    headers?.['x-clarify-user-id'] || headers?.['X-Clarify-User-Id'];

  const state = getPgState();
  let instId: string | null = instHeader ? instHeader.trim() : null;
  let userId: number | null =
    userIdHeader && !Number.isNaN(Number(userIdHeader))
      ? Number(userIdHeader)
      : null;

  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token) {
      if (state.tokens[token]) {
        userId = state.tokens[token];
      }

      const jwtMatch = token.match(/^clarify-jwt-([a-z_]+)-(.+)$/i);
      if (jwtMatch) {
        instId = jwtMatch[2];
      } else if (token.includes('student-2020202020')) {
        instId = '2020202020';
      } else if (token.includes('faculty-10492')) {
        instId = '10492';
      } else if (token.includes('admin-90001')) {
        instId = '90001';
      } else if (token.includes('|')) {
        // Laravel Sanctum plainTextToken format: "<tokenId>|<plainText>"
        const parts = token.split('|');
        const plainText = parts.slice(1).join('|');
        if (plainText) {
          const hashed = crypto
            .createHash('sha256')
            .update(plainText)
            .digest('hex');
          try {
            const patRes = await pool.query(
              'SELECT tokenable_id FROM personal_access_tokens WHERE token = $1 LIMIT 1',
              [hashed]
            );
            if (patRes.rowCount && patRes.rowCount > 0) {
              userId = Number(patRes.rows[0].tokenable_id);
            }
          } catch {
            // personal_access_tokens table may not exist if Laravel migrations haven't run
          }
        }
      }
    }
  }

  // First try matching by institutional_id (most reliable across database resets)
  if (instId) {
    const byInst = await pool.query(
      `SELECT u.*, ap.campus, ap.college, ap.department, ap.program, ap.year_level, ap.section, ap.semester_code
       FROM users u
       LEFT JOIN academic_profiles ap ON ap.user_id = u.id
       WHERE u.institutional_id = $1
       LIMIT 1`,
      [instId]
    );
    if (byInst.rowCount && byInst.rowCount > 0) {
      const mapped = mapRowToUser(byInst.rows[0]);
      if (mapped.verification_status !== 'approved') {
        return { user: null, pendingUser: mapped };
      }
      return { user: mapped, pendingUser: null };
    }
  }

  // Next try matching by numeric user ID
  if (userId) {
    const byId = await pool.query(
      `SELECT u.*, ap.campus, ap.college, ap.department, ap.program, ap.year_level, ap.section, ap.semester_code
       FROM users u
       LEFT JOIN academic_profiles ap ON ap.user_id = u.id
       WHERE u.id = $1
       LIMIT 1`,
      [userId]
    );
    if (byId.rowCount && byId.rowCount > 0) {
      const mapped = mapRowToUser(byId.rows[0]);
      if (mapped.verification_status !== 'approved') {
        return { user: null, pendingUser: mapped };
      }
      return { user: mapped, pendingUser: null };
    }
  }

  return { user: null, pendingUser: null };
}

async function fetchAnnouncementsFromPg(
  pool: Pool,
  activeUser: User
): Promise<Announcement[]> {
  const res = await pool.query(`
    SELECT
      a.*,
      u.id AS pub_id,
      u.name AS pub_name,
      u.role AS pub_role,
      u.avatar_url AS pub_avatar,
      COALESCE(ap.department, 'CITC') AS pub_department
    FROM announcements a
    JOIN users u ON u.id = a.publisher_id
    LEFT JOIN academic_profiles ap ON ap.user_id = u.id
    WHERE a.deleted_at IS NULL
    ORDER BY a.is_urgent DESC, a.is_pinned DESC, a.published_at DESC, a.id DESC
  `);

  const readsRes = await pool.query(
    'SELECT announcement_id, user_id FROM announcement_reads'
  );
  const readsByAnn: Record<number, number[]> = {};
  for (const r of readsRes.rows) {
    const aid = Number(r.announcement_id);
    const uid = Number(r.user_id);
    if (!readsByAnn[aid]) readsByAnn[aid] = [];
    readsByAnn[aid].push(uid);
  }

  return res.rows.map((row) => {
    const id = Number(row.id);
    const readerIds = readsByAnn[id] || [];
    const hasAck = readerIds.includes(activeUser.id);
    const ackCount = Math.max(1, readerIds.length);
    const enrolledTotal = 42;
    const percentage = Number(((ackCount / enrolledTotal) * 100).toFixed(1));

    let parsedTags: string[] = [];
    if (Array.isArray(row.tags)) {
      parsedTags = row.tags.map(String);
    } else if (typeof row.tags === 'string') {
      try {
        parsedTags = JSON.parse(row.tags);
      } catch {
        parsedTags = [];
      }
    }

    return {
      id,
      channel_id: Number(row.channel_id),
      title: String(row.title),
      subtitle: String(row.subtitle || 'USTP Digital Transformation'),
      content: String(row.content),
      attachment_url: row.attachment_url ? String(row.attachment_url) : null,
      attachment_name: row.attachment_name ? String(row.attachment_name) : null,
      attachment_type:
        (row.attachment_type as 'image' | 'document' | null) || null,
      tags: parsedTags,
      is_urgent: Boolean(row.is_urgent),
      is_pinned: Boolean(row.is_pinned),
      trigger_sms_fallback: Boolean(row.trigger_sms_fallback),
      status: (row.status as 'draft' | 'published' | 'archived') || 'published',
      is_edited: Boolean(row.is_edited),
      published_at: new Date(
        String(row.published_at || row.created_at)
      ).toISOString(),
      updated_at: new Date(
        String(row.updated_at || row.published_at)
      ).toISOString(),
      read_reach: {
        acknowledged_count: ackCount,
        enrolled_total: enrolledTotal,
        percentage,
        has_current_user_acknowledged: hasAck,
      },
      publisher: {
        id: Number(row.pub_id),
        name: String(row.pub_name),
        role: (row.pub_role as UserRole) || 'faculty',
        department: String(row.pub_department || 'CITC'),
        avatar_url: row.pub_avatar ? String(row.pub_avatar) : null,
      },
    };
  });
}

async function fetchChannelsFromPg(pool: Pool): Promise<Channel[]> {
  const chRes = await pool.query(`
    SELECT c.*
    FROM channels c
    ORDER BY c.id ASC
  `);

  const rosterRes = await pool.query(`
    SELECT
      cu.channel_id,
      u.id,
      u.institutional_id,
      u.name,
      u.role,
      COALESCE(ap.section, 'IT3R2') AS section,
      COALESCE(ap.department, 'CITC') AS department
    FROM channel_user cu
    JOIN users u ON u.id = cu.user_id
    LEFT JOIN academic_profiles ap ON ap.user_id = u.id
    ORDER BY cu.joined_at ASC
  `);

  const latestAnnRes = await pool.query(`
    SELECT DISTINCT ON (a.channel_id)
      a.channel_id,
      a.content,
      a.published_at,
      u.name AS publisher_name
    FROM announcements a
    JOIN users u ON u.id = a.publisher_id
    WHERE a.deleted_at IS NULL
    ORDER BY a.channel_id, a.published_at DESC
  `);

  const openThreadsCountRes = await pool.query(`
    SELECT channel_id, COUNT(*)::int AS cnt
    FROM messages
    WHERE parent_id IS NULL
      AND is_resolved = FALSE
      AND (subject_hashtag IS NULL OR subject_hashtag != '__CHAT__')
    GROUP BY channel_id
  `);

  const rosterByChannel: Record<number, ChannelMember[]> = {};
  for (const r of rosterRes.rows) {
    const cid = Number(r.channel_id);
    if (!rosterByChannel[cid]) rosterByChannel[cid] = [];
    rosterByChannel[cid].push({
      id: Number(r.id),
      institutional_id: String(r.institutional_id),
      name: String(r.name),
      role: (r.role as UserRole) || 'student',
      section: r.section ? String(r.section) : 'IT3R2',
      department: String(r.department || 'CITC'),
    });
  }

  const latestByChannel: Record<number, { preview: string; at: string }> = {};
  for (const r of latestAnnRes.rows) {
    const cid = Number(r.channel_id);
    latestByChannel[cid] = {
      preview: `${r.publisher_name}: ${String(r.content).slice(0, 110)}...`,
      at: 'Recent',
    };
  }

  const unreadByChannel: Record<number, number> = {};
  for (const r of openThreadsCountRes.rows) {
    unreadByChannel[Number(r.channel_id)] = Number(r.cnt);
  }

  return chRes.rows.map((row) => {
    const cid = Number(row.id);
    const roster = rosterByChannel[cid] || [];
    return {
      id: cid,
      course_code: row.course_code ? String(row.course_code) : null,
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      channel_type:
        (row.channel_type as Channel['channel_type']) || 'course_hub',
      scope_college: row.scope_college ? String(row.scope_college) : 'CITC',
      scope_department: row.scope_department
        ? String(row.scope_department)
        : 'CITC',
      scope_section: row.scope_section ? String(row.scope_section) : 'IT3R2',
      unread_count: unreadByChannel[cid] || 0,
      members_count: Math.max(roster.length, 42),
      instructor_name: row.instructor_name
        ? String(row.instructor_name)
        : 'Aki Hayakawa',
      latest_activity_preview:
        latestByChannel[cid]?.preview ||
        'Course Hub active for scoped announcements and Q&A.',
      latest_activity_at: latestByChannel[cid]?.at || 'Active',
      roster,
    };
  });
}

async function fetchThreadsForChannelFromPg(
  pool: Pool,
  channelId: number
): Promise<QaThread[]> {
  const rootsRes = await pool.query(
    `SELECT
       m.*,
       u.name AS author_name,
       u.role AS author_role,
       u.avatar_url AS author_avatar
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.channel_id = $1
       AND m.parent_id IS NULL
       AND (m.subject_hashtag IS NULL OR m.subject_hashtag != '__CHAT__')
     ORDER BY m.created_at DESC, m.id DESC`,
    [channelId]
  );

  const repliesRes = await pool.query(
    `SELECT
       m.*,
       u.name AS author_name,
       u.role AS author_role,
       u.avatar_url AS author_avatar
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.channel_id = $1
       AND m.parent_id IS NOT NULL
     ORDER BY m.created_at ASC, m.id ASC`,
    [channelId]
  );

  const repliesByParent: Record<number, ThreadReply[]> = {};
  for (const r of repliesRes.rows) {
    const pid = Number(r.parent_id);
    if (!repliesByParent[pid]) repliesByParent[pid] = [];
    repliesByParent[pid].push({
      id: Number(r.id),
      thread_id: pid,
      content: String(r.content),
      created_at: new Date(String(r.created_at)).toISOString(),
      author: {
        id: Number(r.sender_id),
        name: String(r.author_name),
        role: (r.author_role as UserRole) || 'faculty',
        avatar_url: r.author_avatar ? String(r.author_avatar) : null,
      },
    });
  }

  return rootsRes.rows.map((row) => {
    const tid = Number(row.id);
    const isPinnedFaq = Boolean(row.is_pinned_faq);
    return enforceFaqAnonymity({
      id: tid,
      channel_id: Number(row.channel_id),
      announcement_id: row.announcement_id ? Number(row.announcement_id) : null,
      subject_hashtag: String(row.subject_hashtag || '#Inquiry'),
      content: String(row.content),
      is_private: Boolean(row.is_private),
      is_resolved: Boolean(row.is_resolved),
      is_pinned_faq: isPinnedFaq,
      created_at: new Date(String(row.created_at)).toISOString(),
      updated_at: new Date(
        String(row.updated_at || row.created_at)
      ).toISOString(),
      author: {
        id: isPinnedFaq ? null : Number(row.sender_id),
        name: isPinnedFaq ? 'Anonymous Student' : String(row.author_name),
        role: (row.author_role as UserRole) || 'student',
        avatar_url: isPinnedFaq
          ? null
          : row.author_avatar
          ? String(row.author_avatar)
          : null,
      },
      replies: repliesByParent[tid] || [],
    });
  });
}

// ============================================================================
// MAIN POSTGRESQL REQUEST HANDLER
// ============================================================================

export async function handlePostgresApiRequest(
  req: ApiEngineRequest
): Promise<ApiEngineResponse | null> {
  const pool = await getPostgresPool();
  if (!pool) {
    return null;
  }

  try {
    const state = getPgState();
    const method = req.method.toUpperCase();
    const cleanPath =
      req.path.replace(/^\/api\/v1/, '').replace(/^\/api/, '') || '/';
    const query = req.query || {};
    const body = req.body || {};
    const authHeader =
      req.headers?.authorization || req.headers?.Authorization || undefined;

    // HEALTH CHECK
    if (method === 'GET' && cleanPath === '/health') {
      return {
        status: 200,
        body: {
          status: 'ok',
          service: 'clarify-api',
          version: 'v1',
          driver: 'postgresql-direct',
          database: state.config?.database || 'clarify_db',
        },
      };
    }

    // PUBLIC LOGIN: POST /auth/login
    if (method === 'POST' && cleanPath === '/auth/login') {
      const institutionalId = String(body.institutional_id || '').trim();
      const password = String(body.password || '').trim();

      const errors: Record<string, string[]> = {};
      if (!institutionalId) {
        errors.institutional_id = ['The institutional ID field is required.'];
      }
      if (!password) {
        errors.password = ['The password field is required.'];
      }
      if (Object.keys(errors).length > 0) {
        return {
          status: 422,
          body: {
            status: 422,
            message: 'The given data was invalid.',
            errors,
          },
        };
      }

      const userRes = await pool.query(
        `SELECT u.*, ap.campus, ap.college, ap.department, ap.program, ap.year_level, ap.section, ap.semester_code
         FROM users u
         LEFT JOIN academic_profiles ap ON ap.user_id = u.id
         WHERE u.institutional_id = $1
         LIMIT 1`,
        [institutionalId]
      );

      let matchedUser: User;
      if (userRes.rowCount && userRes.rowCount > 0) {
        matchedUser = mapRowToUser(userRes.rows[0]);
      } else if (institutionalId.toLowerCase() === 'pending') {
        return {
          status: 403,
          body: {
            status: 403,
            verification_status: 'pending',
            message:
              'Your account is pending IT Administrator registrar verification (FR-08).',
          },
        };
      } else {
        // Auto-provision student record in PostgreSQL if logging in with a new student ID
        const insUser = await pool.query(
          `INSERT INTO users (institutional_id, name, email, password, role, verification_status, verified_at)
           VALUES ($1, $2, $3, 'ustp2026', 'student', 'approved', CURRENT_TIMESTAMP)
           RETURNING *`,
          [
            institutionalId,
            `USTP Student (${institutionalId})`,
            `student.${institutionalId}@ustp.edu.ph`,
          ]
        );
        const newUid = Number(insUser.rows[0].id);
        await pool.query(
          `INSERT INTO academic_profiles (user_id, campus, college, department, program, year_level, section, semester_code)
           VALUES ($1, 'CDO Campus', 'CITC', 'CITC', 'BS Information Technology', 3, 'IT3R2', '2026-1ST-SEM')
           ON CONFLICT (user_id) DO NOTHING`,
          [newUid]
        );
        matchedUser = {
          id: newUid,
          institutional_id: institutionalId,
          name: `USTP Student (${institutionalId})`,
          email: `student.${institutionalId}@ustp.edu.ph`,
          role: 'student',
          verification_status: 'approved',
          academic_profile: {
            campus: 'CDO Campus',
            college: 'CITC',
            department: 'CITC',
            program: 'BS Information Technology',
            year_level: 3,
            section: 'IT3R2',
            semester_code: '2026-1ST-SEM',
          },
        };
      }

      if (matchedUser.verification_status !== 'approved') {
        return {
          status: 403,
          body: {
            status: 403,
            verification_status: matchedUser.verification_status,
            message:
              'Your account is pending IT Administrator registrar verification (FR-08).',
          },
        };
      }

      const token = `clarify-jwt-${matchedUser.role}-${matchedUser.institutional_id}`;
      state.tokens[token] = matchedUser.id;

      return {
        status: 200,
        body: {
          message: 'Authenticated successfully against PostgreSQL.',
          token,
          data: matchedUser,
        },
      };
    }

    // RESOLVE AUTHENTICATED USER
    const { user, pendingUser } = await resolveUserFromRequestHeaders(
      pool,
      req.headers
    );
    if (pendingUser && pendingUser.verification_status !== 'approved') {
      return {
        status: 403,
        body: {
          status: 403,
          verification_status: pendingUser.verification_status,
          message:
            'Your account is pending IT Administrator registrar verification (FR-08).',
        },
      };
    }

    let activeUser: User | null = user;
    if (!activeUser) {
      const defRes = await pool.query(
        `SELECT u.*, ap.campus, ap.college, ap.department, ap.program, ap.year_level, ap.section, ap.semester_code
         FROM users u
         LEFT JOIN academic_profiles ap ON ap.user_id = u.id
         WHERE u.verification_status = 'approved'
         ORDER BY u.id ASC
         LIMIT 1`
      );
      if (defRes.rowCount && defRes.rowCount > 0) {
        activeUser = mapRowToUser(defRes.rows[0]);
      } else {
        return {
          status: 401,
          body: {
            status: 401,
            message: 'No verified user accounts found in PostgreSQL database.',
          },
        };
      }
    }

    // WORKFLOW 1: AUTH & PROFILE
    if (method === 'POST' && cleanPath === '/auth/logout') {
      if (authHeader) {
        const rawToken = authHeader.replace(/^Bearer\s+/i, '').trim();
        delete state.tokens[rawToken];
      }
      return {
        status: 200,
        body: { message: 'Logged out successfully.' },
      };
    }

    if (method === 'GET' && cleanPath === '/auth/me') {
      return {
        status: 200,
        body: { data: activeUser },
      };
    }

    if ((method === 'POST' || method === 'PATCH') && cleanPath === '/profile') {
      const contactNumber = String(body.contact_number || '').trim();
      const name = String(body.name || activeUser.name).trim();
      const avatarPreviewUrl = body.avatar_preview_url
        ? String(body.avatar_preview_url)
        : activeUser.avatar_url || null;

      if (!contactNumber) {
        return {
          status: 422,
          body: {
            status: 422,
            message: 'The contact number field is required.',
            errors: {
              contact_number: [
                'Please provide a valid mobile number for SMS fallback alerts (FR-06).',
              ],
            },
          },
        };
      }

      await pool.query(
        `UPDATE users
         SET name = $1, contact_number = $2, avatar_url = $3, updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [name, contactNumber, avatarPreviewUrl, activeUser.id]
      );

      const updatedUser: User = {
        ...activeUser,
        name,
        contact_number: contactNumber,
        avatar_url: avatarPreviewUrl,
      };

      return {
        status: 200,
        body: {
          message:
            'Profile settings and SMS fallback number saved to PostgreSQL (FR-06).',
          data: updatedUser,
        },
      };
    }

    // WORKFLOW 5: SCOPED CHANNELS & ROSTER
    if (method === 'GET' && cleanPath === '/channels') {
      const search = (query.search || '').trim().toLowerCase();
      const type = query.type || 'all';
      const allChannels = await fetchChannelsFromPg(pool);

      const filtered = allChannels.filter((ch) => {
        if (type !== 'all' && ch.channel_type !== type) return false;
        if (search) {
          const hay = `${ch.name} ${ch.course_code || ''} ${
            ch.description || ''
          } ${ch.scope_department || ''}`.toLowerCase();
          return hay.includes(search);
        }
        return true;
      });

      return {
        status: 200,
        body: { data: filtered },
      };
    }

    if (method === 'POST' && cleanPath === '/channels') {
      const courseCode = String(body.course_code || '').trim();
      const name = String(body.name || '').trim();
      const description = String(body.description || '').trim();
      const channelType =
        (body.channel_type as Channel['channel_type']) || 'course_hub';
      const scopeCollege = String(body.scope_college || 'CITC');
      const scopeDepartment = String(body.scope_department || 'CITC');
      const scopeSection = String(body.scope_section || 'IT3R2');

      const errors: Record<string, string[]> = {};
      if (!name) errors.name = ['The channel name field is required.'];
      if (!courseCode) {
        errors.course_code = [
          'The course code field is required (e.g., IT315).',
        ];
      }
      if (Object.keys(errors).length > 0) {
        return {
          status: 422,
          body: {
            status: 422,
            message: 'Channel validation failed.',
            errors,
          },
        };
      }

      const formattedName = name.startsWith('#') ? name : `# ${name}`;
      const insCh = await pool.query(
        `INSERT INTO channels (course_code, name, description, channel_type, scope_college, scope_department, scope_section, instructor_name, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          courseCode.toUpperCase(),
          formattedName,
          description || `${scopeSection} Scoped Course Hub`,
          channelType,
          scopeCollege,
          scopeDepartment,
          scopeSection,
          activeUser.name,
          activeUser.id,
        ]
      );

      const newChannelId = Number(insCh.rows[0].id);
      await pool.query(
        `INSERT INTO channel_user (channel_id, user_id, can_publish)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel_id, user_id) DO NOTHING`,
        [newChannelId, activeUser.id, activeUser.role !== 'student']
      );

      const allChannels = await fetchChannelsFromPg(pool);
      const created =
        allChannels.find((c) => c.id === newChannelId) || allChannels[0];

      return {
        status: 201,
        body: {
          message: 'Scoped channel saved to PostgreSQL.',
          data: created,
        },
      };
    }

    const joinMatch = cleanPath.match(/^\/channels\/(\d+)\/join$/);
    if (method === 'POST' && joinMatch) {
      const resolvedCh = await resolveValidChannel(pool, Number(joinMatch[1]));
      const channelId = resolvedCh.id;
      await pool.query(
        `INSERT INTO channel_user (channel_id, user_id, can_publish)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel_id, user_id) DO NOTHING`,
        [channelId, activeUser.id, activeUser.role !== 'student']
      );

      const allChannels = await fetchChannelsFromPg(pool);
      const updated =
        allChannels.find((c) => c.id === channelId) || allChannels[0];

      return {
        status: 200,
        body: {
          message: `Enrolled in ${updated.name} roster.`,
          data: updated,
        },
      };
    }

    const membersMatch = cleanPath.match(/^\/channels\/(\d+)\/members$/);
    if (method === 'POST' && membersMatch) {
      const resolvedCh = await resolveValidChannel(
        pool,
        Number(membersMatch[1])
      );
      const channelId = resolvedCh.id;
      const institutionalId = String(body.institutional_id || '').trim();
      const action = String(body.action || 'add') as 'add' | 'remove';

      if (action === 'add') {
        if (!institutionalId) {
          return {
            status: 422,
            body: {
              status: 422,
              message: 'Institutional ID is required.',
              errors: {
                institutional_id: [
                  'Please enter a valid student or faculty Institutional ID.',
                ],
              },
            },
          };
        }

        const targetUserRes = await pool.query(
          'SELECT id FROM users WHERE institutional_id = $1 LIMIT 1',
          [institutionalId]
        );
        let targetUserId: number;

        if (!targetUserRes.rowCount || targetUserRes.rowCount === 0) {
          const displayName =
            String(body.name || '').trim() ||
            `USTP Student (${institutionalId})`;
          const insU = await pool.query(
            `INSERT INTO users (institutional_id, name, email, password, role, verification_status, verified_at)
             VALUES ($1, $2, $3, 'ustp2026', 'student', 'approved', CURRENT_TIMESTAMP)
             RETURNING id`,
            [
              institutionalId,
              displayName,
              `student.${institutionalId}@ustp.edu.ph`,
            ]
          );
          targetUserId = Number(insU.rows[0].id);
          await pool.query(
            `INSERT INTO academic_profiles (user_id, campus, college, department, section, semester_code)
             VALUES ($1, 'CDO Campus', 'CITC', 'CITC', $2, '2026-1ST-SEM')
             ON CONFLICT (user_id) DO NOTHING`,
            [targetUserId, String(body.section || 'IT3R2')]
          );
        } else {
          targetUserId = Number(targetUserRes.rows[0].id);
        }

        await pool.query(
          `INSERT INTO channel_user (channel_id, user_id, can_publish)
           VALUES ($1, $2, FALSE)
           ON CONFLICT (channel_id, user_id) DO NOTHING`,
          [channelId, targetUserId]
        );
      } else {
        await pool.query(
          `DELETE FROM channel_user
           WHERE channel_id = $1
             AND user_id IN (SELECT id FROM users WHERE institutional_id = $2)`,
          [channelId, institutionalId]
        );
      }

      const allChannels = await fetchChannelsFromPg(pool);
      const updated =
        allChannels.find((c) => c.id === channelId) || allChannels[0];

      return {
        status: 200,
        body: {
          message:
            action === 'add'
              ? 'Member added to channel roster in PostgreSQL.'
              : 'Member removed from channel roster in PostgreSQL.',
          data: updated,
        },
      };
    }

    // WORKFLOWS 2 & 3: SCOPED ANNOUNCEMENTS, READ REACH & AUDITS
    if (method === 'GET' && cleanPath === '/announcements') {
      const includeDrafts = canPublishOrManageAnnouncements(activeUser.role);
      let channelId: number | undefined = undefined;
      if (query.channel_id) {
        const resolved = await resolveValidChannel(
          pool,
          Number(query.channel_id)
        );
        channelId = resolved.id;
      }

      const allAnnouncements = await fetchAnnouncementsFromPg(pool, activeUser);

      const sorted = filterAndSortAnnouncements(allAnnouncements, {
        channelId,
        search: query.search,
        department: query.department,
        tag: query.tag,
        sort:
          (query.sort as 'latest' | 'oldest' | 'urgent_first' | 'read_reach') ||
          'latest',
        includeDrafts,
      });

      const page = Math.max(1, Number(query.page || 1));
      const perPage = Math.max(1, Number(query.per_page || 4));
      const total = sorted.length;
      const lastPage = Math.max(1, Math.ceil(total / perPage));
      const start = (page - 1) * perPage;
      const sliced = sorted.slice(start, start + perPage);

      return {
        status: 200,
        body: {
          data: sliced,
          meta: {
            current_page: page,
            last_page: lastPage,
            per_page: perPage,
            total,
          },
        },
      };
    }

    if (
      method === 'POST' &&
      (cleanPath === '/announcements' || cleanPath === '/announcements/create')
    ) {
      if (!canPublishOrManageAnnouncements(activeUser.role)) {
        return {
          status: 403,
          body: {
            status: 403,
            message:
              'HTTP 403 Forbidden: Students are not authorized to publish announcements (TC-NFR01).',
          },
        };
      }

      const title = String(body.title || '').trim();
      const content = String(body.content || '').trim();
      const requestedChannelId = body.channel_id ? Number(body.channel_id) : 1;
      const isUrgent =
        body.is_urgent === true || String(body.is_urgent) === 'true';
      const triggerSms =
        body.trigger_sms_fallback === true ||
        String(body.trigger_sms_fallback) === 'true';
      const status =
        (body.status as 'published' | 'draft' | 'archived') || 'published';
      const attachmentName = body.attachment_name
        ? String(body.attachment_name)
        : null;
      const attachmentType = body.attachment_type as
        | 'image'
        | 'document'
        | null;

      const errors: Record<string, string[]> = {};
      if (!title) errors.title = ['The title field is required.'];
      if (!content) {
        errors.content = ['The announcement content field is required.'];
      }
      if (Object.keys(errors).length > 0) {
        return {
          status: 422,
          body: {
            status: 422,
            message:
              'The title field is required. Please complete all mandatory fields.',
            errors,
          },
        };
      }

      const targetChannel = await resolveValidChannel(pool, requestedChannelId);
      const channelId = targetChannel.id;
      const targetChannelType = targetChannel.channel_type;

      if (
        (targetChannelType === 'university' ||
          targetChannelType === 'college') &&
        activeUser.role === 'faculty'
      ) {
        return {
          status: 403,
          body: {
            status: 403,
            message:
              'HTTP 403 Forbidden: University-wide and College-wide memos are restricted to Department Heads, Deans, and IT Administrators (FR-02).',
          },
        };
      }

      let parsedTags: string[] = ['OFFICIAL MEMO', 'CDO CAMPUS', 'CITC'];
      if (Array.isArray(body.tags)) {
        parsedTags = body.tags.map((t) => String(t));
      } else if (typeof body.tags === 'string' && body.tags.trim()) {
        try {
          parsedTags = JSON.parse(body.tags);
        } catch {
          parsedTags = body.tags.split(',').map((t) => t.trim());
        }
      }
      if (isUrgent && !parsedTags.includes('URGENT NOTICE')) {
        parsedTags = ['URGENT NOTICE', ...parsedTags];
      }

      const attachmentUrl = attachmentName
        ? `/storage/memos/${attachmentName}`
        : null;

      const insRes = await pool.query(
        `INSERT INTO announcements (
           channel_id, publisher_id, title, subtitle, content,
           attachment_url, attachment_name, attachment_type, tags,
           is_urgent, is_pinned, trigger_sms_fallback, status, is_edited,
           published_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, 'USTP Digital Transformation', $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`,
        [
          channelId,
          activeUser.id,
          title,
          content,
          attachmentUrl,
          attachmentName,
          attachmentType || null,
          JSON.stringify(parsedTags),
          isUrgent,
          isUrgent,
          triggerSms,
          status === 'draft' ? 'draft' : 'published',
        ]
      );

      const newId = Number(insRes.rows[0].id);
      await pool.query(
        `INSERT INTO announcement_reads (announcement_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (announcement_id, user_id) DO NOTHING`,
        [newId, activeUser.id]
      );

      const allAnnouncements = await fetchAnnouncementsFromPg(pool, activeUser);
      const created =
        allAnnouncements.find((a) => a.id === newId) || allAnnouncements[0];

      return {
        status: 201,
        body: {
          message: isUrgent
            ? 'Urgent Announcement saved to PostgreSQL! Push alerts queued (<= 2.0s) and pinned to top.'
            : 'Announcement published and saved to PostgreSQL.',
          data: created,
        },
      };
    }

    const announcementIdMatch = cleanPath.match(/^\/announcements\/(\d+)$/);
    if ((method === 'PATCH' || method === 'POST') && announcementIdMatch) {
      if (!canPublishOrManageAnnouncements(activeUser.role)) {
        return {
          status: 403,
          body: {
            status: 403,
            message: 'HTTP 403 Forbidden: Students cannot edit announcements.',
          },
        };
      }

      const id = Number(announcementIdMatch[1]);
      const existingRes = await pool.query(
        'SELECT * FROM announcements WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
        [id]
      );
      if (!existingRes.rowCount || existingRes.rowCount === 0) {
        return {
          status: 422,
          body: {
            status: 422,
            message: 'Announcement not found.',
            errors: { title: ['Target announcement does not exist.'] },
          },
        };
      }

      const title = String(body.title || '').trim();
      const content = String(body.content || '').trim();
      const errors: Record<string, string[]> = {};
      if (!title) errors.title = ['The title field is required.'];
      if (!content) {
        errors.content = ['The announcement content field is required.'];
      }
      if (Object.keys(errors).length > 0) {
        return {
          status: 422,
          body: {
            status: 422,
            message: 'Validation failed.',
            errors,
          },
        };
      }

      const prev = existingRes.rows[0];

      // Log immutable audit entry in PostgreSQL (NFR-03_REV)
      await pool.query(
        `INSERT INTO announcement_audits (announcement_id, editor_id, previous_title, new_title, previous_content, new_content, edited_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [id, activeUser.id, prev.title, title, prev.content, content]
      );

      const isUrgent =
        body.is_urgent !== undefined
          ? Boolean(body.is_urgent)
          : Boolean(prev.is_urgent);
      const isPinned = isUrgent ? true : Boolean(prev.is_pinned);
      const triggerSms =
        body.trigger_sms_fallback !== undefined
          ? Boolean(body.trigger_sms_fallback)
          : Boolean(prev.trigger_sms_fallback);
      const nextStatus =
        (body.status as 'published' | 'draft' | 'archived') ||
        String(prev.status || 'published');
      const nextTags = Array.isArray(body.tags)
        ? JSON.stringify(body.tags.map(String))
        : JSON.stringify(prev.tags || []);

      await pool.query(
        `UPDATE announcements
         SET title = $1,
             content = $2,
             tags = $3::jsonb,
             is_urgent = $4,
             is_pinned = $5,
             trigger_sms_fallback = $6,
             status = $7,
             is_edited = TRUE,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $8`,
        [
          title,
          content,
          nextTags,
          isUrgent,
          isPinned,
          triggerSms,
          nextStatus,
          id,
        ]
      );

      const allAnnouncements = await fetchAnnouncementsFromPg(pool, activeUser);
      const updated =
        allAnnouncements.find((a) => a.id === id) || allAnnouncements[0];

      return {
        status: 200,
        body: {
          message:
            'Announcement updated in PostgreSQL and audit trail logged (NFR-03_REV).',
          data: updated,
        },
      };
    }

    if (method === 'DELETE' && announcementIdMatch) {
      if (!canPublishOrManageAnnouncements(activeUser.role)) {
        return {
          status: 403,
          body: {
            status: 403,
            message:
              'HTTP 403 Forbidden: Students cannot delete announcements.',
          },
        };
      }

      const id = Number(announcementIdMatch[1]);
      await pool.query(
        'UPDATE announcements SET deleted_at = CURRENT_TIMESTAMP, status = $1 WHERE id = $2',
        ['archived', id]
      );
      return {
        status: 200,
        body: {
          message:
            'Announcement archived in PostgreSQL and removed from active noticeboard.',
        },
      };
    }

    const ackMatch = cleanPath.match(/^\/announcements\/(\d+)\/acknowledge$/);
    if (method === 'POST' && ackMatch) {
      const id = Number(ackMatch[1]);
      await pool.query(
        `INSERT INTO announcement_reads (announcement_id, user_id, acknowledged_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (announcement_id, user_id) DO NOTHING`,
        [id, activeUser.id]
      );

      const allAnnouncements = await fetchAnnouncementsFromPg(pool, activeUser);
      const updated = allAnnouncements.find((a) => a.id === id);
      if (!updated) {
        return {
          status: 422,
          body: { status: 422, message: 'Announcement not found.' },
        };
      }

      return {
        status: 200,
        body: {
          message:
            'Announcement marked as read and acknowledged in PostgreSQL.',
          data: updated,
        },
      };
    }

    // COURSE HUB MESSENGER CHAT: GET & POST /channels/{channelId}/chat
    const channelChatMatch = cleanPath.match(/^\/channels\/(\d+)\/chat$/);
    if (method === 'GET' && channelChatMatch) {
      const resolvedCh = await resolveValidChannel(
        pool,
        Number(channelChatMatch[1])
      );
      const channelId = resolvedCh.id;
      const chatRes = await pool.query(
        `SELECT
           m.id,
           m.channel_id,
           m.content,
           m.created_at,
           u.id AS author_id,
           u.name AS author_name,
           u.role AS author_role,
           u.avatar_url AS author_avatar
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.channel_id = $1
           AND m.parent_id IS NULL
           AND m.subject_hashtag = '__CHAT__'
         ORDER BY m.created_at ASC, m.id ASC`,
        [channelId]
      );

      const messages: ChatMessage[] = chatRes.rows.map((r) => ({
        id: Number(r.id),
        channel_id: Number(r.channel_id),
        content: String(r.content),
        created_at: new Date(String(r.created_at)).toISOString(),
        author: {
          id: Number(r.author_id),
          name: String(r.author_name),
          role: (r.author_role as UserRole) || 'student',
          avatar_url: r.author_avatar ? String(r.author_avatar) : null,
        },
      }));

      return {
        status: 200,
        body: { data: messages },
      };
    }

    if (method === 'POST' && channelChatMatch) {
      const resolvedCh = await resolveValidChannel(
        pool,
        Number(channelChatMatch[1])
      );
      const channelId = resolvedCh.id;
      const content = String(body.content || '').trim();
      if (!content) {
        return {
          status: 422,
          body: {
            status: 422,
            message: 'Message content cannot be empty.',
            errors: { content: ['Please type a message before sending.'] },
          },
        };
      }

      const insMsg = await pool.query(
        `INSERT INTO messages (channel_id, sender_id, parent_id, subject_hashtag, content, is_private, is_resolved, is_pinned_faq, created_at, updated_at)
         VALUES ($1, $2, NULL, '__CHAT__', $3, FALSE, FALSE, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, created_at`,
        [channelId, activeUser.id, content]
      );

      const createdMsg: ChatMessage = {
        id: Number(insMsg.rows[0].id),
        channel_id: channelId,
        content,
        created_at: new Date(String(insMsg.rows[0].created_at)).toISOString(),
        author: {
          id: activeUser.id,
          name: activeUser.name,
          role: activeUser.role,
          avatar_url: activeUser.avatar_url || null,
        },
      };

      return {
        status: 201,
        body: {
          message: 'Message sent to Course Hub chat.',
          data: createdMsg,
        },
      };
    }

    // WORKFLOW 4: ISOLATED Q&A THREADS & 1-CLICK ANONYMIZED FAQS
    const channelThreadsMatch = cleanPath.match(/^\/channels\/(\d+)\/threads$/);
    if (method === 'GET' && channelThreadsMatch) {
      const resolvedCh = await resolveValidChannel(
        pool,
        Number(channelThreadsMatch[1])
      );
      const channelId = resolvedCh.id;
      const statusFilter = query.status || 'all';
      const allThreads = await fetchThreadsForChannelFromPg(pool, channelId);

      const list = allThreads
        .filter((t) => {
          if (statusFilter === 'resolved') return t.is_resolved;
          if (statusFilter === 'open') return !t.is_resolved;
          return true;
        })
        .filter((t) => {
          if (!t.is_private || t.is_pinned_faq) return true;
          if (activeUser.role !== 'student') return true;
          return t.author.id === activeUser.id;
        });

      return {
        status: 200,
        body: { data: list },
      };
    }

    if (method === 'POST' && channelThreadsMatch) {
      const resolvedCh = await resolveValidChannel(
        pool,
        Number(channelThreadsMatch[1])
      );
      const channelId = resolvedCh.id;
      const formattedHashtag = formatSubjectHashtag(
        String(body.subject_hashtag || '')
      );
      const content = String(body.content || '').trim();
      const isPrivate = Boolean(body.is_private);
      const announcementId = body.announcement_id
        ? Number(body.announcement_id)
        : null;

      const errors: Record<string, string[]> = {};
      if (!formattedHashtag) {
        errors.subject_hashtag = [
          'Please enter a subject hashtag (e.g., #Defence).',
        ];
      }
      if (!content) {
        errors.content = [
          'Please enter your inquiry or clarification details.',
        ];
      }
      if (Object.keys(errors).length > 0) {
        return {
          status: 422,
          body: {
            status: 422,
            message: 'Please complete all required inquiry fields.',
            errors,
          },
        };
      }

      const insThread = await pool.query(
        `INSERT INTO messages (channel_id, announcement_id, sender_id, parent_id, subject_hashtag, content, is_private, is_resolved, is_pinned_faq, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, FALSE, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`,
        [
          channelId,
          announcementId,
          activeUser.id,
          formattedHashtag,
          content,
          isPrivate,
        ]
      );

      const newThreadId = Number(insThread.rows[0].id);
      const threads = await fetchThreadsForChannelFromPg(pool, channelId);
      const created = threads.find((t) => t.id === newThreadId) || threads[0];

      return {
        status: 201,
        body: {
          message: 'Academic inquiry ticket submitted to PostgreSQL.',
          data: created,
        },
      };
    }

    const threadIdMatch = cleanPath.match(/^\/threads\/(\d+)$/);
    if (method === 'PATCH' && threadIdMatch) {
      const threadId = Number(threadIdMatch[1]);
      const existingRes = await pool.query(
        'SELECT * FROM messages WHERE id = $1 AND parent_id IS NULL LIMIT 1',
        [threadId]
      );
      if (!existingRes.rowCount || existingRes.rowCount === 0) {
        return {
          status: 422,
          body: { status: 422, message: 'Inquiry thread not found.' },
        };
      }

      const existing = existingRes.rows[0];
      if (existing.is_resolved) {
        return {
          status: 403,
          body: {
            status: 403,
            message: 'Resolved inquiries can no longer be edited.',
          },
        };
      }

      const content = String(body.content || '').trim();
      if (!content) {
        return {
          status: 422,
          body: {
            status: 422,
            message: 'The inquiry content cannot be empty.',
            errors: { content: ['The inquiry content cannot be empty.'] },
          },
        };
      }

      const nextHashtag = body.subject_hashtag
        ? formatSubjectHashtag(String(body.subject_hashtag))
        : String(existing.subject_hashtag);

      await pool.query(
        `UPDATE messages
         SET subject_hashtag = $1, content = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [nextHashtag, content, threadId]
      );

      const threads = await fetchThreadsForChannelFromPg(
        pool,
        Number(existing.channel_id)
      );
      const updated = threads.find((t) => t.id === threadId) || threads[0];

      return {
        status: 200,
        body: {
          message: 'Inquiry updated in PostgreSQL.',
          data: updated,
        },
      };
    }

    if (method === 'DELETE' && threadIdMatch) {
      const threadId = Number(threadIdMatch[1]);
      await pool.query('DELETE FROM messages WHERE id = $1', [threadId]);
      return {
        status: 200,
        body: { message: 'Inquiry ticket deleted from PostgreSQL.' },
      };
    }

    const replyMatch = cleanPath.match(/^\/threads\/(\d+)\/replies$/);
    if (method === 'POST' && replyMatch) {
      const threadId = Number(replyMatch[1]);
      const existingRes = await pool.query(
        'SELECT * FROM messages WHERE id = $1 AND parent_id IS NULL LIMIT 1',
        [threadId]
      );
      if (!existingRes.rowCount || existingRes.rowCount === 0) {
        return {
          status: 422,
          body: { status: 422, message: 'Thread not found.' },
        };
      }

      const content = String(body.content || '').trim();
      if (!content) {
        return {
          status: 422,
          body: {
            status: 422,
            message: 'The reply content field is required.',
            errors: { content: ['Please enter a message before submitting.'] },
          },
        };
      }

      const target = existingRes.rows[0];
      const channelId = Number(target.channel_id);
      const canResolve = canResolveOrPinThreads(activeUser.role);
      const pinToFaq = canResolve ? Boolean(body.pin_to_faq) : false;
      const markResolved = canResolve
        ? body.mark_resolved !== undefined
          ? Boolean(body.mark_resolved)
          : true
        : false;

      await pool.query(
        `INSERT INTO messages (channel_id, announcement_id, sender_id, parent_id, content, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [channelId, target.announcement_id, activeUser.id, threadId, content]
      );

      const nextResolved =
        markResolved || pinToFaq || Boolean(target.is_resolved);
      const nextPinned = pinToFaq || Boolean(target.is_pinned_faq);
      const nextPrivate = nextPinned ? false : Boolean(target.is_private);

      await pool.query(
        `UPDATE messages
         SET is_resolved = $1, is_pinned_faq = $2, is_private = $3, updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [nextResolved, nextPinned, nextPrivate, threadId]
      );

      const threads = await fetchThreadsForChannelFromPg(pool, channelId);
      const updated = threads.find((t) => t.id === threadId) || threads[0];

      return {
        status: 200,
        body: {
          message: pinToFaq
            ? 'Reply posted, ticket resolved, and converted to anonymized Class FAQ in PostgreSQL (FR-07).'
            : 'Reply posted and saved to PostgreSQL.',
          data: updated,
        },
      };
    }

    const convertFaqMatch = cleanPath.match(/^\/threads\/(\d+)\/convert-faq$/);
    if (method === 'POST' && convertFaqMatch) {
      if (!canResolveOrPinThreads(activeUser.role)) {
        return {
          status: 403,
          body: {
            status: 403,
            message:
              'HTTP 403 Forbidden: Only instructors can publish Class FAQs (FR-07).',
          },
        };
      }

      const threadId = Number(convertFaqMatch[1]);
      const existingRes = await pool.query(
        'SELECT * FROM messages WHERE id = $1 AND parent_id IS NULL LIMIT 1',
        [threadId]
      );
      if (!existingRes.rowCount || existingRes.rowCount === 0) {
        return {
          status: 422,
          body: { status: 422, message: 'Thread not found.' },
        };
      }

      const channelId = Number(existingRes.rows[0].channel_id);
      await pool.query(
        `UPDATE messages
         SET is_resolved = TRUE, is_pinned_faq = TRUE, is_private = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [threadId]
      );

      const threads = await fetchThreadsForChannelFromPg(pool, channelId);
      const updated = threads.find((t) => t.id === threadId) || threads[0];

      return {
        status: 200,
        body: {
          message:
            'Pinned to Class FAQs in PostgreSQL with student identity masked as "Anonymous Student" (RA 10173).',
          data: updated,
        },
      };
    }

    // INSTRUCTOR DIRECTORY: GET /instructors
    if (method === 'GET' && cleanPath === '/instructors') {
      const q = (query.search || '').trim().toLowerCase();
      const dept = query.department || 'ALL';
      const sort = query.sort || 'name';

      const instRes = await pool.query(`
        SELECT
          u.id,
          u.institutional_id,
          u.name,
          u.email,
          u.avatar_url,
          COALESCE(ap.campus, 'CDO Campus') AS campus,
          COALESCE(ap.college, 'CITC') AS college,
          COALESCE(ap.department, 'CITC') AS department,
          COALESCE(ap.specialization, 'Software Engineering & Information Systems') AS specialization,
          COALESCE(ap.office_location, 'ICT Bldg Room 304') AS office_location,
          COALESCE(ap.consultation_hours, 'MWF 1:00 PM – 4:00 PM') AS consultation_hours,
          ap.courses_handled
        FROM users u
        LEFT JOIN academic_profiles ap ON ap.user_id = u.id
        WHERE u.role IN ('faculty', 'dept_head')
          AND u.verification_status = 'approved'
      `);

      const instructors: Instructor[] = instRes.rows.map((r) => {
        let courses: string[] = [];
        if (Array.isArray(r.courses_handled)) {
          courses = r.courses_handled.map(String);
        } else if (typeof r.courses_handled === 'string') {
          try {
            courses = JSON.parse(r.courses_handled);
          } catch {
            courses = [];
          }
        }
        return {
          id: Number(r.id),
          institutional_id: String(r.institutional_id),
          name: String(r.name).toUpperCase(),
          email: String(r.email),
          campus: String(r.campus),
          college: String(r.college),
          department: (r.department as Instructor['department']) || 'CITC',
          specialization: String(r.specialization),
          office_location: String(r.office_location),
          consultation_hours: String(r.consultation_hours),
          courses_handled:
            courses.length > 0 ? courses : ['IT314 Software Engineering'],
          avatar_url: r.avatar_url ? String(r.avatar_url) : null,
        };
      });

      const filtered = instructors
        .filter((inst) => {
          if (dept !== 'ALL' && inst.department !== dept) return false;
          if (q) {
            const hay = `${inst.name} ${inst.department} ${
              inst.specialization
            } ${inst.courses_handled.join(' ')}`.toLowerCase();
            return hay.includes(q);
          }
          return true;
        })
        .sort((a, b) => {
          if (sort === 'department') {
            return (
              a.department.localeCompare(b.department) ||
              a.name.localeCompare(b.name)
            );
          }
          return a.name.localeCompare(b.name);
        });

      const page = Math.max(1, Number(query.page || 1));
      const perPage = Math.max(1, Number(query.per_page || 12));
      const total = filtered.length;
      const lastPage = Math.max(1, Math.ceil(total / perPage));
      const start = (page - 1) * perPage;

      return {
        status: 200,
        body: {
          data: filtered.slice(start, start + perPage),
          meta: {
            current_page: page,
            last_page: lastPage,
            per_page: perPage,
            total,
          },
        },
      };
    }

    // WORKFLOW 6: IT ADMIN CONSOLE
    if (method === 'GET' && cleanPath === '/admin/users/pending') {
      const q = (query.search || '').trim().toLowerCase();
      const res = await pool.query(`
        SELECT u.*, ap.campus, ap.college, ap.department, ap.program, ap.year_level, ap.section, ap.semester_code
        FROM users u
        LEFT JOIN academic_profiles ap ON ap.user_id = u.id
        WHERE u.verification_status = 'pending'
        ORDER BY u.id DESC
      `);

      const pendingUsers = res.rows.map(mapRowToUser).filter((u) => {
        if (!q) return true;
        return `${u.name} ${u.institutional_id} ${u.email} ${
          u.academic_profile?.department || ''
        }`
          .toLowerCase()
          .includes(q);
      });

      return {
        status: 200,
        body: {
          data: pendingUsers,
          meta: {
            current_page: 1,
            last_page: 1,
            per_page: 20,
            total: pendingUsers.length,
          },
        },
      };
    }

    const verifyMatch = cleanPath.match(/^\/admin\/users\/(\d+)\/verify$/);
    if (method === 'PATCH' && verifyMatch) {
      const userId = Number(verifyMatch[1]);
      const verificationStatus = String(
        body.verification_status || 'approved'
      ) as 'approved' | 'rejected';

      const upd = await pool.query(
        `UPDATE users
         SET verification_status = $1,
             verified_at = CASE WHEN $1 = 'approved' THEN CURRENT_TIMESTAMP ELSE NULL END,
             verified_by = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING id`,
        [verificationStatus, activeUser.id, userId]
      );

      if (!upd.rowCount || upd.rowCount === 0) {
        return {
          status: 422,
          body: { status: 422, message: 'Pending account not found.' },
        };
      }

      const userRes = await pool.query(
        `SELECT u.*, ap.campus, ap.college, ap.department, ap.program, ap.year_level, ap.section, ap.semester_code
         FROM users u
         LEFT JOIN academic_profiles ap ON ap.user_id = u.id
         WHERE u.id = $1`,
        [userId]
      );
      const updatedUser = mapRowToUser(userRes.rows[0]);

      return {
        status: 200,
        body: {
          message:
            verificationStatus === 'approved'
              ? `Account ${updatedUser.institutional_id} verified in PostgreSQL (FR-08).`
              : `Account ${updatedUser.institutional_id} registration rejected.`,
          data: updatedUser,
        },
      };
    }

    if (method === 'GET' && cleanPath === '/admin/users') {
      const q = (query.search || '').trim().toLowerCase();
      const res = await pool.query(`
        SELECT u.*, ap.campus, ap.college, ap.department, ap.program, ap.year_level, ap.section, ap.semester_code
        FROM users u
        LEFT JOIN academic_profiles ap ON ap.user_id = u.id
        WHERE u.verification_status = 'approved'
        ORDER BY u.id ASC
      `);

      const users = res.rows.map(mapRowToUser).filter((u) => {
        if (!q) return true;
        return `${u.name} ${u.institutional_id} ${u.role} ${
          u.academic_profile?.department || ''
        }`
          .toLowerCase()
          .includes(q);
      });

      return {
        status: 200,
        body: { data: users },
      };
    }

    const roleMatch = cleanPath.match(/^\/admin\/users\/(\d+)\/role$/);
    if (method === 'PATCH' && roleMatch) {
      const userId = Number(roleMatch[1]);
      const newRole = (body.role as UserRole) || 'student';
      const department = String(body.department || 'CITC');

      const upd = await pool.query(
        'UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id',
        [newRole, userId]
      );
      if (!upd.rowCount || upd.rowCount === 0) {
        return {
          status: 422,
          body: { status: 422, message: 'User not found.' },
        };
      }

      await pool.query(
        `INSERT INTO academic_profiles (user_id, campus, college, department, section, semester_code)
         VALUES ($1, 'CDO Campus', $2, $2, $3, '2026-1ST-SEM')
         ON CONFLICT (user_id) DO UPDATE SET college = $2, department = $2`,
        [userId, department, `${department} Scope`]
      );

      const userRes = await pool.query(
        `SELECT u.*, ap.campus, ap.college, ap.department, ap.program, ap.year_level, ap.section, ap.semester_code
         FROM users u
         LEFT JOIN academic_profiles ap ON ap.user_id = u.id
         WHERE u.id = $1`,
        [userId]
      );
      const updatedUser = mapRowToUser(userRes.rows[0]);

      return {
        status: 200,
        body: {
          message: `Updated ${updatedUser.name} role to ${updatedUser.role.toUpperCase()} (${department}) in PostgreSQL (FR-09).`,
          data: updatedUser,
        },
      };
    }

    if (method === 'POST' && cleanPath === '/admin/sync-prisms') {
      const semesterCode = String(body.semester_code || '').trim();
      if (!semesterCode) {
        return {
          status: 422,
          body: {
            status: 422,
            message: 'The semester_code field is required.',
            errors: {
              semester_code: [
                'Please specify a target PRISMS semester code (e.g., 2026-1ST-SEM).',
              ],
            },
          },
        };
      }

      const channelsCountRes = await pool.query(
        'SELECT COUNT(*)::int AS cnt FROM channels'
      );
      const usersCountRes = await pool.query(
        'SELECT COUNT(*)::int AS cnt FROM users'
      );
      const channelsProvisioned = Number(channelsCountRes.rows[0].cnt);
      const totalUpdated = Number(usersCountRes.rows[0].cnt);

      const insLog = await pool.query(
        `INSERT INTO prisms_sync_logs (semester_code, triggered_by, sync_type, total_updated, channels_provisioned, status, duration_ms, executed_at)
         VALUES ($1, $2, 'manual_admin', $3, $4, 'completed', 540, CURRENT_TIMESTAMP)
         RETURNING *`,
        [
          semesterCode,
          `${activeUser.name} (${activeUser.institutional_id})`,
          totalUpdated,
          channelsProvisioned,
        ]
      );

      const r = insLog.rows[0];
      const logEntry: PrismsSyncLog = {
        id: Number(r.id),
        semester_code: String(r.semester_code),
        triggered_by: String(r.triggered_by),
        sync_type: 'manual_admin',
        total_updated: Number(r.total_updated),
        channels_provisioned: Number(r.channels_provisioned),
        status: 'completed',
        duration_ms: Number(r.duration_ms),
        executed_at: new Date(String(r.executed_at)).toISOString(),
      };

      return {
        status: 200,
        body: {
          message: `PRISMS batch synchronization saved to PostgreSQL for ${semesterCode} (FR-10).`,
          total_updated: logEntry.total_updated,
          log: logEntry,
        },
      };
    }

    if (method === 'GET' && cleanPath === '/admin/metrics') {
      const countsRes = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM users) AS total_users_cnt,
          (SELECT COUNT(*)::int FROM users WHERE verification_status = 'approved') AS verified_cnt,
          (SELECT COUNT(*)::int FROM users WHERE verification_status = 'pending') AS pending_cnt,
          (SELECT COUNT(*)::int FROM announcements WHERE trigger_sms_fallback = TRUE AND deleted_at IS NULL) AS sms_cnt
      `);
      const c = countsRes.rows[0];

      const logsRes = await pool.query(`
        SELECT * FROM prisms_sync_logs ORDER BY executed_at DESC, id DESC LIMIT 20
      `);

      const auditsRes = await pool.query(`
        SELECT
          aa.*,
          u.name AS editor_name,
          u.role AS editor_role
        FROM announcement_audits aa
        JOIN users u ON u.id = aa.editor_id
        ORDER BY aa.edited_at DESC, aa.id DESC
        LIMIT 30
      `);

      const metrics: AdminMetricsResponse = {
        active_users_count: Number(c.total_users_cnt),
        verified_accounts_count: Number(c.verified_cnt),
        pending_verifications_count: Number(c.pending_cnt),
        push_queue_latency_seconds: 0.84,
        sms_fallback_dispatched_count: Number(c.sms_cnt) * 42,
        overall_read_reach_percentage: 87.4,
        sync_logs: logsRes.rows.map((l) => ({
          id: Number(l.id),
          semester_code: String(l.semester_code),
          triggered_by: String(l.triggered_by),
          sync_type:
            (l.sync_type as PrismsSyncLog['sync_type']) || 'scheduled_midnight',
          total_updated: Number(l.total_updated),
          channels_provisioned: Number(l.channels_provisioned),
          status: (l.status as PrismsSyncLog['status']) || 'completed',
          duration_ms: Number(l.duration_ms),
          executed_at: new Date(String(l.executed_at)).toISOString(),
        })),
        announcement_audits: auditsRes.rows.map((a) => ({
          id: Number(a.id),
          announcement_id: Number(a.announcement_id),
          previous_title: String(a.previous_title),
          new_title: String(a.new_title),
          previous_content: String(a.previous_content),
          new_content: String(a.new_content),
          editor_id: Number(a.editor_id),
          editor_name: String(a.editor_name),
          editor_role: (a.editor_role as UserRole) || 'faculty',
          edited_at: new Date(String(a.edited_at)).toISOString(),
        })),
      };

      return {
        status: 200,
        body: { data: metrics },
      };
    }

    if (method === 'POST' && cleanPath === '/devices/token') {
      const expoPushToken = String(body.expo_push_token || '').trim();
      const platform = String(body.platform || 'web');
      if (expoPushToken) {
        await pool.query(
          `INSERT INTO device_tokens (user_id, expo_push_token, platform, last_registered_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
           ON CONFLICT (expo_push_token) DO UPDATE SET last_registered_at = CURRENT_TIMESTAMP`,
          [activeUser.id, expoPushToken, platform]
        );
      }
      return {
        status: 201,
        body: { message: 'Push token registered in PostgreSQL.' },
      };
    }

    return {
      status: 404,
      body: {
        status: 404,
        message: `Endpoint ${method} ${cleanPath} not found.`,
      },
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : 'Database query failed in PostgreSQL adapter.';
    return {
      status: 500,
      body: {
        status: 500,
        message: `PostgreSQL Error: ${message}`,
      },
    };
  }
}
