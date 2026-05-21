'use client';

import type { Test, Results } from '@/app/lib/test';
import { ReviewItem } from './ReviewItem';
import styles from '@/app/SatPractice.module.css';

interface ResultsScreenProps {
  test: Test;
  responses: (number | null)[][];
  results: Results;
  showReview: boolean;
  onToggleReview: () => void;
  onNewTest: () => void;
}

export function ResultsScreen({
  test, responses, results, showReview, onToggleReview, onNewTest,
}: ResultsScreenProps) {
  const { perSection, pct, scaled } = results;
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
          <button className={styles.btnPrimary} onClick={onNewTest}>Start a New Test</button>
          <button className={styles.btnGhost} onClick={onToggleReview}>
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
              <h2 className={styles.h2} style={{ margin: '22px 0 12px' }}>
                {sec.name} — review
              </h2>
              {sec.questions.map((q, qi) => (
                <ReviewItem key={qi} question={q} chosenIndex={responses[si][qi]} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
