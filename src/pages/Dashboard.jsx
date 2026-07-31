// ---------------------------------------------------------------------------
// Dashboard — the triage screen. A coach opens this and answers two questions:
// "what am I doing in the next hour" (the rotation strip) and "who do I see
// first this week" (the triage queue).
//
// This replaced four stat cards plus six "Priority N" cards. That layout made
// one teacher appear in up to four separate lists, so the coach reassembled a
// person mentally; the cards were numbered 1-3-4 down the left column and
// 2-6-5 down the right, so the eye read them out of order; and every list
// rendered every match with no cap, so the page grew without bound as the
// roster did. Here each teacher is one row and each signal is a column,
// sortable and filterable, capped until expanded.
//
// Read-only, and every value comes from the rollups that lib/intelligence.js
// already derives -- no new fetches, no new state beyond sort/filter/expand.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { isOverdue, assessmentTrend, SEEN_WINDOW_DAYS } from '../lib/intelligence.js';
import { groupSchedule, thisWeek } from '../lib/rotation.js';
import { formatDate, daysUntil, parse } from '../lib/dates.js';
import { Icon } from '../components/icons.jsx';
import { Card, Empty, InfoTip, RISK_SCORE_TOOLTIP, PACING_STATUS_TOOLTIP } from '../components/ui.jsx';

const BAND = { green: 'green', yellow: 'amber', red: 'red' };

// How long since an observation before the number turns amber, then red. The
// red threshold is the compliance window itself.
const SEEN_WATCH_DAYS = 10;

const FILTERS = [
  { key: 'all', label: 'All flags' },
  { key: 'pace', label: 'Behind pace' },
  { key: 'unseen', label: 'Unseen' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'actions', label: 'Actions' },
];

const ROW_CAP = 8;

