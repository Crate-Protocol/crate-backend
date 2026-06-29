import { pool } from "./client.js";

const MAX_DAILY_UPLOADS = parseInt(process.env.MAX_DAILY_UPLOADS ?? "10", 10);

export async function checkAndIncrementQuota(accountId: string): Promise<boolean> {
  const result = await pool.query(`
    INSERT INTO upload_quotas (account_id, uploads_today, last_upload_date)
    VALUES ($1, 1, CURRENT_DATE)
    ON CONFLICT (account_id) DO UPDATE SET
      uploads_today = CASE 
        WHEN upload_quotas.last_upload_date = CURRENT_DATE THEN upload_quotas.uploads_today + 1
        ELSE 1
      END,
      last_upload_date = CURRENT_DATE
    RETURNING uploads_today;
  `, [accountId]);

  const uploadsToday = result.rows[0].uploads_today;
  return uploadsToday <= MAX_DAILY_UPLOADS;
}
