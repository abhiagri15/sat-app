'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { BANK, SECTION_CONFIG, SECTION_ORDER } from './questions';
import styles from './SatPractice.module.css';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

/* ---------- helpers ---------- */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleChoices(q) {
  const idxs = shuffle(q.choices.map((_, i) => i));
  return {
    choices: idxs.map((i) => q.choices[i]),
    answer: idxs.indexOf(q.answer),
  };
}

function buildTest(name, testLength) {
  const sections = SECTION_ORDER.map((secKey) => {
    const cfg = SECTION_CONFIG[secKey];
    const pool = shuffle(BANK.filter((q) => q.section === secKey));
    const count = testLength === 'short' ? Math.min(cfg.shortCount, pool.length) : pool.length;
    const questions = pool.slice(0, count).map((q) => {
      const s = shuffleChoices(q);
      return { skill: q.skill, passage: q.passage, prompt: q.prompt, explanation: q.explanation, ...s };
    });
    return {
      key: secKey,
      name: cfg.name,
      questions,
      timeLimit: count * cfg.secsPerQ,
    };
  });
  return { name: name || 'Student', sections };
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

export default function SatPractice() {
  const [screen, setScreen] = useState('start'); // start | test | results
  const [name, setName] = useState('');
  const [testLength, setTestLength] = useState('short');

  const [test, setTest] = useState(null);
  const [secIdx, setSecIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [responses, setResponses] = useState([]); // responses[secIdx][qIdx]
  const [remaining, setRemaining] = useState([]); // remaining[secIdx]
  const [showReview, setShowReview] = useState(false);

  const tickRef = useRef(null);

  /* ----- timer ----- */
  const stopTimer = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => () => stopTimer(), [stopTimer]); // cleanup on unmount

  // Drive the countdown whenever we're on the test screen / change section.
  useEffect(() => {
    if (screen !== 'test') return;
    stopTimer();
    tickRef.current = setInterval(() => {
      setRemaining((prev) => {
        const next = prev.slice();
        if (next[secIdx] > 0) next[secIdx] -= 1;
        if (next[secIdx] <= 0) {
          // time up — defer the advance so we don't setState mid-render
          setTimeout(() => handleTimeUp(), 0);
        }
        return next;
      });
    }, 1000);
    return stopTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, secIdx]);

  const handleTimeUp = () => {
    stopTimer();
    if (secIdx < test.sections.length - 1) {
      window.alert('Time is up for this section. Moving to the next section.');
      setSecIdx((s) => s + 1);
      setQIdx(0);
    } else {
      window.alert('Time is up. Submitting your test.');
      finish();
    }
  };

  /* ----- actions ----- */
  const start = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      window.alert('Please enter a name to start.');
      return;
    }
    const t = buildTest(trimmed, testLength);
    setTest(t);
    setResponses(t.sections.map((s) => new Array(s.questions.length).fill(null)));
    setRemaining(t.sections.map((s) => s.timeLimit));
    setSecIdx(0);
    setQIdx(0);
    setShowReview(false);
    setScreen('test');
  };

  const selectChoice = (i) => {
    setResponses((prev) => {
      const next = prev.map((arr) => arr.slice());
      next[secIdx][qIdx] = i;
      return next;
    });
  };

  const finish = () => {
    stopTimer();
    setScreen('results');
  };

  const submitSection = () => {
    const unanswered = responses[secIdx].filter((r) => r === null).length;
    const last = secIdx === test.sections.length - 1;
    let msg = unanswered > 0 ? `You have ${unanswered} unanswered question(s) in this section. ` : '';
    msg += last ? 'Submit the whole test now?' : 'Move on to the next section now?';
    if (!window.confirm(msg)) return;
    if (last) {
      finish();
    } else {
      setSecIdx((s) => s + 1);
      setQIdx(0);
    }
  };

  const newTest = () => {
    stopTimer();
    setScreen('start');
  };

  /* ----- scoring (computed on results screen) ----- */
  const computeResults = () => {
    let totalCorrect = 0;
    let totalQ = 0;
    const perSection = test.sections.map((sec, si) => {
      let correct = 0;
      sec.questions.forEach((q, qi) => {
        if (responses[si][qi] === q.answer) correct++;
      });
      totalCorrect += correct;
      totalQ += sec.questions.length;
      return { name: sec.name, correct, total: sec.questions.length };
    });
    const pct = totalQ ? totalCorrect / totalQ : 0;
    const scaled = Math.round((400 + pct * 1200) / 10) * 10;
    return { perSection, pct, scaled };
  };

  /* ============================ RENDER ============================ */
  if (screen === 'start') {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <span className={styles.pill}>Digital SAT · Practice</span>
          <h1 className={styles.h1}>SAT Practice Test</h1>
          <p className={styles.lead}>
            A full timed practice run with Reading &amp; Writing and Math sections. Answer the questions,
            submit, and get an instant score with a worked explanation for every problem. Each new test
            pulls fresh, randomized questions.
          </p>

          <label className={styles.field} htmlFor="student-name">Student name</label>
          <input
            id="student-name"
            className={styles.input}
            type="text"
            value={name}
            placeholder="Type your name to begin"
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && start()}
          />

          <label className={styles.field}>Test length</label>
          <div className={styles.btnRow} style={{ marginBottom: 18 }}>
            <button
              className={`${styles.btnGhost} ${testLength === 'short' ? styles.selectedOpt : ''}`}
              onClick={() => setTestLength('short')}
            >
              Quick (10 + 10, ~25 min)
            </button>
            <button
              className={`${styles.btnGhost} ${testLength === 'full' ? styles.selectedOpt : ''}`}
              onClick={() => setTestLength('full')}
            >
              Full sections (all questions)
            </button>
          </div>

          <div className={styles.btnRow}>
            <button className={styles.btnPrimary} onClick={start}>Start Test</button>
          </div>
          <p className={styles.note}>
            Tip: the timer counts down per section, just like the real SAT. When time runs out, the
            section auto-advances.
          </p>
        </div>
      </div>
    );
  }

  if (screen === 'test') {
    const sec = test.sections[secIdx];
    const q = sec.questions[qIdx];
    const rem = remaining[secIdx] ?? 0;
    const timerClass = `${styles.timer} ${rem <= 30 ? styles.danger : rem <= 120 ? styles.warn : ''}`;
    const isLastQ = qIdx === sec.questions.length - 1;

    return (
      <>
        <div className={styles.topbar}>
          <div className={styles.seg}>
            Section <b>{secIdx + 1}</b> · Question <b>{qIdx + 1}</b>/<b>{sec.questions.length}</b>
          </div>
          <div className={timerClass}>{fmtTime(Math.max(0, rem))}</div>
          <div className={styles.seg}>{test.name}</div>
        </div>

        <div className={styles.wrap}>
          <div className={styles.card}>
            <div className={styles.qMeta}>{sec.name} · {q.skill}</div>
            {q.passage && <div className={styles.passage}>{q.passage}</div>}
            <div className={styles.prompt}>{q.prompt}</div>
            <div className={styles.choices}>
              {q.choices.map((c, i) => (
                <div
                  key={i}
                  className={`${styles.choice} ${responses[secIdx][qIdx] === i ? styles.selected : ''}`}
                  onClick={() => selectChoice(i)}
                >
                  <span className={styles.ltr}>{LETTERS[i]}</span>
                  <span>{c}</span>
                </div>
              ))}
            </div>

            <div className={styles.btnRow} style={{ marginTop: 22, justifyContent: 'space-between' }}>
              <button
                className={styles.btnGhost}
                style={{ visibility: qIdx === 0 ? 'hidden' : 'visible' }}
                onClick={() => setQIdx((n) => Math.max(0, n - 1))}
              >
                ‹ Previous
              </button>
              <button
                className={styles.btnPrimary}
                onClick={() => setQIdx((n) => Math.min(sec.questions.length - 1, n + 1))}
                disabled={isLastQ}
              >
                {isLastQ ? 'Last question' : 'Next ›'}
              </button>
            </div>
          </div>

          <div className={styles.card} style={{ marginTop: 16 }}>
            <h2 className={styles.h2}>Question navigator</h2>
            <div className={styles.navgrid}>
              {sec.questions.map((_, i) => (
                <button
                  key={i}
                  className={`${styles.navbtn} ${responses[secIdx][i] !== null ? styles.answered : ''} ${i === qIdx ? styles.current : ''}`}
                  onClick={() => setQIdx(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <div className={styles.btnRow}>
              <button className={styles.btnPrimary} onClick={submitSection}>
                {secIdx === test.sections.length - 1 ? 'Submit test' : 'Submit section'}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ----- results -----
  const { perSection, pct, scaled } = computeResults();
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <span className={styles.pill}>{test.name}</span>
        <h1 className={styles.h1}>Your results</h1>
        <div className={styles.scorebox}>
          <div className={styles.big}>{scaled}</div>
          <div className={styles.subText}>Estimated SAT score (400–1600)</div>
        </div>
        <div className={styles.bar}><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>
        <div className={styles.breakdown}>
          {perSection.map((s) => (
            <div key={s.name} className={styles.stat}>
              <div className={styles.statN}>{s.correct}/{s.total}</div>
              <div className={styles.statL}>{s.name}</div>
            </div>
          ))}
          <div className={styles.stat}>
            <div className={styles.statN}>{Math.round(pct * 100)}%</div>
            <div className={styles.statL}>Overall correct</div>
          </div>
        </div>
        <div className={styles.btnRow}>
          <button className={styles.btnPrimary} onClick={newTest}>Start a New Test</button>
          <button className={styles.btnGhost} onClick={() => setShowReview((v) => !v)}>
            {showReview ? 'Hide full review' : 'Show full review'}
          </button>
        </div>
        <p className={styles.note}>
          Scaled score is an approximation based on percent correct, for practice motivation only. Focus
          on the explanations below to learn from each question.
        </p>
      </div>

      {showReview && (
        <div style={{ marginTop: 18 }}>
          {test.sections.map((sec, si) => (
            <div key={si}>
              <h2 className={styles.h2} style={{ margin: '22px 0 12px' }}>{sec.name} — review</h2>
              {sec.questions.map((q, qi) => {
                const yours = responses[si][qi];
                const isCorrect = yours === q.answer;
                return (
                  <div key={qi} className={styles.reviewQ}>
                    <div className={styles.qMeta}>
                      {q.skill}{' '}
                      {yours === null ? (
                        <span className={`${styles.tag} ${styles.tagSkip}`}>Skipped</span>
                      ) : isCorrect ? (
                        <span className={`${styles.tag} ${styles.tagOk}`}>Correct</span>
                      ) : (
                        <span className={`${styles.tag} ${styles.tagNo}`}>Incorrect</span>
                      )}
                    </div>
                    {q.passage && <div className={styles.passage}>{q.passage}</div>}
                    <div className={styles.prompt}>{q.prompt}</div>
                    <div className={styles.ansLine}>
                      Your answer:{' '}
                      {yours === null ? (
                        <i>none</i>
                      ) : (
                        <span className={isCorrect ? styles.correct : styles.wrong}>
                          {LETTERS[yours]}. {q.choices[yours]}
                        </span>
                      )}
                    </div>
                    {!isCorrect && (
                      <div className={styles.ansLine}>
                        Correct answer:{' '}
                        <span className={styles.correct}>{LETTERS[q.answer]}. {q.choices[q.answer]}</span>
                      </div>
                    )}
                    <div className={styles.explain}>
                      <b>Why:</b> <span dangerouslySetInnerHTML={{ __html: q.explanation }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
