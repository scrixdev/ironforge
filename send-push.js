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
    // Abonnement expiré → on le supprime
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
  // Fenêtre : notifs prévues dans les 15 prochaines minutes
  const windowMs = 15 * 60 * 1000;

  console.log(`⏰ ${now.toISOString()} — Vérification des rappels...`);
  console.log(`👥 ${data.subscriptions.length} abonné(s)`);

  const expiredIds = [];

  for (const sub of data.subscriptions) {
    const { subscription, reminders = [], schedules = [] } = sub;

    // ── Rappels quotidiens ─────────────────────────────
    for (const reminder of reminders) {
      const [h, m] = reminder.time.split(':').map(Number);
      const reminderMs = (reminder.reminderMin ?? 0) * 60 * 1000;

      // Vérifier si aujourd'hui est un jour actif
      const dowJs = now.getDay(); // 0=Sun
      const dowIron = dowJs === 0 ? 6 : dowJs - 1; // Mon=0
      if (!reminder.days.includes(dowIron)) continue;

      // Calculer l'heure de la séance aujourd'hui
      const sessionToday = new Date(now);
      sessionToday.setHours(h, m, 0, 0);
      const notifTime = sessionToday.getTime() - reminderMs;

      // Est-ce dans la fenêtre des 15min ?
      if (notifTime >= nowMs && notifTime < nowMs + windowMs) {
        // FIX : quand reminderMin === 0, affiche "C'est l'heure !" au lieu de "dans 0 min"
        const title = reminder.reminderMin === 0
          ? `⚡ C'est l'heure de la séance !`
          : `⚡ Séance dans ${reminder.reminderMin} min !`;

        const result = await sendPush(subscription, {
          title,
          body: `${reminder.progName} — Il est l'heure de s'échauffer ! 💪`,
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
      const reminderMs = (schedule.reminder ?? 0) * 60 * 1000;
      const notifTime = schedule.datetime - reminderMs;

      if (notifTime >= nowMs && notifTime < nowMs + windowMs) {
        // FIX : même correction pour les séances ponctuelles
        const title = schedule.reminder === 0
          ? `⚡ C'est l'heure de la séance !`
          : `⏰ Séance dans ${schedule.reminder} min !`;

        const result = await sendPush(subscription, {
          title,
          body: `${schedule.progName} — ${schedule.dayLabel?.split('—')[0]?.trim() || ''}${schedule.location ? ' · ' + schedule.location : ''} 🏋️`,
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

  // Nettoyer les abonnements expirés
  if (expiredIds.length) {
    data.subscriptions = data.subscriptions.filter(s => !expiredIds.includes(s.id));
    console.log(`🗑 ${expiredIds.length} abonnement(s) expiré(s) supprimé(s)`);
  }

  // Sauvegarder les mises à jour (schedules notifiés)
  fs.writeFileSync(SUBS_FILE, JSON.stringify(data, null, 2));
  console.log('✅ Terminé.');
}

main().catch(console.error);
