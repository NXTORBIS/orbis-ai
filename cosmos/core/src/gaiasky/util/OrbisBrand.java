package gaiasky.util;

import java.util.regex.Pattern;

/**
 * ORBIS COSMOS: the program is shown under Orbis's name wherever text reaches a screen.
 * Added by Orbis; not part of the original program.
 */
public final class OrbisBrand {
    private static final Pattern NAME = Pattern.compile("G\\s?a\\s?i\\s?a\\s?S\\s?k\\s?y|GaiaSky", Pattern.CASE_INSENSITIVE);
    private static final Pattern SITE = Pattern.compile("gaiasky\\.space|codeberg\\.org/gaiasky|gaia\\.ari\\.uni-heidelberg\\.de/gaiasky");

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
