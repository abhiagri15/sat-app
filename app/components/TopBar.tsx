'use client';

import { fmtTime } from '@/app/lib/test';
import styles from '@/app/SatPractice.module.css';

interface TopBarProps {
  secIdx: number;
  qIdx: number;
  totalQ: number;
  studentName: string;
  remaining: number;          // seconds left in the current section
}

export function TopBar({ secIdx, qIdx, totalQ, studentName, remaining }: TopBarProps) {
  const timerClass = `${styles.timer} ${
    remaining <= 30 ? styles.danger : remaining <= 120 ? styles.warn : ''
  }`;
  return (
    <div className={styles.topbar}>
      <div className={styles.seg}>
        Section <b>{secIdx + 1}</b> · Question <b>{qIdx + 1}</b>/<b>{totalQ}</b>
      </div>
      <div className={timerClass}>{fmtTime(Math.max(0, remaining))}</div>
      <div className={styles.seg}>{studentName}</div>
    </div>
  );
}
