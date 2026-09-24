// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/orbis/adblock/orbis_ruleset.h"

#include <utility>

#include "base/strings/string_util.h"
#include "components/subresource_filter/core/common/first_party_origin.h"
#include "components/subresource_filter/core/common/load_policy.h"

namespace orbis {

namespace {

// True when `host` is the domain itself or a subdomain of it, which is what a
// filter list means when it writes `example.com` in a domain list.
bool HostMatchesDomain(std::string_view host, std::string_view domain) {
  if (host == domain) {
    return true;
  }
  return host.size() > domain.size() &&
         base::EndsWith(host, domain, base::CompareCase::INSENSITIVE_ASCII) &&
         host[host.size() - domain.size() - 1] == '.';
}

}  // namespace

// static
scoped_refptr<OrbisRuleset> OrbisRuleset::Build(
    const std::vector<std::string>& filter_lists,
    ParseStats* stats_out) {
  std::vector<url_pattern_index::proto::UrlRule> rules;
  std::vector<CosmeticRule> cosmetic;
  ParseStats totals;

  for (const std::string& list : filter_lists) {
    ParseStats stats = ParseFilterList(list, &rules, &cosmetic);
    totals.network_rules += stats.network_rules;
    totals.cosmetic_rules += stats.cosmetic_rules;
    totals.comments += stats.comments;
    totals.unsupported += stats.unsupported;
  }
  if (stats_out) {
    *stats_out = totals;
  }

  // Nothing usable is reported as nothing, not as an empty ruleset. A ruleset
  // that exists but matches nothing looks like working ad blocking that happens
  // to block no ads, which is the hardest kind of failure to notice.
  if (rules.empty() && cosmetic.empty()) {
    return nullptr;
  }

  // A stable id for Orbis's own ruleset, so a matcher can say which ruleset a
  // decision came from when more than one is in play.
  constexpr uint64_t kOrbisRulesetId = 0x4f52424953ull;  // "ORBIS"
  subresource_filter::RulesetIndexer indexer(kOrbisRulesetId);
  int indexed_count = 0;
  for (const url_pattern_index::proto::UrlRule& rule : rules) {
    // The indexer refuses a rule it cannot represent. That is a fact worth
    // keeping rather than a failure to hide: it is counted as unsupported, so
    // the totals still describe the ruleset that actually exists.
    if (indexer.AddUrlRule(rule)) {
      ++indexed_count;
    } else if (stats_out) {
      --stats_out->network_rules;
      ++stats_out->unsupported;
    }
  }
  indexer.Finish();

  std::vector<uint8_t> buffer(indexer.data().begin(), indexer.data().end());
  return base::WrapRefCounted(
      new OrbisRuleset(std::move(buffer), std::move(cosmetic), indexed_count));
}

OrbisRuleset::OrbisRuleset(std::vector<uint8_t> indexed,
                           std::vector<CosmeticRule> cosmetic,
                           int network_rule_count)
    : indexed_(std::move(indexed)),
      cosmetic_rules_(std::move(cosmetic)),
      network_rule_count_(network_rule_count) {
  if (!indexed_.empty()) {
    matcher_ =
        std::make_unique<subresource_filter::IndexedRulesetMatcher>(indexed_);
  }
}

OrbisRuleset::~OrbisRuleset() = default;

OrbisRuleset::Decision OrbisRuleset::Decide(
    const GURL& url,
    const url::Origin& first_party,
    url_pattern_index::proto::ElementType element_type) const {
  if (!matcher_ || !url.is_valid()) {
    return Decision::kAllow;
  }

  const subresource_filter::FirstPartyOrigin origin(first_party);
  const url_pattern_index::flat::UrlRule* matched = matcher_->MatchedUrlRule(
      url, origin, element_type, /*disable_generic_rules=*/false);
  if (!matched) {
    return Decision::kAllow;
  }
  // MatchedUrlRule lets an exception win over a blocking rule, so reaching here
  // with an allowlist rule means the request was explicitly permitted.
  const bool is_allowlist =
      (matched->options() & url_pattern_index::flat::OptionFlag_IS_ALLOWLIST) !=
      0;
  return is_allowlist ? Decision::kAllowedByException : Decision::kBlock;
}

std::vector<std::string> OrbisRuleset::CosmeticSelectorsFor(
    std::string_view host) const {
  std::vector<std::string> selectors;
  if (host.empty()) {
    return selectors;
  }

  // Exceptions first: a selector lifted on this host is never returned, however
  // many rules would otherwise hide it.
  std::vector<std::string_view> lifted;
  for (const CosmeticRule& rule : cosmetic_rules_) {
    if (!rule.is_exception) {
      continue;
    }
    for (const std::string& domain : rule.domains) {
      if (HostMatchesDomain(host, domain)) {
        lifted.push_back(rule.selector);
        break;
      }
    }
  }

  for (const CosmeticRule& rule : cosmetic_rules_) {
    if (rule.is_exception) {
      continue;
    }

    bool excluded = false;
    for (const std::string& domain : rule.excluded_domains) {
      if (HostMatchesDomain(host, domain)) {
        excluded = true;
        break;
      }
    }
    if (excluded) {
      continue;
    }

    // No domains means the rule is generic and applies everywhere.
    bool applies = rule.domains.empty();
    for (const std::string& domain : rule.domains) {
      if (HostMatchesDomain(host, domain)) {
        applies = true;
        break;
      }
    }
    if (!applies) {
      continue;
    }

    bool is_lifted = false;
    for (std::string_view selector : lifted) {
      if (selector == rule.selector) {
        is_lifted = true;
        break;
      }
    }
    if (!is_lifted) {
      selectors.push_back(rule.selector);
    }
  }
  return selectors;
}

}  // namespace orbis
