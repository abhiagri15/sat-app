'use client';

import type { TestSection } from '@/app/lib/test';
import styles from '@/app/SatPractice.module.css';

interface QuestionNavigatorProps {
  section: TestSection;
  qIdx: number;
  sectionResponses: (number | null)[];
  onGoToQuestion: (qi: number) => void;
  onSubmitSection: () => void;
  isLastSection: boolean;
}

export function QuestionNavigator({
  section,
  qIdx,
  sectionResponses,
  onGoToQuestion,
  onSubmitSection,
  isLastSection,
}: QuestionNavigatorProps) {
  return (
    <div className={styles.card} style={{ marginTop: 16 }}>
      <h2 className={styles.h2}>Question navigator</h2>
      <div className={styles.navgrid}>
        {section.questions.map((_, i) => (
          <button
            key={i}
            className={`${styles.navbtn} ${
              sectionResponses[i] !== null ? styles.answered : ''
            } ${i === qIdx ? styles.current : ''}`}
            onClick={() => onGoToQuestion(i)}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className={styles.btnRow}>
        <button className={styles.btnPrimary} onClick={onSubmitSection}>
          {isLastSection ? 'Submit test' : 'Submit section'}
        </button>
      </div>
    </div>
  );
}