function initials(name) {
  return (name || '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function latestCompleted(rollup) {
  return (rollup.assessments || []).find((a) => a.avgScore != null) || null;
}

// A teacher is "flagged" if any signal is off. Mirrors the "All flags" chip,
// and is what the row cap and the footer count are measured against.
function isFlagged(r) {
  return (
    r.pacingStatus !== 'green' ||
    r.daysSinceObservation == null ||
    r.daysSinceObservation > SEEN_WATCH_DAYS ||
    r.assessmentConcern ||
    r.outstandingActions.length > 0
  );
}

function matchesFilter(r, filter) {
  switch (filter) {
    case 'pace':
      return r.pacingStatus !== 'green';
    case 'unseen':
      return r.daysSinceObservation == null || r.daysSinceObservation > SEEN_WATCH_DAYS;
    case 'assessment':
      return !!r.assessmentConcern;
    case 'actions':
      return r.outstandingActions.length > 0;
    default:
      return isFlagged(r);
  }
}

// ---- cell content -------------------------------------------------------

function pacingCell(r) {
  if (r.multiSubject && r.pacingBySubject.length) {
    // Worst subject leads, named, so a 6-day slip in Math isn't hidden behind
    // an on-pace ELA.
    const worst = r.pacingBySubject.reduce((a, b) => (b.daysBehind > a.daysBehind ? b : a));
    if (worst.daysBehind > 0) return { tone: BAND[worst.status], text: `${worst.subject || '—'} ${worst.daysBehind}d` };
    return { tone: 'green', text: 'On pace' };
  }
  if (r.daysBehind > 0) return { tone: BAND[r.pacingStatus], text: `${r.daysBehind}d behind` };
  return { tone: 'green', text: 'On pace' };
}

function seenCell(r) {
  const d = r.daysSinceObservation;
  if (d == null) return { tone: 'var(--red-text)', text: 'Never' };
  if (d > SEEN_WINDOW_DAYS) return { tone: 'var(--red-text)', text: `${d}d` };
  if (d > SEEN_WATCH_DAYS) return { tone: 'var(--amber-text)', text: `${d}d` };
  return { tone: 'var(--green-text)', text: `${d}d` };
}

function assessmentCell(r) {
  const test = latestCompleted(r);
  if (!test) return { tone: 'var(--text-muted)', text: '— no test' };
  const trend = assessmentTrend(r.assessments || []);
  const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '—';
  const tone = r.assessmentConcern
    ? trend === 'down'
      ? 'var(--red-text)'
      : 'var(--amber-text)'
    : 'var(--green-text)';
  return { tone, text: `${arrow} ${test.avgScore} avg` };
}

function actionsCell(r) {
  const overdue = r.overdueActions.length;
  if (overdue > 0) return { tone: 'var(--red-text)', text: `${overdue} overdue` };
  const open = r.outstandingActions.length;
  if (open > 0) return { tone: 'var(--amber-text)', text: `${open} open` };
  return { tone: 'var(--text-muted)', text: 'None' };
}

// ---- sorting ------------------------------------------------------------

// Ties break on days behind so equal-risk teachers still order meaningfully.
const SORTERS = {
  teacher: (r) => (r.teacher.name || '').toLowerCase(),
  pacing: (r) => r.daysBehind,
  // Never seen sorts as the most extreme case of not-seen, not as missing data.
  lastSeen: (r) => (r.daysSinceObservation == null ? Number.POSITIVE_INFINITY : r.daysSinceObservation),
  assessment: (r) => (latestCompleted(r) ? latestCompleted(r).avgScore : Number.POSITIVE_INFINITY),
  actions: (r) => r.overdueActions.length * 1000 + r.outstandingActions.length,
  risk: (r) => r.risk.score,
};

const DEFAULT_SORT_DIR = {
  teacher: 'asc',
  pacing: 'desc',
  lastSeen: 'desc',
  assessment: 'asc',
  actions: 'desc',
  risk: 'desc',
};

function QueueSort({ label, sortKey, sort, onSort, end, tip }) {
  const active = sort.key === sortKey;
  return (
    <span
      className={end ? 'queue__col--end' : undefined}
      style={end ? { justifySelf: 'end' } : undefined}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className={`queue__sort${end ? ' queue__sort--end' : ''}`} onClick={() => onSort(sortKey)}>
        {label}
        <span className={`queue__arrow${active ? ' is-active' : ''}`} aria-hidden="true">
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
      {tip && <InfoTip text={tip} />}
    </span>
  );
}

// ---- rotation strip ----------------------------------------------------

function RotationStrip() {
  const { scheduleEntries, teachers, observations } = useApp();
  const { days } = useMemo(
    () => groupSchedule(scheduleEntries, teachers, observations),
    [scheduleEntries, teachers, observations]
  );
  const week = useMemo(() => thisWeek(days), [days]);
  if (!days.length) return null;

  const t = week.today;
  return (
    <section className="rotstrip">
      <div className="rotstrip__lead">
        <div className="rotstrip__eyebrow">Today's rotation</div>
        <div className="rotstrip__count">
          {t ? `${t.doneCount} of ${t.entries.length} observed` : 'Nothing scheduled today'}
        </div>
      </div>
      <div className="rotstrip__chips">
        {t ? (
          t.entries.map((e) => (
            <Link className="rotchip" key={e.id} to={`/teachers/${e.teacher.id}`}>
              <span className={`rotchip__avatar chip--${e.done ? 'green' : 'amber'}`}>
                {e.done ? '✓' : initials(e.teacher.name)}
              </span>
              {e.teacher.name}
              {e.teacher.subject && <span className="rotchip__period">{e.teacher.subject}</span>}
            </Link>
          ))
        ) : (
          <span className="muted small">
            No classroom visits assigned for today.
            {week.upcoming.length > 0 && ` Next up: ${formatDate(week.upcoming[0].date)}.`}
          </span>
        )}
      </div>
      <Link className="rotstrip__link" to="/schedule">
        Full rotation <Icon name="arrow" />
      </Link>
    </section>
  );
}

// ---- main ---------------------------------------------------------------

export default function Dashboard() {
  const { rollups, teachers, assessments, interventions } = useApp();
  const navigate = useNavigate();

  const [sort, setSort] = useState({ key: 'risk', dir: 'desc' });
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(false);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DEFAULT_SORT_DIR[key] }));
  }

  const riskCounts = useMemo(() => {
    const c = { green: 0, yellow: 0, red: 0 };
    rollups.forEach((r) => {
      c[r.risk.band] = (c[r.risk.band] || 0) + 1;
    });
    return c;
  }, [rollups]);

  const flagged = useMemo(() => rollups.filter((r) => matchesFilter(r, filter)), [rollups, filter]);

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const key = SORTERS[sort.key] || SORTERS.risk;
    // Slice first: rollups comes from context and .sort() would mutate it.
    return flagged.slice().sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      let cmp = 0;
      if (typeof av === 'string') cmp = av.localeCompare(bv);
      else cmp = av === bv ? 0 : av < bv ? -1 : 1;
      if (cmp !== 0) return cmp * dir;
      return (b.daysBehind - a.daysBehind) || (a.teacher.name || '').localeCompare(b.teacher.name || '');
    });
  }, [flagged, sort]);

  const visible = expanded ? sorted : sorted.slice(0, ROW_CAP);
  const clearCount = rollups.length - rollups.filter(isFlagged).length;

  const glance = useMemo(() => {
    const behind = rollups.filter((r) => r.pacingStatus !== 'green');
    const red = rollups.filter((r) => r.risk.band === 'red');
    const seen = rollups.filter((r) => r.seenCompliant).length;
    const pct = rollups.length ? Math.round((seen / rollups.length) * 100) : 0;
    const overdueTotal = rollups.reduce((s, r) => s + r.overdueActions.length, 0);
    const overdueTeachers = rollups.filter((r) => r.overdueActions.length > 0).length;
    const open = interventions.filter((i) => i.status !== 'Complete');
    const awaiting = open.filter((i) => !(i.requirements || {}).leadershipReview).length;
    return [
      {
        value: behind.length,
        label: 'Behind pace',
        sub: `${red.length} of them at red risk`,
        tone: behind.length ? 'var(--red-text)' : 'var(--text-muted)',
        tip: PACING_STATUS_TOOLTIP,
      },
      {
        value: `${pct}%`,
        label: `Seen ≤ ${SEEN_WINDOW_DAYS} days`,
        sub: `${seen} of ${rollups.length} teachers`,
        tone: pct >= 80 ? 'var(--green-text)' : pct >= 50 ? 'var(--amber-text)' : 'var(--red-text)',
      },
      {
        value: overdueTotal,
        label: 'Overdue actions',
        sub: `across ${overdueTeachers} teacher${overdueTeachers === 1 ? '' : 's'}`,
        tone: overdueTotal ? 'var(--amber-text)' : 'var(--text-muted)',
      },
      {
        value: open.length,
        label: 'Open interventions',
        sub: `${awaiting} awaiting review`,
        tone: open.length ? 'var(--amber-text)' : 'var(--text-muted)',
      },
    ];
  }, [rollups, interventions]);

  // Upcoming unit tests and outstanding action due dates in one date-sorted
  // list, so "what lands soon" is answered in one place.
  const upcoming = useMemo(() => {
    const nameById = new Map(teachers.map((t) => [t.id, t.name]));
    const out = [];
    assessments.forEach((a) => {
      const d = daysUntil(a.date);
      if (a.avgScore === null && d != null && d >= 0 && d <= 14) {
        out.push({ id: `a-${a.id}`, date: a.date, days: d, title: a.name, sub: nameById.get(a.teacherId) || 'Unknown' });
      }
    });
    rollups.forEach((r) =>
      r.outstandingActions.forEach((ai) => {
        const d = daysUntil(ai.dueDate);
        if (ai.dueDate && d != null && d >= 0 && d <= 14) {
          out.push({
            id: `i-${r.teacher.id}-${ai.id}`,
            date: ai.dueDate,
            days: d,
            title: `${ai.source === 'Goal' ? 'Goal due' : 'Action item due'} — ${ai.description}`,
            sub: r.teacher.name,
          });
        }
      })
    );
    return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  }, [assessments, teachers, rollups]);

  const eyebrowDate = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase();

  return (
    <div className="dash">
      {/* Hero: date + title on the left, risk distribution and the report link
          on the right. The risk spread was a whole card that left the old right
          column ragged; as a 260px header block it reads at a glance. */}
      <div className="dash-hero">
        <div>
          <div className="eyebrow">{eyebrowDate}</div>
          <h1 className="display-title" style={{ marginTop: 6 }}>
            This week, see these teachers first
          </h1>
        </div>
        <div className="row" style={{ gap: 18, alignItems: 'flex-end' }}>
          <div className="riskbar">
            <div className="riskbar__head">
              <span>
                Risk across {rollups.length} teacher{rollups.length === 1 ? '' : 's'}
                <InfoTip text={RISK_SCORE_TOOLTIP} />
              </span>
              <span className="riskbar__count">{riskCounts.red} red</span>
            </div>
            <div className="riskbar__track">
              {/* A zero-count band renders no segment at all: flex:0 with a 2px
                  gap still leaves a visible sliver. */}
              {riskCounts.green > 0 && <span className="riskbar__seg--green" style={{ flex: riskCounts.green }} />}
              {riskCounts.yellow > 0 && <span className="riskbar__seg--amber" style={{ flex: riskCounts.yellow }} />}
              {riskCounts.red > 0 && <span className="riskbar__seg--red" style={{ flex: riskCounts.red }} />}
            </div>
            <div className="riskbar__legend">
              <span>{riskCounts.green} green</span>
              <span>{riskCounts.yellow} yellow</span>
              <span>{riskCounts.red} red</span>
            </div>
          </div>
          <button className="btn btn--primary" onClick={() => navigate('/report')}>
            <Icon name="sparkle" /> Intelligent view
          </button>
        </div>
      </div>

      <RotationStrip />

      <div className="dash-cols2">
        {/* ---- Triage queue ---- */}
        <section className="card queue">
          <div className="queue__head">
            <div className="queue__titles">
              <div className="queue__eyebrow">Priority queue</div>
              <div className="queue__title">
                Who needs you first <span className="count">{sorted.length} flagged of {rollups.length}</span>
              </div>
            </div>
            <div className="pill-tabs queue__filters" style={{ marginBottom: 0 }}>
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={filter === f.key ? 'active' : ''}
                  onClick={() => {
                    setFilter(f.key);
                    setExpanded(false);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {sorted.length === 0 ? (
            <Empty icon="✓">Every teacher is on pace, seen, and clear.</Empty>
          ) : (
            <>
              <div className="queue__colhead" role="row">
                <QueueSort label="Teacher" sortKey="teacher" sort={sort} onSort={toggleSort} />
                <QueueSort label="Pacing" sortKey="pacing" sort={sort} onSort={toggleSort} tip={PACING_STATUS_TOOLTIP} />
                <QueueSort label="Last seen" sortKey="lastSeen" sort={sort} onSort={toggleSort} />
                <span className="queue__col--assess">
                  <QueueSort label="Assessment" sortKey="assessment" sort={sort} onSort={toggleSort} />
                </span>
                <span className="queue__col--actions">
                  <QueueSort label="Actions" sortKey="actions" sort={sort} onSort={toggleSort} />
                </span>
                <QueueSort label="Risk" sortKey="risk" sort={sort} onSort={toggleSort} end tip={RISK_SCORE_TOOLTIP} />
              </div>

              {visible.map((r) => {
                const pace = pacingCell(r);
                const seen = seenCell(r);
                const assess = assessmentCell(r);
                const acts = actionsCell(r);
                return (
                  <div className="queue__row" key={r.teacher.id}>
                    <div className="queue__teacher">
                      <span className={`chip chip--${BAND[r.risk.band]}`}>{initials(r.teacher.name)}</span>
                      <div className="queue__names">
                        <div className="queue__name">
                          <Link to={`/teachers/${r.teacher.id}`}>{r.teacher.name}</Link>
                        </div>
                        <div className="queue__meta">
                          {[r.teacher.subject, r.teacher.gradeLevel].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </div>
                    </div>
                    <span className={`pill pill--${pace.tone}`} style={{ justifySelf: 'start' }}>
                      <span className="dot" />
                      {pace.text}
                    </span>
                    <span className="queue__seen" style={{ color: seen.tone }}>
                      {seen.text}
                    </span>
                    <span className="queue__assess queue__col--assess" style={{ color: assess.tone }}>
                      {assess.text}
                    </span>
                    <span className="queue__actions queue__col--actions" style={{ color: acts.tone }}>
                      {acts.text}
                    </span>
                    <span className="queue__risk">
                      <span className="queue__dot" style={{ background: `var(--${BAND[r.risk.band]}-500)` }} />
                      {r.risk.score}
                    </span>
                  </div>
                );
              })}

              <div className="queue__foot">
                <span>
                  {clearCount} teacher{clearCount === 1 ? '' : 's'} on pace, seen, and clear
                </span>
                {sorted.length > ROW_CAP && (
                  <button className="queue__more" onClick={() => setExpanded((v) => !v)}>
                    {expanded ? 'Show top 8 only' : `Show all ${sorted.length}`} <Icon name="arrow" />
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        {/* ---- Right rail ---- */}
        <div className="dash-rail">
          <section className="card" style={{ padding: '16px 18px' }}>
            <div className="queue__eyebrow" style={{ marginBottom: 12 }}>
              This week at a glance
            </div>
            <div className="glance">
              {glance.map((g) => (
                <div className="glance__row" key={g.label}>
                  <span className="glance__value" style={{ color: g.tone }}>
                    {g.value}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="glance__label">
                      {g.label}
                      {g.tip && <InfoTip text={g.tip} />}
                    </div>
                    <div className="glance__sub">{g.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div style={{ padding: '15px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="queue__eyebrow">Next 14 days</div>
              <div className="queue__title">Coming up</div>
            </div>
            <div style={{ padding: '6px 8px' }}>
              {upcoming.length === 0 ? (
                <Empty icon="📅">Nothing due in the next two weeks.</Empty>
              ) : (
                upcoming.map((u) => {
                  const d = parse(u.date);
                  const tone = u.days <= 3 ? 'red' : u.days <= 7 ? 'amber' : 'neutral';
                  return (
                    <div className="coming__row" key={u.id}>
                      <div className="datechip">
                        <div className="m">{d ? d.toLocaleDateString('en-US', { month: 'short' }) : '—'}</div>
                        <div className="d">{d ? d.getDate() : '?'}</div>
                      </div>
                      <div className="coming__main">
                        <div className="coming__title">{u.title}</div>
                        <div className="coming__sub">{u.sub}</div>
                      </div>
                      <span className={`pill pill--${tone}`}>in {u.days}d</span>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
