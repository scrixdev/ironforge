// ═══════════════════════════════════════════════════════
//  IRONFORGE — GitHub Actions Push Sender
//  Ce script tourne toutes les 15min sur GitHub
//  et envoie les notifs push aux abonnés
// ═══════════════════════════════════════════════════════

const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

// Config VAPID depuis les secrets GitHub
webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Fichier qui contient les abonnements + rappels programmés
const SUBS_FILE = path.join(__dirname, '../../ironforge-subscriptions.json');

function getNotifTitle() { return "⚡ C'est l'heure de ta séance !"; }
function getNotifBody(dayName, loc) { return dayName + (loc ? ' ' + loc : ''); }

function loadData() {
  try {
    if (fs.existsSync(SUBS_FILE)) {
      return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
    }
  } catch(e) {
    console.log('Pas de données encore:', e.message);
  }
  return { subscriptions: [], reminders: [] };
}

async function sendPush(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    console.log('✅ Push envoyé:', payload.title);
    return true;
  } catch(err) {
    console.log('❌ Erreur push:', err.message);
    if (err.statusCode === 410) return 'expired';
    return false;
  }
}

async function main() {
  const data = loadData();
  if (!data.subscriptions.length) {
    console.log('Aucun abonné pour l\'instant.');
    return;
  }

  const now = new Date();
  const nowMs = now.getTime();
  const windowMs = 15 * 60 * 1000;

  console.log(`⏰ ${now.toISOString()} — Vérification des rappels...`);
  console.log(`👥 ${data.subscriptions.length} abonné(s)`);

  const expiredIds = [];

  for (const sub of data.subscriptions) {
    const { subscription, reminders = [], schedules = [] } = sub;

    // ── Rappels quotidiens ─────────────────────────────
    for (const reminder of reminders) {
      const [h, m] = reminder.time.split(':').map(Number);

      const dowJs = now.getDay();
      const dowIron = dowJs === 0 ? 6 : dowJs - 1;
      if (!reminder.days.includes(dowIron)) continue;

      // Heure exacte de la séance
      const sessionToday = new Date(now);
      sessionToday.setHours(h, m, 0, 0);
      const notifTime = sessionToday.getTime();

      if (notifTime >= nowMs && notifTime < nowMs + windowMs) {
        const title = getNotifTitle();
        const body  = getNotifBody(reminder.progName, '');

        const result = await sendPush(subscription, {
          title, body,
          icon: '/ironforge/icon-192.png',
          badge: '/ironforge/icon-192.png',
          tag: 'daily-' + reminder.id,
          data: { url: '/ironforge/' }
        });
        if (result === 'expired') expiredIds.push(sub.id);
      }
    }

    // ── Séances planifiées uniques ──────────────────────
    for (const schedule of schedules) {
      if (schedule.notified) continue;
      // Heure exacte de la séance, sans décalage
      const notifTime = schedule.datetime;

      if (notifTime >= nowMs && notifTime < nowMs + windowMs) {
        const dayName = schedule.dayLabel?.split('—')[0]?.trim() || schedule.progName;
        const loc     = schedule.location ? ` ${schedule.location}` : '';
        const title   = getNotifTitle();
        const body    = getNotifBody(dayName, loc);

        const result = await sendPush(subscription, {
          title, body,
          icon: '/ironforge/icon-192.png',
          badge: '/ironforge/icon-192.png',
          tag: 'schedule-' + schedule.id,
          data: { url: '/ironforge/' }
        });
        if (result === 'expired') expiredIds.push(sub.id);
        else schedule.notified = true;
      }
    }
  }

  if (expiredIds.length) {
    data.subscriptions = data.subscriptions.filter(s => !expiredIds.includes(s.id));
    console.log(`🗑 ${expiredIds.length} abonnement(s) expiré(s) supprimé(s)`);
  }

  fs.writeFileSync(SUBS_FILE, JSON.stringify(data, null, 2));
  console.log('✅ Terminé.');
}

main().catch(console.error);
