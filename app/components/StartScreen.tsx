'use client';

import type { TestLength } from '@/app/lib/test';
import styles from '@/app/SatPractice.module.css';

interface StartScreenProps {
  name: string;
  setName: (s: string) => void;
  testLength: TestLength;
  setTestLength: (l: TestLength) => void;
  onStart: () => void;
}

export function StartScreen({ name, setName, testLength, setTestLength, onStart }: StartScreenProps) {
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
          onKeyDown={(e) => e.key === 'Enter' && onStart()}
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
          <button className={styles.btnPrimary} onClick={onStart}>Start Test</button>
        </div>
        <p className={styles.note}>
          Tip: the timer counts down per section, just like the real SAT. When time runs out, the
          section auto-advances.
        </p>
      </div>
    </div>
  );
}
