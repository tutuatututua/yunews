import * as Slider from '@radix-ui/react-slider'
import { cn } from '../../lib/cn'
import styles from './RangeSlider.module.css'

export type RangeSliderValue = readonly [number, number]

type Props = {
  value: RangeSliderValue
  onValueChange: (next: [number, number]) => void
  min: number
  max: number
  step?: number
  disabled?: boolean
  className?: string
  thumbLabels?: readonly [string, string]
}

export function RangeSlider({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  disabled,
  className,
  thumbLabels = ['Minimum', 'Maximum'],
}: Props) {
  // Keep the component resilient even if callers accidentally pass unsorted values.
  const a = Number.isFinite(value?.[0]) ? value[0] : min
  const b = Number.isFinite(value?.[1]) ? value[1] : max
  const ordered: [number, number] = [Math.min(a, b), Math.max(a, b)]
  const isOverlapping = ordered[0] === ordered[1]

  return (
    <Slider.Root
      className={cn(styles.root, isOverlapping && styles.overlap, className)}
      value={ordered}
      onValueChange={(next) => {
        const lo = next?.[0] ?? min
        const hi = next?.[1] ?? max
        onValueChange([Math.min(lo, hi), Math.max(lo, hi)])
      }}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      minStepsBetweenThumbs={0}
    >
      <Slider.Track className={styles.track}>
        <Slider.Range className={styles.range} />
      </Slider.Track>
      <Slider.Thumb className={cn(styles.thumb, styles.thumbMin)} aria-label={thumbLabels[0]} />
      <Slider.Thumb className={cn(styles.thumb, styles.thumbMax)} aria-label={thumbLabels[1]} />
    </Slider.Root>
  )
}
