/*
 * The same badge as in studioShared, for the three studios that import it on its own.
 *
 * NOT the user's own file — theirs is not in any extracted archive. It re-exports rather than restating the
 * markup, so the badge cannot drift into two different-looking versions of itself.
 */
export { ValidationBadge, ValidationBadge as default } from './studioShared.jsx';
