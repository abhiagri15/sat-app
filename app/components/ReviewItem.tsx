'use client';

import { LETTERS } from '@/app/lib/test';
import type { Question } from '@/app/lib/questions';
import styles from '@/app/SatPractice.module.css';

interface ReviewItemProps {
  question: Question;
  chosenIndex: number | null;
}

// NOTE: explanation rendering uses dangerouslySetInnerHTML because seed BANK content
// contains trusted <b>/<i> tags. The AI sub-project (#2) MUST replace this with a
// sanitizer or constrained renderer once questions become user-influenced.
export function ReviewItem({ question, chosenIndex }: ReviewItemProps) {
  const isCorrect = chosenIndex === question.answerIndex;
  return (
    <div className={styles.reviewQ}>
      <div className={styles.qMeta}>
        {question.skill}{' '}
        {chosenIndex === null ? (
          <span className={`${styles.tag} ${styles.tagSkip}`}>Skipped</span>
        ) : isCorrect ? (
          <span className={`${styles.tag} ${styles.tagOk}`}>Correct</span>
        ) : (
          <span className={`${styles.tag} ${styles.tagNo}`}>Incorrect</span>
        )}
      </div>
      {question.passage && <div className={styles.passage}>{question.passage}</div>}
      <div className={styles.prompt}>{question.prompt}</div>
      <div className={styles.ansLine}>
        Your answer:{' '}
        {chosenIndex === null ? (
          <i>none</i>
        ) : (
          <span className={isCorrect ? styles.correct : styles.wrong}>
            {LETTERS[chosenIndex]}. {question.choices[chosenIndex]}
          </span>
        )}
      </div>
      {!isCorrect && chosenIndex !== null && (
        <div className={styles.ansLine}>
          Correct answer:{' '}
          <span className={styles.correct}>
            {LETTERS[question.answerIndex]}. {question.choices[question.answerIndex]}
          </span>
        </div>
      )}
      <div className={styles.explain}>
        <b>Why:</b> <span dangerouslySetInnerHTML={{ __html: question.explanation }} />
      </div>
    </div>
  );
}
