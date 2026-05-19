import { env } from '@/lib/env';
import { consolidateMindLearnings } from '@/lib/learning';
import { getSupabaseAdmin } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/telegram';
import { synthesizeEssay } from '@/lib/synthesis';

type PrefRow = {
  workspace_id: string;
  user_id: string;
  last_sent_at: string | null;
};

const SIX_DAYS_MS = 1000 * 60 * 60 * 24 * 6;

/**
 * GET /api/cron/digest
 *
 * Weekly digest job. For each Mind with at least one opted-in member whose
 * last send is older than ~6 days, synthesize an essay and Telegram it to
 * those members.
 *
 * Triple-gated so it can never fire by accident:
 *   1. MUTTMIND_DIGEST_ENABLED=1
 *   2. MUTTMIND_SYNTHESIS_ENABLED=1 (the digest IS a synthesis run)
 *   3. Authorization: Bearer ${CRON_SECRET} (Vercel Cron sends this)
 *
 * Members are opt-OUT by default — nobody is messaged unless they turned it
 * on for that Mind in settings.
 */
export async function GET(req: Request) {
  if (!env.digestEnabled || !env.synthesisEnabled) {
    return Response.json(
      {
        skipped: true,
        reason: 'Digest dormant. Needs MUTTMIND_DIGEST_ENABLED=1 and MUTTMIND_SYNTHESIS_ENABLED=1.',
      },
      { status: 200 },
    );
  }

  const auth = req.headers.get('authorization') ?? '';
  if (!env.cronSecret || auth !== `Bearer ${env.cronSecret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  // Opted-in prefs that are due (never sent, or sent > 6 days ago).
  const { data: prefsData, error: prefsError } = await admin
    .from('workspace_digest_prefs')
    .select('workspace_id,user_id,last_sent_at')
    .eq('opt_in', true);
  if (prefsError) return Response.json({ error: prefsError.message }, { status: 500 });

  const prefs = (prefsData ?? []) as PrefRow[];
  const now = Date.now();
  const due = prefs.filter(
    (p) => !p.last_sent_at || now - new Date(p.last_sent_at).getTime() > SIX_DAYS_MS,
  );

  // Group due members by workspace so we synthesize once per Mind.
  const byWorkspace = new Map<string, string[]>();
  for (const p of due) {
    const list = byWorkspace.get(p.workspace_id) ?? [];
    list.push(p.user_id);
    byWorkspace.set(p.workspace_id, list);
  }

  const report: Array<{ workspaceId: string; status: string; recipients: number }> = [];

  for (const [workspaceId, userIds] of byWorkspace.entries()) {
    const result = await synthesizeEssay({ workspaceId, generatedBy: null });
    if (!result.ok) {
      report.push({ workspaceId, status: `skipped: ${result.error}`, recipients: 0 });
      continue;
    }

    const essay = result.essay;
    const { data: workspace } = await admin
      .from('workspaces')
      .select('name')
      .eq('id', workspaceId)
      .single();
    const mindName = (workspace as { name?: string } | null)?.name ?? 'your Mind';

    // Resolve Telegram chat IDs for the due members.
    const { data: usersData } = await admin
      .from('users')
      .select('id,telegram_user_id')
      .in('id', userIds);
    const recipients = (usersData ?? []).filter(
      (u): u is { id: string; telegram_user_id: number } =>
        typeof (u as { telegram_user_id?: number }).telegram_user_id === 'number',
    );

    const preview = essay.body_md.replace(/\s+/g, ' ').slice(0, 360).trim();
    const message = [
      `🧠 ${mindName} — this week's synthesis`,
      '',
      essay.title ? essay.title : '',
      '',
      preview + (essay.body_md.length > 360 ? '…' : ''),
      '',
      'Open MuttMind to read the full essay.',
    ]
      .filter((line) => line !== undefined)
      .join('\n');

    let sent = 0;
    for (const r of recipients) {
      await sendTelegramMessage(r.telegram_user_id, message);
      sent += 1;
    }

    // Mark every due member for this workspace as sent (even those without
    // Telegram — they opted in; absence of a chat id is their setup gap).
    const sentAt = new Date().toISOString();
    await admin
      .from('workspace_digest_prefs')
      .update({ last_sent_at: sentAt })
      .eq('workspace_id', workspaceId)
      .in('user_id', userIds);

    report.push({ workspaceId, status: 'sent', recipients: sent });
  }

  // Weekly learning consolidation — independent of digest opt-in; runs for
  // every Mind that turned on Reflection & learning. Each call is a no-op
  // (cheap count query) unless learnings have actually accumulated.
  const consolidation: Array<{ workspaceId: string; status: string; kept?: number }> = [];
  const { data: learnMinds } = await admin
    .from('workspaces')
    .select('id')
    .eq('learning_enabled', true);
  for (const w of (learnMinds ?? []) as { id: string }[]) {
    try {
      const r = await consolidateMindLearnings(w.id);
      consolidation.push({ workspaceId: w.id, ...r });
    } catch (e) {
      consolidation.push({
        workspaceId: w.id,
        status: `error: ${e instanceof Error ? e.message : 'unknown'}`,
      });
    }
  }

  return Response.json({
    ran: true,
    minds: report.length,
    report,
    consolidation,
  });
}
