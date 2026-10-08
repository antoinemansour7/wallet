import { motion, useReducedMotion } from 'framer-motion'

const transition = { duration: 0.2, ease: [0.22, 1, 0.36, 1] }

/** Follow a selection without delaying its label, focus or event handler. */
export function SelectionIndicator({ id, className }) {
  const reduced = useReducedMotion()
  return <motion.span aria-hidden="true" layoutId={id} initial={false} transition={reduced ? { duration: 0 } : transition} className={className} />
}

/** Move surviving items after filtering, sorting or disclosure changes.
 * Removed items leave immediately so hidden links cannot retain focus.
 */
export function ReflowItem({ as = 'div', children, ...props }) {
  const reduced = useReducedMotion()
  const Element = motion[as]
  return <Element layout={reduced ? false : 'position'} initial={false} transition={reduced ? { duration: 0 } : transition} {...props}>{children}</Element>
}
