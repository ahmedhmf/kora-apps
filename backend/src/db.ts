import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'surveydb',
  user: process.env.DB_USER || 'surveyuser',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const initDatabase = async (): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS survey_templates (
        id          VARCHAR(255)  PRIMARY KEY,
        name        VARCHAR(500)  NOT NULL,
        description TEXT          DEFAULT '',
        fields      JSONB         NOT NULL DEFAULT '[]',
        created_at  TIMESTAMPTZ   DEFAULT NOW(),
        updated_at  TIMESTAMPTZ   DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS survey_submissions (
        id                SERIAL        PRIMARY KEY,
        template_id       VARCHAR(255)  NOT NULL,
        respondent_name   VARCHAR(500),
        respondent_email  VARCHAR(500),
        is_anonymous      BOOLEAN       DEFAULT FALSE,
        client_identifier VARCHAR(500),
        answers           JSONB         NOT NULL DEFAULT '{}',
        uuid              VARCHAR(255)  UNIQUE,
        status            VARCHAR(100)  DEFAULT 'submitted',
        created_at        TIMESTAMPTZ   DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_submissions_template_id
        ON survey_submissions(template_id);

      CREATE INDEX IF NOT EXISTS idx_submissions_uuid
        ON survey_submissions(uuid);

      CREATE INDEX IF NOT EXISTS idx_submissions_created
        ON survey_submissions(created_at DESC);

      -- Self-healing database migrations: ensure new PII columns exist on live database
      ALTER TABLE survey_submissions ADD COLUMN IF NOT EXISTS respondent_name VARCHAR(500);
      ALTER TABLE survey_submissions ADD COLUMN IF NOT EXISTS respondent_email VARCHAR(500);
      ALTER TABLE survey_submissions ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE;
    `);
    console.log('[DB] Schema initialized successfully.');
  } finally {
    client.release();
  }
};
