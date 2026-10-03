// The start page's widgets used to be decided here, in this page's own storage, from this page's own short list of
// eleven. They are not any more: there is one catalogue of widgets (src/shared/widgets.ts), one board kept with
// everything else personal, and one set of rules for changing it (src/shared/widgetBoard.ts) -- so the start page,
// the gallery and Orion cannot disagree about what is on the page, and a widget added in one window is on the page
// in the next.
//
// What drew them is now orbis-ui/newtab/widgets/, bundled into widgets.js. What the sums here did:
//   the catalogue and its sizes      -> src/shared/widgets.ts
//   adding, moving, resizing, setting -> src/shared/widgetBoard.ts (applyWidgetAction)
//   the calculator's arithmetic       -> orbis-ui/newtab/widgets/renderers/time/sums.ts
//   the timer's and world clock's text -> orbis-ui/newtab/widgets/renderers/time/
//
// The file itself stays because the browser's resource list names it, and a name in that list that points at nothing
// is a page that fails to load. It exports nothing and nothing imports it.
