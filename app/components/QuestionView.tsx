'use client';

import { LETTERS } from '@/app/lib/test';
import type { Question } from '@/app/lib/questions';
import styles from '@/app/SatPractice.module.css';

interface QuestionViewProps {
  section: { name: string };
  question: Question;
  selected: number | null;
  onSelect: (i: number) => void;
  onPrev: () => void;
  onNext: () => void;
  isFirst: boolean;
  isLast: boolean;
}

export function QuestionView({
  section,
  question,
  selected,
  onSelect,
  onPrev,
  onNext,
  isFirst,
  isLast,
}: QuestionViewProps) {
  return (
    <div className={styles.card}>
      <div className={styles.qMeta}>{section.name} · {question.skill}</div>
      {question.passage && <div className={styles.passage}>{question.passage}</div>}
      <div className={styles.prompt}>{question.prompt}</div>
      <div className={styles.choices}>
        {question.choices.map((c, i) => (
          <div
            key={i}
            className={`${styles.choice} ${selected === i ? styles.selected : ''}`}
            onClick={() => onSelect(i)}
          >
            <span className={styles.ltr}>{LETTERS[i]}</span>
            <span>{c}</span>
          </div>
        ))}
      </div>

      <div className={styles.btnRow} style={{ marginTop: 22, justifyContent: 'space-between' }}>
        <button
          className={styles.btnGhost}
          style={{ visibility: isFirst ? 'hidden' : 'visible' }}
          onClick={onPrev}
        >
          ‹ Previous
        </button>
        <button
          className={styles.btnPrimary}
          onClick={onNext}
          disabled={isLast}
        >
          {isLast ? 'Last question' : 'Next ›'}
        </button>
      </div>
    </div>
  );
}
