/**
 * The window's shared controls.
 *
 * Small on purpose. Each one exists because the same thing was written by hand several times and the copies
 * disagreed about something that matters — whether an icon button has a name, whether a screen has a way out,
 * whether Escape clears a search box or closes the screen, whether a toggle says which way it is set.
 *
 * Most of them add no CSS: `.view`, `.view-head`, `.view-actions`, `.view-empty` and `.icon-btn` were already
 * shared, and what was missing was anything making them the default. Only the search box and the chip bring rules
 * of their own, in `ui.css`.
 *
 * A screen keeps its own stylesheet for what is genuinely its own. This is for what never was.
 */
export { Surface } from './Surface'
export type { SurfaceProps } from './Surface'
export { IconButton } from './IconButton'
export type { IconButtonProps } from './IconButton'
export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'
export { SearchBox } from './SearchBox'
export type { SearchBoxProps } from './SearchBox'
export { Chip } from './Chip'
export type { ChipProps } from './Chip'
export { Button } from './Button'
export type { ButtonProps } from './Button'
export { Modal } from './Modal'
export type { ModalProps } from './Modal'
export { Segmented } from './Segmented'
export type { SegmentedProps, SegmentedOption } from './Segmented'
export { ListRow } from './ListRow'
export type { ListRowProps, RowAction } from './ListRow'
export { Field } from './Field'
export type { FieldProps, FieldWiring } from './Field'
export { SplitView } from './SplitView'
export type { SplitViewProps } from './SplitView'
