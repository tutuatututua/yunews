import React from 'react'
import { util } from '../../styles'
import styles from './Loading.module.css'

export function LoadingLine(props: { label?: string }) {
  return (
    <div className={styles.loadingLine} aria-busy="true" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span className={util.muted}>{props.label || 'Loading…'}</span>
    </div>
  )
}
