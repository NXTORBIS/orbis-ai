// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_ORBIS_ADBLOCK_ORBIS_FILTER_PARSER_H_
#define CHROME_BROWSER_ORBIS_ADBLOCK_ORBIS_FILTER_PARSER_H_

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "components/url_pattern_index/proto/rules.pb.h"

namespace orbis {

// Reads the Adblock Plus filter syntax Orbis's lists are written in and produces
// the rule protos Chromium's own URL pattern index is built from.
//
// This is the network half of the syntax — the part that decides whether a
// request is made at all. Cosmetic rules (`example.com##.ad`) are recognised and
// handed back separately rather than silently dropped, because they are applied
// in the renderer against the document, not here against the request.
//
// What is deliberately not supported is listed in `UnsupportedReason`. A rule
// Orbis cannot express in the index is reported, never approximated: a filter
// that blocks more than it was written to block is worse than one that does not
// load, because nobody finds out about it until a page is broken.

// A cosmetic rule, kept for the renderer to apply.
struct CosmeticRule {
  // Hosts the selector applies to. Empty means every host (a generic rule).
  std::vector<std::string> domains;
  // Hosts the selector is explicitly lifted on.
  std::vector<std::string> excluded_domains;
  // The CSS selector to hide.
  std::string selector;
  // Whether this is an exception (`example.com#@#.ad`) rather than a hide rule.
  bool is_exception = false;
};

enum class UnsupportedReason {
  kNone,
  // `##`, `#@#`, `#?#` and friends: applied to the document, not the request.
  kCosmetic,
  // `$replace=`, `$removeparam=` and other rewriting options: the index matches,
  // it does not rewrite.
  kRewrites,
  // Regular-expression patterns (`/ads?\d+/`): the index is a substring matcher.
  kRegex,
  // `$csp=`, `$redirect=`, `$inline-script` and similar: a response-level
  // behaviour rather than a load decision.
  kResponseBehaviour,
  // Recognised syntax whose meaning Orbis has no way to honour here.
  kUnhandledOption,
  // Not a rule at all: a comment, a list header, or an empty line.
  kNotARule,
};

struct ParsedLine {
  // Set when the line produced a network rule.
  std::optional<url_pattern_index::proto::UrlRule> rule;
  // Set when the line produced a cosmetic rule.
  std::optional<CosmeticRule> cosmetic;
  // Why nothing was produced, when nothing was.
  UnsupportedReason unsupported = UnsupportedReason::kNone;
};

// Parses one line of a filter list. Never throws and never guesses: a line it
// does not fully understand comes back with `unsupported` set.
ParsedLine ParseFilterLine(std::string_view line);

// The outcome of reading a whole list, so a list that silently degraded can be
// told apart from one that loaded.
struct ParseStats {
  int network_rules = 0;
  int cosmetic_rules = 0;
  int comments = 0;
  int unsupported = 0;
};

// Parses a complete filter list. Appends to the vectors rather than clearing
// them, so several lists can be read into one ruleset.
ParseStats ParseFilterList(std::string_view text,
                           std::vector<url_pattern_index::proto::UrlRule>* rules,
                           std::vector<CosmeticRule>* cosmetic);

}  // namespace orbis

#endif  // CHROME_BROWSER_ORBIS_ADBLOCK_ORBIS_FILTER_PARSER_H_
