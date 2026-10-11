/**
 * Small JSON stores, now in `src/main/storage/`.
 *
 * They were written here for notes and tasks and ended up holding up twelve features, so they moved somewhere that
 * says what they are. Re-exported rather than relocated with a sweep: every importer keeps working, and the ones
 * that are about personal data keep an import that reads correctly.
 */
export { JsonFile, Collection, personalFile, profileFile, type JsonFileOptions } from '../storage/jsonFile.ts'
