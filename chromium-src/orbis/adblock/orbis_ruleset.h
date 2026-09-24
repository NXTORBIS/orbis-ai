// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_ORBIS_ADBLOCK_ORBIS_RULESET_H_
#define CHROME_BROWSER_ORBIS_ADBLOCK_ORBIS_RULESET_H_

#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "base/memory/ref_counted.h"
#include "chrome/browser/orbis/adblock/orbis_filter_parser.h"
#include "components/subresource_filter/core/common/indexed_ruleset.h"
#include "components/url_pattern_index/proto/rules.pb.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace orbis {

// Orbis's filter rules, compiled into the index Chromium matches URLs against.
//
// The rules come from the same lists the extension used. What is different is
// where they live: in the browser, in Chromium's own url_pattern_index, matched
// on the request path. Nothing here needs an extension to be installed, enabled,
// or even present, which is the whole point.
//
// A ruleset is immutable once built and is reference counted, so the throttle on
// a request can hold one while the lists are being replaced underneath — an
// update swaps in a new ruleset rather than mutating the one in use.
class OrbisRuleset : public base::RefCountedThreadSafe<OrbisRuleset> {
 public:
  // What a request should do, as decided by the rules.
  enum class Decision {
    // No rule matched; the request is nobody's business here.
    kAllow,
    // A blocking rule matched and no exception overrode it.
    kBlock,
    // An exception matched. Kept separate from kAllow so callers can tell
    // "explicitly permitted" from "never mentioned" — they are different facts,
    // and a statistic that conflates them is a statistic that misleads.
    kAllowedByException,
  };

  // Builds a ruleset from filter-list text. Several lists can be given; they are
  // indexed together, exactly as a browser with several lists enabled would.
  // Returns null when nothing usable was found, rather than an empty ruleset
  // that would silently allow everything.
  static scoped_refptr<OrbisRuleset> Build(
      const std::vector<std::string>& filter_lists,
      ParseStats* stats_out);

  OrbisRuleset(const OrbisRuleset&) = delete;
  OrbisRuleset& operator=(const OrbisRuleset&) = delete;

  // Decides a subresource request. `element_type` is the kind of thing being
  // loaded; `first_party` is the document that asked for it, which is what makes
  // third-party rules mean anything.
  Decision Decide(const GURL& url,
                  const url::Origin& first_party,
                  url_pattern_index::proto::ElementType element_type) const;

  // The cosmetic rules that apply to a host. These are applied in the renderer
  // against the document; the ruleset only decides which ones are relevant.
  std::vector<std::string> CosmeticSelectorsFor(std::string_view host) const;

  int network_rule_count() const { return network_rule_count_; }
  int cosmetic_rule_count() const {
    return static_cast<int>(cosmetic_rules_.size());
  }

 private:
  friend class base::RefCountedThreadSafe<OrbisRuleset>;

  OrbisRuleset(std::vector<uint8_t> indexed,
               std::vector<CosmeticRule> cosmetic,
               int network_rule_count);
  ~OrbisRuleset();

  // The flatbuffer the matcher reads. Owned here so it outlives the matcher.
  const std::vector<uint8_t> indexed_;
  std::unique_ptr<subresource_filter::IndexedRulesetMatcher> matcher_;
  const std::vector<CosmeticRule> cosmetic_rules_;
  const int network_rule_count_;
};

}  // namespace orbis

#endif  // CHROME_BROWSER_ORBIS_ADBLOCK_ORBIS_RULESET_H_
