import {
  BANDS,
  DIMENSIONS,
  PILLARS,
  bandFor,
  dimLevel,
  fixLift,
  levelName,
  overallScore,
  pillarPoints,
  pillarWeight,
  pts,
  withAllFixes,
} from '@/lib/review/sample';
import { GuidanceNudge, GuidancePanel } from './Guidance';

/* One report, drawn the same way whether it's the made-up sample at
   /review/sample or a real one at /review/report/[id]. Every number is worked
   out here from the levels in `report`, never read from it. */

/* Three notches, one per level. A blended level (2.3) fills the third notch
   by 30%, so the bar never claims a level the evidence didn't reach. */
function Meter({ level }) {
  return (
    <span className="rv-meter" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <i key={i} style={{ '--f': Math.max(0, Math.min(1, level - i)) }} />
      ))}
    </span>
  );
}

/* Where the score sits among the bands, and where the fixes would take it.
   Bands are laid out to scale: Rebuild is half the track. */
function Ladder({ score, band, projected, projectedBand, fixCount }) {
  const order = [...BANDS].reverse();
  return (
    <div
      className="rv-ladder"
      role="img"
      aria-label={`${score} out of 100, in ${band.name}. About ${projected} after the ${fixCount} fixes, in ${projectedBand.name}.`}
    >
      <div className="rv-ladder-pins" aria-hidden="true">
        <span className={'rv-pin now' + (score < 15 ? ' flip' : '')} style={{ left: `${score}%` }}>
          <span>You </span>
          <b>{score}</b>
        </span>
        {projected > score && (
          <span className="rv-pin next" style={{ left: `${projected}%` }}>
            <span>After fixes </span>
            <b>{projected}</b>
          </span>
        )}
      </div>
      <div className="rv-ladder-track" aria-hidden="true">
        <i className="rv-ladder-fill" style={{ width: `${score}%` }} />
        <i className="rv-ladder-gain" style={{ left: `${score}%`, width: `${projected - score}%` }} />
        {order.slice(1).map((b) => (
          <i key={b.id} className="rv-ladder-tick" style={{ left: `${b.min}%` }} />
        ))}
      </div>
      <ol className="rv-ladder-bands" aria-hidden="true">
        {order.map((b, i) => {
          const max = i < order.length - 1 ? order[i + 1].min : 100;
          return (
            <li key={b.id} className={b.id === band.id ? 'is-here' : ''} style={{ flexBasis: `${max - b.min}%` }}>
              <b>
                {b.short ? (
                  <>
                    <span className="rv-long">{b.name}</span>
                    <span className="rv-short">{b.short}</span>
                  </>
                ) : (
                  b.name
                )}
              </b>
              <span>{b.min}+</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const plural = (n, one, many) => (n === 1 ? one : many);

/* What the reviewer actually saw: screenshots taken by its browser while it
   went through the portfolio. The opening screen leads, the rest follow in the
   order a visitor meets them. Only on real reports (`id`), not the sample. */
function WhatWeSaw({ id, shots }) {
  if (!id || !shots?.length) return null;
  const [lead, ...rest] = shots;
  const src = (s) => `/review/shots/${id}/${s.n}`;
  return (
    <section className="rv-rsec rv-shots" aria-labelledby="rv-shots-h">
      <h2 id="rv-shots-h">What we looked at</h2>
      <p className="rv-rsec-sub">
        Screenshots from our reviewer going through your portfolio, the way a hiring manager would.
      </p>
      <figure className="rv-shot lead">
        <img src={src(lead)} alt={lead.label} loading="eager" />
        <figcaption>{lead.label}</figcaption>
      </figure>
      {rest.length > 0 && (
        <div className="rv-shot-grid">
          {rest.map((s) => (
            <figure key={s.n} className={'rv-shot' + (s.kind === 'case' ? ' is-case' : '')}>
              <img src={src(s)} alt={s.label} loading="eager" />
              <figcaption>{s.label}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ReportView({ report, id }) {
  const score = overallScore(report);
  const band = bandFor(score, report);
  const projected = overallScore(withAllFixes(report));
  const projectedBand = bandFor(projected, withAllFixes(report));
  /* Biggest lift first, whatever order the fixes arrived in. */
  const fixes = report.fixes
    .map((f) => ({ ...f, lift: Math.round(fixLift(report, f)) }))
    .sort((a, b) => b.lift - a.lift);
  const fixWord = `${fixes.length} ${plural(fixes.length, 'fix', 'fixes')}`;
  /* Where the guidance panel offers to take them: the band the fixes reach, or
     the next one up if the fixes alone don't cross into it. None at the top. */
  const nextBand = BANDS[BANDS.findIndex((b) => b.id === band.id) - 1];
  const guideTo = !nextBand ? null : projectedBand.id !== band.id ? projectedBand.name : nextBand.name;

  return (
    <>
      {/* ------------------------------------------------ verdict */}
      <section className="rv-verdict" aria-labelledby="rv-verdict-h">
        <div className="rv-verdict-top">
          <p className="rv-score">
            <b>{score}</b>
            <span>/ 100</span>
          </p>
          <div className="rv-verdict-copy">
            <h2 id="rv-verdict-h">{band.name}</h2>
            <p>
              {band.means}{' '}
              {fixes.length > 0 &&
                (projectedBand.id !== band.id ? (
                  <>
                    Make the {fixWord} below to reach about <b>{projected}</b> and move up to &ldquo;
                    {projectedBand.name}&rdquo;.
                  </>
                ) : (
                  <>
                    Make the {fixWord} below to reach about <b>{projected}</b>.
                  </>
                ))}
            </p>
          </div>
        </div>

        <Ladder
          score={score}
          band={band}
          projected={projected}
          projectedBand={projectedBand}
          fixCount={fixes.length}
        />

        <dl className="rv-verdict-meta">
          <div>
            <dt>Portfolio</dt>
            <dd>{report.site}</dd>
          </div>
          <div>
            <dt>Your level</dt>
            <dd>{report.level}</dd>
          </div>
          <div>
            <dt>Job you want</dt>
            <dd>{report.role}</dd>
          </div>
          <div>
            <dt>Reviewed</dt>
            <dd>{report.reviewedOn}</dd>
          </div>
          {report.mode === 'MOTION' && (
            <div>
              <dt>Read as</dt>
              <dd>Motion / video portfolio</dd>
            </div>
          )}
        </dl>
      </section>

      <WhatWeSaw id={id} shots={report.shots} />

      {report.integrityFlag && (
        <div className="rv-limits">
          <b>Something to check first</b>
          <p>{report.integrityNote}</p>
        </div>
      )}

      {/* ------------------------------------------------ pillars */}
      <section className="rv-rsec" aria-labelledby="rv-pillars-h">
        <h2 id="rv-pillars-h">Your score, in 4 parts</h2>
        <p className="rv-rsec-sub">Story counts the most. It&rsquo;s what hiring managers read for.</p>
        <div className="bento rv-pillars">
          {PILLARS.map((p) => {
            const got = Math.round(pillarPoints(report, p.id));
            const of = pillarWeight(p.id);
            return (
              <article key={p.id} className={`bt ${p.paper} rv-pillar${p.id === 'story' ? ' wide' : ''}`}>
                <div className="bt-copy">
                  <div className="rv-pillar-head">
                    <div>
                      <h3>{p.name}</h3>
                      <p className="rv-pillar-ask">{p.ask}</p>
                    </div>
                    <p className="rv-pillar-n" aria-label={`${got} out of ${of}`}>
                      <b>{got}</b>
                      <span>/ {of}</span>
                    </p>
                  </div>
                  <p className="rv-pillar-why">{report.pillarWhy[p.id]}</p>
                </div>
                <ul className="rv-dims">
                  {DIMENSIONS.filter((d) => d.pillar === p.id).map((d) => {
                    const lv = dimLevel(report, d);
                    return (
                      <li key={d.id}>
                        <span className="rv-dims-name">{d.label}</span>
                        <Meter level={lv} />
                        <span className="rv-dims-word" title={`${pts(lv)} of 3`}>
                          {levelName(lv)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------ fixes */}
      {fixes.length > 0 && (
        <section className="rv-rsec" aria-labelledby="rv-fixes-h">
          <h2 id="rv-fixes-h">Fix these first</h2>
          <p className="rv-rsec-sub">
            The {fixes.length === 1 ? 'change' : `${fixes.length} changes`} that would raise your score the
            most.
          </p>
          <ol className="rv-fixes">
            {fixes.map((f) => (
              <li key={f.dim} className="rv-fix">
                <p className="rv-fix-lift">
                  <b>+{f.lift}</b>
                  <span>points</span>
                </p>
                <div className="rv-fix-body">
                  <h3>{f.title}</h3>
                  <p className="rv-fix-where">{f.where}</p>
                  <div className="rv-fix-pair">
                    <div className="rv-saw">
                      <span>Right now</span>
                      <p>{f.now}</p>
                    </div>
                    <div className="rv-try">
                      <span>Try this</span>
                      <p>{f.try}</p>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <GuidanceNudge />
        </section>
      )}

      {/* ------------------------------------------------ case studies */}
      <section className="rv-rsec" aria-labelledby="rv-cases-h">
        <h2 id="rv-cases-h">Your case studies</h2>
        {report.cases.length > 0 ? (
          <>
            <p className="rv-rsec-sub">
              {report.cases.length > 1
                ? 'Reviewers read the first one most closely, so it counts the most.'
                : 'Reviewers read this one closely, so it carries the whole Story score.'}
            </p>
            <ol className="rv-cases">
              {report.cases.map((c, i) => (
                <li key={c.title + i} className={`rv-case${i === 0 ? ' lead' : ''}`}>
                  <div className="rv-case-head">
                    <span className="num round">{i + 1}</span>
                    <span className="rv-case-kind">
                      {i === 0 && report.cases.length > 1 ? `${c.kind} · counts most` : c.kind}
                    </span>
                  </div>
                  <h3>{c.title}</h3>
                  <dl className="rv-case-notes">
                    <div>
                      <dt>Good</dt>
                      <dd>{c.good}</dd>
                    </div>
                    <div className="is-fix">
                      <dt>Fix</dt>
                      <dd>{c.fix}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="rv-limits">
            <b>We couldn&rsquo;t find a project to open</b>
            <p>
              Your score can&rsquo;t count case studies we can&rsquo;t see. Link at least one project to a
              page that tells its story: the problem, your choices and how it turned out.
            </p>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ working */}
      <section className="rv-rsec" aria-labelledby="rv-good-h">
        <h2 id="rv-good-h">What&rsquo;s already working</h2>
        <ul className="rv-strengths">
          {report.strengths.map((s) => (
            <li key={s}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8.5l3.2 3L13 4.5" />
              </svg>
              {s}
            </li>
          ))}
        </ul>

        {report.cantSee && (
          <div className="rv-limits">
            <b>What we couldn&rsquo;t check</b>
            <p>{report.cantSee}</p>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ guidance */}
      <GuidancePanel nextBand={guideTo} />
    </>
  );
}
