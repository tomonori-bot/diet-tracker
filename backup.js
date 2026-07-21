/* backup.js — Supabase上の本番データをJSONに書き出す（日次バックアップ用）
   実行: SUPABASE_URL / SUPABASE_KEY を設定して `node backup.js`
   出力: backup-output/backup-<日時>.json

   sessions（ログイントークン）はバックアップ先の別リポジトリが万一漏れた際に
   即アカウント乗っ取りに使われてしまうため、意図的に除外する。
*/

const fs = require('fs');
const path = require('path');
const { loadDB } = require('./db.js');

async function main() {
  const db = await loadDB();
  const { sessions, ...safe } = db;

  const outDir = path.join(__dirname, 'backup-output');
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `backup-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(safe, null, 2));

  console.log(`[backup] 書き出し完了: ${outFile}`);
  console.log(`[backup] patients=${safe.patients?.length ?? 0} users=${safe.users?.length ?? 0}`);
}

main().catch(err => {
  console.error('[backup] 失敗:', err);
  process.exit(1);
});
