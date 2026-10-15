// Part of scripts/cosmos-rebrand.mjs: a text filter that everything shown in the simulation passes through.
//
// Names and descriptions of data packs come from a server and from files inside the packs, so they cannot be
// rewritten in the repository. Labels, buttons and the data descriptions pass through OrbisBrand instead, which shows
// the program under Orbis's name and drops links to the original project's own sites.

const JAVA = `package gaiasky.util;

import java.util.regex.Pattern;

/**
 * ORBIS COSMOS: the program is shown under Orbis's name wherever text reaches a screen.
 * Added by Orbis; not part of the original program.
 */
public final class OrbisBrand {
    private static final Pattern NAME = Pattern.compile("G\\\\s?a\\\\s?i\\\\s?a\\\\s?S\\\\s?k\\\\s?y|GaiaSky", Pattern.CASE_INSENSITIVE);
    private static final Pattern SITE = Pattern.compile("gaiasky\\\\.space|codeberg\\\\.org/gaiasky|gaia\\\\.ari\\\\.uni-heidelberg\\\\.de/gaiasky");

    private OrbisBrand() {
    }

    public static String clean(String text) {
        if (text == null || text.isEmpty()) {
            return text;
        }
        return NAME.matcher(text).replaceAll("ORBIS COSMOS");
    }

    public static CharSequence clean(CharSequence text) {
        if (text == null || text.length() == 0) {
            return text;
        }
        return clean(text.toString());
    }

    /** Whether an address belongs to the original program's own sites and so should not be offered. */
    public static boolean isOriginalSite(String link) {
        return link != null && SITE.matcher(link).find();
    }
}
`

export function applyFilter({ cosmos, read, write, join }) {
  write(join(cosmos, 'core', 'src', 'gaiasky', 'util', 'OrbisBrand.java'), JAVA)

  // The text widgets are built with their text: it goes through the filter on the way in.
  const dir = join(cosmos, 'core', 'src', 'gaiasky', 'util', 'scene2d')
  for (const name of ['OwnLabel', 'OwnCheckBox', 'OwnTextButton', 'OwnTextIconButton', 'OwnTextArea', 'OwnTextField']) {
    const file = join(dir, `${name}.java`)
    let src = read(file)
    src = src.replace(/super\(text,/g, 'super(gaiasky.util.OrbisBrand.clean(text),')
    src = src.replace(/super\(TextUtils\.breakCharacters\(text,/g, 'super(TextUtils.breakCharacters(gaiasky.util.OrbisBrand.clean(text),')
    write(file, src)
  }

  // The data descriptions: every string they read, and the list of links.
  const ds = join(cosmos, 'core', 'src', 'gaiasky', 'util', 'datadesc', 'Dataset.java')
  let d = read(ds)
  if (!d.includes('OrbisBrand')) {
    d = d.replace('private String getString(String... attrNames) {', 'private String getString(String... attrNames) {\n        return gaiasky.util.OrbisBrand.clean(getStringRaw(attrNames));\n    }\n\n    private String getStringRaw(String... attrNames) {')
    d = d.replace('private String getString(String attrName) {', 'private String getString(String attrName) {\n        return gaiasky.util.OrbisBrand.clean(getStringRaw1(attrName));\n    }\n\n    private String getStringRaw1(String attrName) {')
    d = d.replace(
      'private String[] getStringOrArray(String... attrNames) {',
      'private String[] getStringOrArray(String... attrNames) {\n        return brandList(getStringOrArrayRaw(attrNames));\n    }\n\n    private static String[] brandList(String[] in) {\n        if (in == null) {\n            return null;\n        }\n        return java.util.Arrays.stream(in).filter(x -> !gaiasky.util.OrbisBrand.isOriginalSite(x)).map(gaiasky.util.OrbisBrand::clean).toArray(String[]::new);\n    }\n\n    private String[] getStringOrArrayRaw(String... attrNames) {'
    )
    d = d.replace('private String[] getStringOrArray(String attrName) {', 'private String[] getStringOrArray(String attrName) {\n        return brandList(getStringOrArrayRaw1(attrName));\n    }\n\n    private String[] getStringOrArrayRaw1(String attrName) {')
    d = d.replace('this.releaseNotes = releaseNotes.asString().split(', 'this.releaseNotes = gaiasky.util.OrbisBrand.clean(releaseNotes.asString()).split(')
    d = d.replace(
      'this.releaseNotes = releaseNotes.asStringArray();',
      'this.releaseNotes = java.util.Arrays.stream(releaseNotes.asStringArray()).map(gaiasky.util.OrbisBrand::clean).toArray(String[]::new);'
    )
    write(ds, d)
  }
}
