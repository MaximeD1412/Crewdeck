// The check of .github/workflows/backup-watch.yml (INFRA-8): production's
// /api/health, as curl wrote it, must report a backup that succeeded less than
// 26 h ago. A failed run is what alerts the founder (GitHub emails a red
// scheduled workflow): there is no alert channel on the VPS.
//
//   node .github/scripts/backup-watch.mjs <health.json>
import { readFileSync } from 'node:fs';

const MAX_AGE_HOURS = 26;
const HOUR = 3_600_000;

/** `{ ok, message }` for the body of /api/health at `now`. */
function check(body, now) {
  let health;
  try {
    health = JSON.parse(body);
  } catch {
    return { ok: false, message: `réponse de /api/health illisible : ${body.slice(0, 200)}` };
  }
  if (health === null || typeof health !== 'object' || health.status !== 'ok') {
    return { ok: false, message: `réponse de /api/health inattendue : ${body.slice(0, 200)}` };
  }
  if (!('backup' in health)) {
    return {
      ok: false,
      message: "la production ne donne pas l'état de sa sauvegarde : BACKUP_STATUS_FILE absent de /opt/crewdeck/prod/.env ?",
    };
  }
  const last = health.backup?.lastSuccessAt;
  if (last === null || last === undefined) {
    return { ok: false, message: "aucune sauvegarde réussie : voir journalctl -u crewdeck-backup.service sur le VPS" };
  }
  const at = Date.parse(last);
  if (Number.isNaN(at)) return { ok: false, message: `date de la dernière sauvegarde illisible : ${last}` };
  const hours = Math.floor((now - at) / HOUR);
  if (now - at > MAX_AGE_HOURS * HOUR) {
    return {
      ok: false,
      message: `dernière sauvegarde réussie le ${last}, il y a ${hours} h (plus de ${MAX_AGE_HOURS} h) : voir journalctl -u crewdeck-backup.service sur le VPS`,
    };
  }
  return { ok: true, message: `dernière sauvegarde réussie le ${last}, il y a ${hours} h` };
}

const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage : node .github/scripts/backup-watch.mjs <health.json>');
  process.exit(2);
}
const result = check(readFileSync(file, 'utf8'), Date.now());
if (result.ok) {
  console.log(result.message);
} else {
  console.log(`::error title=Sauvegarde de la production::${result.message}`);
  process.exitCode = 1;
}
