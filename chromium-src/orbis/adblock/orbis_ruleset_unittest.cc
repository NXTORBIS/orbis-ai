// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/orbis/adblock/orbis_ruleset.h"

#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace orbis {
namespace {

namespace proto = url_pattern_index::proto;

using Decision = OrbisRuleset::Decision;

url::Origin PageOn(const char* url) {
  return url::Origin::Create(GURL(url));
}

Decision DecideFor(const scoped_refptr<OrbisRuleset>& ruleset,
                   const char* request,
                   const char* page,
                   proto::ElementType type = proto::ELEMENT_TYPE_SCRIPT) {
  return ruleset->Decide(GURL(request), PageOn(page), type);
}

TEST(OrbisRuleset, BlocksWhatTheRuleNames) {
  auto ruleset = OrbisRuleset::Build({"||ads.example.com^\n"}, nullptr);
  ASSERT_TRUE(ruleset);
  EXPECT_EQ(Decision::kBlock,
            DecideFor(ruleset, "https://ads.example.com/banner.js",
                      "https://news.test/"));
}

TEST(OrbisRuleset, LeavesEverythingElseAlone) {
  auto ruleset = OrbisRuleset::Build({"||ads.example.com^\n"}, nullptr);
  ASSERT_TRUE(ruleset);
  EXPECT_EQ(Decision::kAllow,
            DecideFor(ruleset, "https://news.test/article.js",
                      "https://news.test/"));
}

TEST(OrbisRuleset, ASubdomainRuleCoversItsSubdomains) {
  auto ruleset = OrbisRuleset::Build({"||example.com^\n"}, nullptr);
  ASSERT_TRUE(ruleset);
  EXPECT_EQ(Decision::kBlock,
            DecideFor(ruleset, "https://deep.sub.example.com/x.js",
                      "https://news.test/"));
}

TEST(OrbisRuleset, AnExceptionOverridesTheBlock) {
  auto ruleset = OrbisRuleset::Build(
      {"||example.com^\n@@||example.com/wanted.js\n"}, nullptr);
  ASSERT_TRUE(ruleset);
  EXPECT_EQ(Decision::kBlock,
            DecideFor(ruleset, "https://example.com/ads.js",
                      "https://news.test/"));
  // Explicitly permitted is reported as its own answer, not folded into "no
  // rule matched": they are different facts about the request.
  EXPECT_EQ(Decision::kAllowedByException,
            DecideFor(ruleset, "https://example.com/wanted.js",
                      "https://news.test/"));
}

TEST(OrbisRuleset, ThirdPartyRulesLookAtWhoAsked) {
  auto ruleset =
      OrbisRuleset::Build({"||tracker.test^$third-party\n"}, nullptr);
  ASSERT_TRUE(ruleset);
  EXPECT_EQ(Decision::kBlock,
            DecideFor(ruleset, "https://tracker.test/p.gif",
                      "https://news.test/"));
  // The same request from its own site is first-party, so the rule is silent.
  EXPECT_EQ(Decision::kAllow,
            DecideFor(ruleset, "https://tracker.test/p.gif",
                      "https://tracker.test/"));
}

TEST(OrbisRuleset, TypeOptionsAreHonoured) {
  auto ruleset = OrbisRuleset::Build({"||example.com/x$script\n"}, nullptr);
  ASSERT_TRUE(ruleset);
  EXPECT_EQ(Decision::kBlock,
            DecideFor(ruleset, "https://example.com/x", "https://news.test/",
                      proto::ELEMENT_TYPE_SCRIPT));
  EXPECT_EQ(Decision::kAllow,
            DecideFor(ruleset, "https://example.com/x", "https://news.test/",
                      proto::ELEMENT_TYPE_IMAGE));
}

TEST(OrbisRuleset, NothingUsableIsReportedAsNothing) {
  // A list of only comments must not produce a ruleset that quietly allows
  // everything while looking like working ad blocking.
  EXPECT_FALSE(OrbisRuleset::Build({"! just a comment\n"}, nullptr));
  EXPECT_FALSE(OrbisRuleset::Build({""}, nullptr));
}

TEST(OrbisRuleset, SeveralListsAreIndexedTogether) {
  auto ruleset = OrbisRuleset::Build(
      {"||one.test^\n", "||two.test^\n"}, nullptr);
  ASSERT_TRUE(ruleset);
  EXPECT_EQ(Decision::kBlock,
            DecideFor(ruleset, "https://one.test/a.js", "https://news.test/"));
  EXPECT_EQ(Decision::kBlock,
            DecideFor(ruleset, "https://two.test/a.js", "https://news.test/"));
}

TEST(OrbisRuleset, StatsDescribeTheRulesetThatActuallyExists) {
  ParseStats stats;
  auto ruleset = OrbisRuleset::Build(
      {"! header\n||a.test^\n||b.test^\nexample.com##.ad\n/regex\\d/\n"},
      &stats);
  ASSERT_TRUE(ruleset);
  EXPECT_EQ(2, stats.network_rules);
  EXPECT_EQ(1, stats.cosmetic_rules);
  EXPECT_EQ(1, stats.comments);
  EXPECT_EQ(1, stats.unsupported);
  EXPECT_EQ(2, ruleset->network_rule_count());
  EXPECT_EQ(1, ruleset->cosmetic_rule_count());
}

TEST(OrbisRuleset, CosmeticRulesApplyToTheirOwnHost) {
  auto ruleset = OrbisRuleset::Build({"example.com##.ad\n"}, nullptr);
  ASSERT_TRUE(ruleset);
  EXPECT_EQ(std::vector<std::string>{".ad"},
            ruleset->CosmeticSelectorsFor("example.com"));
  EXPECT_EQ(std::vector<std::string>{".ad"},
            ruleset->CosmeticSelectorsFor("www.example.com"));
  EXPECT_TRUE(ruleset->CosmeticSelectorsFor("other.test").empty());
  // "notexample.com" ends with the domain but is a different site.
  EXPECT_TRUE(ruleset->CosmeticSelectorsFor("notexample.com").empty());
}

TEST(OrbisRuleset, GenericCosmeticRulesApplyEverywhere) {
  auto ruleset = OrbisRuleset::Build({"##.sponsored\n"}, nullptr);
  ASSERT_TRUE(ruleset);
  EXPECT_EQ(std::vector<std::string>{".sponsored"},
            ruleset->CosmeticSelectorsFor("anything.test"));
}

TEST(OrbisRuleset, AnExcludedDomainDropsTheSelectorThere) {
  auto ruleset = OrbisRuleset::Build({"~safe.test##.ad\n"}, nullptr);
  ASSERT_TRUE(ruleset);
  EXPECT_TRUE(ruleset->CosmeticSelectorsFor("safe.test").empty());
  EXPECT_EQ(std::vector<std::string>{".ad"},
            ruleset->CosmeticSelectorsFor("other.test"));
}

TEST(OrbisRuleset, ACosmeticExceptionLiftsTheSelectorOnThatHost) {
  auto ruleset =
      OrbisRuleset::Build({"##.ad\nexample.com#@#.ad\n"}, nullptr);
  ASSERT_TRUE(ruleset);
  EXPECT_TRUE(ruleset->CosmeticSelectorsFor("example.com").empty());
  EXPECT_EQ(std::vector<std::string>{".ad"},
            ruleset->CosmeticSelectorsFor("other.test"));
}

}  // namespace
}  // namespace orbis
