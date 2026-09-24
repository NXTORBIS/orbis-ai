// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/orbis/adblock/orbis_filter_parser.h"

#include "testing/gtest/include/gtest/gtest.h"

namespace orbis {
namespace {

namespace proto = url_pattern_index::proto;

TEST(OrbisFilterParser, PlainPatternBlocksEverySortOfRequest) {
  ParsedLine parsed = ParseFilterLine("/ads/banner.gif");
  ASSERT_TRUE(parsed.rule);
  EXPECT_EQ(proto::RULE_SEMANTICS_BLOCKLIST, parsed.rule->semantics());
  EXPECT_EQ("/ads/banner.gif", parsed.rule->url_pattern());
  EXPECT_EQ(proto::ANCHOR_TYPE_NONE, parsed.rule->anchor_left());
  // A rule that names no type applies to all of them, which is what leaving the
  // option out means in the filter syntax.
  EXPECT_EQ(proto::ELEMENT_TYPE_ALL, parsed.rule->element_types());
}

TEST(OrbisFilterParser, DoubleBarAnchorsToTheSubdomain) {
  ParsedLine parsed = ParseFilterLine("||ads.example.com^");
  ASSERT_TRUE(parsed.rule);
  EXPECT_EQ(proto::ANCHOR_TYPE_SUBDOMAIN, parsed.rule->anchor_left());
  EXPECT_EQ("ads.example.com^", parsed.rule->url_pattern());
}

TEST(OrbisFilterParser, SingleBarsAnchorToTheBoundaries) {
  ParsedLine parsed = ParseFilterLine("|http://example.com/ad|");
  ASSERT_TRUE(parsed.rule);
  EXPECT_EQ(proto::ANCHOR_TYPE_BOUNDARY, parsed.rule->anchor_left());
  EXPECT_EQ(proto::ANCHOR_TYPE_BOUNDARY, parsed.rule->anchor_right());
  EXPECT_EQ("http://example.com/ad", parsed.rule->url_pattern());
}

TEST(OrbisFilterParser, LeadingAtAtIsAnException) {
  ParsedLine parsed = ParseFilterLine("@@||example.com/wanted.js");
  ASSERT_TRUE(parsed.rule);
  EXPECT_EQ(proto::RULE_SEMANTICS_ALLOWLIST, parsed.rule->semantics());
  EXPECT_EQ(proto::ANCHOR_TYPE_SUBDOMAIN, parsed.rule->anchor_left());
}

TEST(OrbisFilterParser, TypeOptionsNarrowTheRule) {
  ParsedLine parsed = ParseFilterLine("||example.com/x$script,image");
  ASSERT_TRUE(parsed.rule);
  EXPECT_EQ(proto::ELEMENT_TYPE_SCRIPT | proto::ELEMENT_TYPE_IMAGE,
            parsed.rule->element_types());
}

TEST(OrbisFilterParser, ANegatedTypeRemovesItFromEverythingElse) {
  ParsedLine parsed = ParseFilterLine("||example.com/x$~script");
  ASSERT_TRUE(parsed.rule);
  EXPECT_EQ(0, parsed.rule->element_types() & proto::ELEMENT_TYPE_SCRIPT);
  EXPECT_TRUE(parsed.rule->element_types() & proto::ELEMENT_TYPE_IMAGE);
}

TEST(OrbisFilterParser, ThirdPartyAndItsNegationAreOpposites) {
  ParsedLine third = ParseFilterLine("||example.com^$third-party");
  ASSERT_TRUE(third.rule);
  EXPECT_EQ(proto::SOURCE_TYPE_THIRD_PARTY, third.rule->source_type());

  ParsedLine first = ParseFilterLine("||example.com^$~third-party");
  ASSERT_TRUE(first.rule);
  EXPECT_EQ(proto::SOURCE_TYPE_FIRST_PARTY, first.rule->source_type());
}

TEST(OrbisFilterParser, DomainOptionSplitsIncludedFromExcluded) {
  ParsedLine parsed =
      ParseFilterLine("/ad$domain=example.com|~sub.example.com|other.test");
  ASSERT_TRUE(parsed.rule);
  ASSERT_EQ(3, parsed.rule->initiator_domains_size());
  EXPECT_EQ("example.com", parsed.rule->initiator_domains(0).domain());
  EXPECT_FALSE(parsed.rule->initiator_domains(0).exclude());
  EXPECT_EQ("other.test", parsed.rule->initiator_domains(1).domain());
  EXPECT_EQ("sub.example.com", parsed.rule->initiator_domains(2).domain());
  EXPECT_TRUE(parsed.rule->initiator_domains(2).exclude());
}

TEST(OrbisFilterParser, MatchCaseIsCarried) {
  // Not "/Ad/": a pattern fenced by slashes is a regular expression, which this
  // parser refuses by design rather than approximating.
  ParsedLine parsed = ParseFilterLine("||example.com/Ad$match-case");
  ASSERT_TRUE(parsed.rule);
  EXPECT_TRUE(parsed.rule->match_case());
}

TEST(OrbisFilterParser, DocumentExceptionBecomesAnActivationType) {
  ParsedLine parsed = ParseFilterLine("@@||example.com^$document");
  ASSERT_TRUE(parsed.rule);
  EXPECT_EQ(proto::RULE_SEMANTICS_ALLOWLIST, parsed.rule->semantics());
  EXPECT_EQ(proto::ACTIVATION_TYPE_DOCUMENT, parsed.rule->activation_types());
}

TEST(OrbisFilterParser, CosmeticRulesComeBackSeparatelyRatherThanDropped) {
  ParsedLine parsed = ParseFilterLine("example.com,test.org##.ad-banner");
  EXPECT_FALSE(parsed.rule);
  ASSERT_TRUE(parsed.cosmetic);
  EXPECT_EQ(UnsupportedReason::kCosmetic, parsed.unsupported);
  EXPECT_EQ(".ad-banner", parsed.cosmetic->selector);
  ASSERT_EQ(2u, parsed.cosmetic->domains.size());
  EXPECT_EQ("example.com", parsed.cosmetic->domains[0]);
  EXPECT_FALSE(parsed.cosmetic->is_exception);
}

TEST(OrbisFilterParser, CosmeticExceptionIsMarkedAsOne) {
  ParsedLine parsed = ParseFilterLine("example.com#@#.ad-banner");
  ASSERT_TRUE(parsed.cosmetic);
  EXPECT_TRUE(parsed.cosmetic->is_exception);
}

TEST(OrbisFilterParser, GenericCosmeticRuleHasNoDomains) {
  ParsedLine parsed = ParseFilterLine("##.sponsored");
  ASSERT_TRUE(parsed.cosmetic);
  EXPECT_TRUE(parsed.cosmetic->domains.empty());
  EXPECT_EQ(".sponsored", parsed.cosmetic->selector);
}

TEST(OrbisFilterParser, RegexRulesAreReportedRatherThanApproximated) {
  ParsedLine parsed = ParseFilterLine("/banner\\d+/");
  EXPECT_FALSE(parsed.rule);
  EXPECT_EQ(UnsupportedReason::kRegex, parsed.unsupported);
}

TEST(OrbisFilterParser, ResponseRewritingOptionsAreReported) {
  for (const char* line : {"||example.com^$redirect=noop.js",
                           "||example.com^$removeparam=utm_source",
                           "||example.com^$csp=script-src 'none'"}) {
    ParsedLine parsed = ParseFilterLine(line);
    EXPECT_FALSE(parsed.rule) << line;
    EXPECT_EQ(UnsupportedReason::kResponseBehaviour, parsed.unsupported) << line;
  }
}

TEST(OrbisFilterParser, AnUnknownOptionDropsTheRuleRatherThanWideningIt) {
  ParsedLine parsed = ParseFilterLine("||example.com^$somethingnew");
  EXPECT_FALSE(parsed.rule);
  EXPECT_EQ(UnsupportedReason::kUnhandledOption, parsed.unsupported);
}

TEST(OrbisFilterParser, CommentsAndHeadersAreNotRules) {
  for (const char* line : {"! a comment", "[Adblock Plus 2.0]", "", "   "}) {
    ParsedLine parsed = ParseFilterLine(line);
    EXPECT_FALSE(parsed.rule) << line;
    EXPECT_FALSE(parsed.cosmetic) << line;
    EXPECT_EQ(UnsupportedReason::kNotARule, parsed.unsupported) << line;
  }
}

TEST(OrbisFilterParser, AListIsCountedByWhatItActuallyProduced) {
  const char kList[] =
      "[Adblock Plus 2.0]\n"
      "! Orbis test list\n"
      "||ads.example.com^\n"
      "||track.example.com^$third-party\n"
      "@@||example.com/ok.js\n"
      "example.com##.ad\n"
      "/regex\\d/\n"
      "||example.com^$redirect=noop\n";

  std::vector<proto::UrlRule> rules;
  std::vector<CosmeticRule> cosmetic;
  ParseStats stats = ParseFilterList(kList, &rules, &cosmetic);

  EXPECT_EQ(3, stats.network_rules);
  EXPECT_EQ(1, stats.cosmetic_rules);
  EXPECT_EQ(2, stats.comments);
  // The regex and the redirect: reported, so a list that quietly lost rules can
  // be told apart from one that loaded whole.
  EXPECT_EQ(2, stats.unsupported);
  EXPECT_EQ(3u, rules.size());
  EXPECT_EQ(1u, cosmetic.size());
}

TEST(OrbisFilterParser, ParsingAppendsSoSeveralListsShareOneRuleset) {
  std::vector<proto::UrlRule> rules;
  ParseFilterList("||one.example^\n", &rules, nullptr);
  ParseFilterList("||two.example^\n", &rules, nullptr);
  EXPECT_EQ(2u, rules.size());
}

}  // namespace
}  // namespace orbis
